import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { appSettings } from "@db/schema";
import { eq } from "drizzle-orm";
import { SYNC_TABLES, stripSecrets, syncTable } from "./lib/sync/tables";
import { ID_BLOCK_BASE, ID_BLOCK_SIZE } from "@db/idSpace";
import {
  changedFields,
  classifyDelete,
  merge3,
  type SyncRow,
} from "./lib/sync/merge";
import { deleteAttachmentFile } from "./lib/attachmentStore";
import {
  deleteById,
  rawClient,
  selectAll,
  selectById,
  selectByIds,
  upsertRow,
  writeBaseRow,
} from "./lib/sync/store";
import {
  checkRowWrite,
  loadVisibility,
  isRowVisible,
  noteApplied,
  projectRow,
  noteRemoved,
  visibilityFingerprint,
  WRITABLE_USER_COLUMNS,
  type Visibility,
} from "./lib/sync/visibility";
import { SYNC_PROTOCOL_VERSION } from "@contracts/offline";
import type {
  SyncConflict,
  SyncPushOutcome,
  SyncRowPayload,
} from "@contracts/offline";
import type { SessionUser } from "./context";

/**
 * Der Abgleich zwischen Heimserver und den lokalen Repliken auf den Geräten.
 *
 * Diese Prozeduren laufen ausschließlich im Heimnetz (sie stehen in
 * `ONLINE_ONLY_PROCEDURES`) — der Service Worker ruft sie über `/api/trpc/live`
 * auf, während die App selbst weiter mit ihrer lokalen Kopie arbeitet.
 *
 * Übertragen werden ganze Zeilen, keine Prozeduraufrufe: Die Fachlogik ist
 * bereits auf dem schreibenden Gerät gelaufen (inklusive Kaskaden,
 * Änderungshistorie und Audit-Einträgen), und deren Ergebnis liegt als eigene
 * Zeilenänderung im selben Changeset. Deshalb prüft der Server hier die Rechte
 * noch einmal auf Zeilenebene (`lib/sync/visibility.ts`).
 */

/** Ab dieser Größe wird das Änderungsprotokoll beim Pull aufgeräumt */
const LOG_PRUNE_THRESHOLD = 5000;

/** Tabellen, deren Zeilen eine Datei außerhalb der Datenbank hinter sich haben */
const ATTACHMENT_TABLES = new Set([
  "transaction_attachments",
  "pension_attachments",
  "insurance_attachments",
]);

/** Die `users`-Registry — für `stripSecrets` außerhalb der Push-Schleife */
const usersTable = syncTable("users")!;

const rowSchema = z.record(z.string(), z.unknown());

const changeSchema = z.object({
  entity: z.string().min(1).max(64),
  rowId: z.string().min(1).max(64),
  op: z.enum(["insert", "update", "delete"]),
  row: rowSchema.nullable(),
  base: rowSchema.nullable(),
});

type DeviceRow = {
  id: number;
  device_id: string;
  user_id: number;
  id_block_start: number;
  acked_seq: number;
  visibility: string;
  epoch: string;
};

/* ─────────────────────────────── Hilfsfunktionen ─────────────────────────── */

async function currentEpoch(): Promise<string> {
  const db = getDb();
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "sync_epoch"),
  });
  if (row) return row.value;
  const epoch = crypto.randomUUID();
  await db.insert(appSettings).values({ key: "sync_epoch", value: epoch });
  return epoch;
}

function maxSeq(): number {
  const row = rawClient(getDb())
    .prepare("SELECT MAX(seq) AS seq FROM sync_log")
    .get();
  return Number(row?.seq ?? 0);
}

function minSeq(): number {
  const row = rawClient(getDb())
    .prepare("SELECT MIN(seq) AS seq FROM sync_log")
    .get();
  return row?.seq === null || row?.seq === undefined ? 0 : Number(row.seq);
}

function loadDevice(deviceId: string, user: SessionUser): DeviceRow {
  const row = rawClient(getDb())
    .prepare("SELECT * FROM sync_devices WHERE device_id = ?")
    .get(deviceId) as DeviceRow | undefined;
  if (!row || row.user_id !== user.id) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Unbekanntes Gerät — bitte neu anmelden.",
    });
  }
  return row;
}

function requireProtocol(version: number) {
  if (version !== SYNC_PROTOCOL_VERSION) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Die App auf diesem Gerät passt nicht zur Version auf dem Server. " +
        "Bitte die App aktualisieren (im Heimnetz neu laden).",
    });
  }
}

/**
 * Protokolleinträge wegwerfen, die alle bekannten Geräte bereits haben.
 * Ein Gerät, das lange nicht da war, holt sich stattdessen einen
 * vollständigen Abgleich — deshalb ist das gefahrlos.
 */
function pruneLog() {
  const raw = rawClient(getDb());
  const size = Number(
    raw.prepare("SELECT COUNT(*) AS n FROM sync_log").get()?.n ?? 0
  );
  if (size < LOG_PRUNE_THRESHOLD) return;
  const floor = raw
    .prepare("SELECT MIN(acked_seq) AS seq FROM sync_devices")
    .get();
  const keepFrom = Number(floor?.seq ?? 0);
  if (keepFrom > 0) {
    raw.prepare("DELETE FROM sync_log WHERE seq <= ?").run(keepFrom);
  }
}

function toPk(entity: string, rowId: string): string | number {
  return syncTable(entity)?.pkType === "text" ? rowId : Number(rowId);
}

/* ──────────────────────────────── Pull ───────────────────────────────────── */

type EntityChanges = {
  entity: string;
  upserts: SyncRowPayload[];
  removed: string[];
};

function snapshotFor(vis: Visibility): EntityChanges[] {
  const db = getDb();
  return SYNC_TABLES.map(table => ({
    entity: table.name,
    upserts: selectAll(db, table.name, table.pk, table.snapshotLimit)
      .filter(row => isRowVisible(table, row, vis))
      .map(row => projectRow(table, row, vis)),
    removed: [],
  }));
}

function deltaFor(vis: Visibility, since: number): EntityChanges[] {
  const db = getDb();
  // Je Zeile zählt nur der letzte Vermerk — ob eine Zeile dreimal geändert
  // wurde, spielt keine Rolle, übertragen wird ohnehin ihr aktueller Stand.
  const marks = rawClient(db)
    .prepare(
      `SELECT entity, row_id, op FROM sync_log
       WHERE seq > ? AND seq IN (
         SELECT MAX(seq) FROM sync_log WHERE seq > ? GROUP BY entity, row_id
       )`
    )
    .all(since, since) as unknown as {
    entity: string;
    row_id: string;
    op: string;
  }[];

  const byEntity = new Map<string, { ids: string[]; deleted: string[] }>();
  for (const mark of marks) {
    if (!syncTable(mark.entity)) continue;
    const bucket = byEntity.get(mark.entity) ?? { ids: [], deleted: [] };
    if (mark.op === "delete") bucket.deleted.push(mark.row_id);
    else bucket.ids.push(mark.row_id);
    byEntity.set(mark.entity, bucket);
  }

  const changes: EntityChanges[] = [];
  for (const [entity, bucket] of byEntity) {
    const table = syncTable(entity)!;
    const rows = selectByIds(
      db,
      table.name,
      table.pk,
      bucket.ids.map(id => toPk(entity, id))
    );
    const upserts: SyncRowPayload[] = [];
    const visibleIds = new Set<string>();
    for (const row of rows) {
      if (!isRowVisible(table, row, vis)) continue;
      visibleIds.add(String(row[table.pk]));
      upserts.push(projectRow(table, row, vis));
    }
    // Zeilen, die es nicht mehr gibt oder die der Benutzer nicht mehr sehen
    // darf, müssen auf dem Gerät verschwinden.
    const removed = [
      ...bucket.deleted,
      ...bucket.ids.filter(id => !visibleIds.has(id)),
    ];
    changes.push({ entity, upserts, removed });
  }
  return changes;
}

/* ──────────────────────────────── Push ───────────────────────────────────── */

/**
 * Pushes werden nacheinander abgearbeitet. Zwei gleichzeitige Pushes würden
 * sich sonst beim Drei-Wege-Vergleich in die Quere kommen: Beide läsen
 * denselben Serverstand und der zweite überschriebe den ersten, ohne dass es
 * je als Konflikt auffiele.
 */
let pushQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = pushQueue.then(fn, fn);
  pushQueue = next.catch(() => undefined);
  return next;
}

/**
 * Was ein Gerät an einer Zeile ändern darf. Bei `users` ist das bewusst sehr
 * wenig: Rolle, Aktiv-Flag, Passwort-Hash und TOTP-Geheimnis kommen niemals
 * aus einem Push, sondern nur aus den Prozeduren im Heimnetz.
 */
function sanitizeIncoming(
  entity: string,
  incoming: SyncRow,
  server: SyncRow | null
): SyncRow | null {
  if (entity !== "users") return incoming;
  if (!server) return null;
  // Ohne Geheimnisse: Was hier nicht drinsteht, schreibt `upsertRow` auch
  // nicht — Passwort-Hash und TOTP-Geheimnis bleiben unangetastet.
  const row: SyncRow = { ...(stripSecrets(usersTable, server) as SyncRow) };
  for (const column of WRITABLE_USER_COLUMNS) {
    if (column in incoming) row[column] = incoming[column];
  }
  return row;
}

function conflictOf(
  entity: string,
  rowId: string,
  kind: SyncConflict["kind"],
  fields: string[],
  base: SyncRow | null,
  mine: SyncRow | null,
  theirs: SyncRow | null,
  detail = ""
): SyncConflict {
  return { entity, rowId, kind, fields, base, mine, theirs, detail };
}

/* ─────────────────────────────── Router ──────────────────────────────────── */

/* ──────────────────── Konflikte in der lokalen Replik ────────────────────── */

type ConflictRow = {
  id: number;
  entity: string;
  row_id: string;
  kind: string;
  base: string | null;
  mine: string | null;
  theirs: string | null;
  fields: string;
  detail: string;
  detected_at: number;
};

function parseRow(value: string | null): SyncRowPayload | null {
  return value === null ? null : (JSON.parse(value) as SyncRowPayload);
}

export const syncRouter = createRouter({
  /** Eckdaten des Servers — für die Erreichbarkeitsprüfung und Versionscheck */
  meta: authedQuery.query(async () => ({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    epoch: await currentEpoch(),
    seq: maxSeq(),
  })),

  /**
   * Gerät anmelden und seinen ID-Block holen.
   *
   * Alle Tabellen vergeben ihre IDs per AUTOINCREMENT — zwei schreibende
   * Repliken kämen sich dabei sofort ins Gehege. Statt das Schema auf UUIDs
   * umzustellen, bekommt jedes Gerät einen eigenen Zahlenraum: Es setzt
   * `sqlite_sequence` lokal auf den Blockanfang und vergibt ab da IDs, die
   * garantiert nirgendwo sonst vorkommen. Umschreiben von Fremdschlüsseln
   * entfällt damit vollständig.
   */
  claimDevice: authedQuery
    .input(z.object({ deviceId: z.string().min(8).max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      const raw = rawClient(getDb());
      const deviceId = input.deviceId ?? crypto.randomUUID();
      const existing = raw
        .prepare("SELECT * FROM sync_devices WHERE device_id = ?")
        .get(deviceId) as DeviceRow | undefined;

      if (existing && existing.user_id !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Dieses Gerät gehört zu einem anderen Konto.",
        });
      }

      const now = Date.now();
      if (existing) {
        raw
          .prepare("UPDATE sync_devices SET last_seen_at = ? WHERE id = ?")
          .run(now, existing.id);
        return {
          deviceId,
          idBlockStart: existing.id_block_start,
          protocolVersion: SYNC_PROTOCOL_VERSION,
          epoch: await currentEpoch(),
        };
      }

      const inserted = raw
        .prepare(
          `INSERT INTO sync_devices
             (device_id, user_id, id_block_start, acked_seq, visibility,
              epoch, last_seen_at, created_at)
           VALUES (?, ?, 0, 0, '', '', ?, ?)`
        )
        .run(deviceId, ctx.user.id, now, now);
      const idBlockStart =
        ID_BLOCK_BASE + Number(inserted.lastInsertRowid) * ID_BLOCK_SIZE;
      raw
        .prepare("UPDATE sync_devices SET id_block_start = ? WHERE id = ?")
        .run(idBlockStart, inserted.lastInsertRowid);

      return {
        deviceId,
        idBlockStart,
        protocolVersion: SYNC_PROTOCOL_VERSION,
        epoch: await currentEpoch(),
      };
    }),

  /**
   * Änderungen vom Server holen — als Delta seit `since` oder, wenn das nicht
   * reicht, als vollständiger Schnappschuss. Ein voller Abgleich wird nötig
   * bei der Ersteinrichtung, nach einem Backup-Restore (neue `epoch`), wenn
   * Protokolleinträge bereits aufgeräumt wurden — und wenn sich die
   * **sichtbaren Konten** geändert haben: Wird ein Konto privat gestellt oder
   * freigegeben, ändern sich seine Buchungen ja nicht und tauchen deshalb in
   * keinem Änderungsprotokoll auf.
   *
   * Ein neu angelegtes Konto löst denselben vollständigen Abgleich aus,
   * obwohl es das nicht müsste. Das ist bewusst in Kauf genommen: Konten legt
   * man selten an, und die Alternative wäre eine Sonderbehandlung, die genau
   * dann falsch liegt, wenn es darauf ankommt.
   */
  pull: authedQuery
    .input(
      z.object({
        deviceId: z.string().min(8).max(64),
        since: z.number().int().min(0),
        protocolVersion: z.number().int(),
      })
    )
    .query(async ({ ctx, input }) => {
      requireProtocol(input.protocolVersion);
      const device = loadDevice(input.deviceId, ctx.user);
      const raw = rawClient(getDb());
      const vis = await loadVisibility(getDb(), ctx.user);
      const fingerprint = visibilityFingerprint(vis);
      const epoch = await currentEpoch();
      const seq = maxSeq();
      const oldest = minSeq();

      const full =
        input.since <= 0 ||
        device.epoch !== epoch ||
        device.visibility !== fingerprint ||
        (oldest > 0 && input.since < oldest - 1);

      const changes = full ? snapshotFor(vis) : deltaFor(vis, input.since);

      raw
        .prepare(
          `UPDATE sync_devices
             SET acked_seq = ?, visibility = ?, epoch = ?, last_seen_at = ?
           WHERE id = ?`
        )
        .run(
          // Nach einem vollständigen Abgleich ist das Gerät auf dem aktuellen
          // Stand. Hier 0 zu schreiben hielte `pruneLog` für immer bei 0 fest
          // — das Änderungsprotokoll wüchse dann unbegrenzt.
          full ? seq : Math.max(device.acked_seq, input.since),
          fingerprint,
          epoch,
          Date.now(),
          device.id
        );
      pruneLog();

      return { full, seq, epoch, changes };
    }),

  /**
   * Lokale Änderungen zum Server schicken. Jede Zeile durchläuft denselben
   * Drei-Wege-Vergleich (`lib/sync/merge.ts`): unverändert → anwenden,
   * verschiedene Felder → automatisch zusammenführen, dasselbe Feld → Konflikt
   * für den Benutzer.
   */
  push: authedQuery
    .input(
      z.object({
        deviceId: z.string().min(8).max(64),
        protocolVersion: z.number().int(),
        changes: z.array(changeSchema).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireProtocol(input.protocolVersion);
      loadDevice(input.deviceId, ctx.user);

      return serialized(async () => {
        const db = getDb();
        const vis = await loadVisibility(db, ctx.user);
        const outcomes: SyncPushOutcome[] = [];

        for (const change of input.changes) {
          const table = syncTable(change.entity);
          if (!table) {
            outcomes.push({
              entity: change.entity,
              rowId: change.rowId,
              status: "skipped",
            });
            continue;
          }

          const id = toPk(change.entity, change.rowId);
          const server = selectById(db, table.name, table.pk, id);
          const base = (change.base as SyncRow | null) ?? null;

          /* ── Löschen ────────────────────────────────────────────────── */
          if (change.op === "delete") {
            if (server) {
              const denial = checkRowWrite(table, server, vis);
              if (denial) {
                outcomes.push({
                  entity: change.entity,
                  rowId: change.rowId,
                  status: "conflict",
                  conflict: conflictOf(
                    change.entity,
                    change.rowId,
                    "forbidden",
                    [],
                    base,
                    null,
                    projectRow(table, server, vis),
                    denial.reason
                  ),
                });
                continue;
              }
            }
            const verdict = classifyDelete(base, server);
            if (verdict.kind === "conflict") {
              outcomes.push({
                entity: change.entity,
                rowId: change.rowId,
                status: "conflict",
                conflict: conflictOf(
                  change.entity,
                  change.rowId,
                  "deleted-local",
                  changedFields(base, server),
                  base,
                  null,
                  server ? projectRow(table, server, vis) : null
                ),
              });
              continue;
            }
            if (server) {
              deleteById(db, table.name, table.pk, id);
              noteRemoved(table, server, vis);
              // Anhang-Dateien liegen außerhalb der Datenbank: Die
              // Zeilen-Replikation allein ließe sie für immer liegen.
              const storedName = server["stored_name"];
              if (
                ATTACHMENT_TABLES.has(table.name) &&
                typeof storedName === "string"
              ) {
                deleteAttachmentFile(storedName);
              }
            }
            outcomes.push({
              entity: change.entity,
              rowId: change.rowId,
              status: "applied",
              row: null,
            });
            continue;
          }

          /* ── Anlegen und Ändern ─────────────────────────────────────── */
          const incoming = sanitizeIncoming(
            change.entity,
            (change.row ?? {}) as SyncRow,
            server
          );
          if (!incoming) {
            outcomes.push({
              entity: change.entity,
              rowId: change.rowId,
              status: "skipped",
            });
            continue;
          }

          const denial =
            checkRowWrite(table, incoming, vis, !server) ??
            (server ? checkRowWrite(table, server, vis) : null);
          if (denial) {
            outcomes.push({
              entity: change.entity,
              rowId: change.rowId,
              status: "conflict",
              conflict: conflictOf(
                change.entity,
                change.rowId,
                "forbidden",
                [],
                base,
                incoming,
                server ? projectRow(table, server, vis) : null,
                denial.reason
              ),
            });
            continue;
          }

          // Auf dem Server gelöscht, auf dem Gerät geändert: Das kann nur der
          // Benutzer entscheiden — stillschweigend wiederherzustellen wäre
          // genauso falsch wie die Änderung wegzuwerfen.
          if (!server && base) {
            outcomes.push({
              entity: change.entity,
              rowId: change.rowId,
              status: "conflict",
              conflict: conflictOf(
                change.entity,
                change.rowId,
                "deleted-remote",
                [],
                base,
                incoming,
                null
              ),
            });
            continue;
          }

          if (!server) {
            upsertRow(db, table.name, table.pk, incoming);
            noteApplied(table, incoming, vis);
            outcomes.push({
              entity: change.entity,
              rowId: change.rowId,
              status: "applied",
              row: projectRow(table, incoming, vis),
            });
            continue;
          }

          // Der Server-Stand muss für den Vergleich so aussehen, wie ihn das
          // Gerät kennt — sonst gälten Passwort-Hash und TOTP-Geheimnis als
          // Serveränderung, und jede Profiländerung käme als „zusammengeführt"
          // zurück. Deshalb dieselbe Projektion wie im Pull.
          const serverForMerge = projectRow(table, server, vis);
          const outcome = merge3(
            base ?? serverForMerge,
            incoming,
            serverForMerge
          );
          if (outcome.kind === "conflict") {
            outcomes.push({
              entity: change.entity,
              rowId: change.rowId,
              status: "conflict",
              conflict: conflictOf(
                change.entity,
                change.rowId,
                "fields",
                outcome.fields,
                base,
                incoming,
                serverForMerge
              ),
            });
            continue;
          }

          upsertRow(db, table.name, table.pk, outcome.row);
          noteApplied(table, outcome.row, vis);
          outcomes.push({
            entity: change.entity,
            rowId: change.rowId,
            status: outcome.kind === "merge" ? "merged" : "applied",
            row: projectRow(table, outcome.row, vis),
            mergedMine: outcome.kind === "merge" ? outcome.mine : undefined,
            mergedTheirs: outcome.kind === "merge" ? outcome.theirs : undefined,
          });
        }

        return { seq: maxSeq(), outcomes };
      });
    }),

  /* ── Konflikte und Merge-Protokoll ───────────────────────────────────────
     Diese vier Prozeduren stehen bewusst **nicht** in
     `ONLINE_ONLY_PROCEDURES`: Konflikte entstehen auf dem Gerät und werden
     dort entschieden. Auf dem Server sind die Tabellen leer — eine Instanz
     ohne Offline-Betrieb bekommt schlicht leere Listen. */

  /** Offene Konflikte, die der Benutzer entscheiden muss */
  listConflicts: authedQuery.query(() => {
    const rows = rawClient(getDb())
      .prepare("SELECT * FROM sync_conflicts ORDER BY detected_at DESC")
      .all() as unknown as ConflictRow[];
    return rows.map(row => ({
      id: row.id,
      entity: row.entity,
      rowId: row.row_id,
      kind: row.kind as SyncConflict["kind"],
      fields: JSON.parse(row.fields) as string[],
      base: parseRow(row.base),
      mine: parseRow(row.mine),
      theirs: parseRow(row.theirs),
      detail: row.detail,
      detectedAt: row.detected_at,
    }));
  }),

  /**
   * Konflikt entscheiden.
   *
   * Wichtig ist, was **danach** passiert: Die gewählte Fassung wird ganz
   * normal in die lokale Tabelle geschrieben — mit eingeschalteten Triggern.
   * Sie gilt damit als neue lokale Änderung und geht beim nächsten Abgleich
   * raus. Als Basis dient der Stand, den der Server zum Zeitpunkt des
   * Konflikts hatte; deshalb läuft sie dann konfliktfrei durch.
   */
  resolveConflict: authedQuery
    .input(
      z.object({
        entity: z.string().min(1).max(64),
        rowId: z.string().min(1).max(64),
        choice: z.union([
          z.literal("mine"),
          z.literal("theirs"),
          z.object({
            fields: z.record(z.string(), z.enum(["mine", "theirs"])),
          }),
        ]),
      })
    )
    .mutation(({ input }) => {
      const db = getDb();
      const raw = rawClient(db);
      const conflict = raw
        .prepare("SELECT * FROM sync_conflicts WHERE entity = ? AND row_id = ?")
        .get(input.entity, input.rowId) as ConflictRow | undefined;
      if (!conflict) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dieser Konflikt ist bereits entschieden.",
        });
      }
      const table = syncTable(conflict.entity);
      if (!table) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unbekannter Datensatz.",
        });
      }

      const mine = parseRow(conflict.mine) as SyncRow | null;
      const theirs = parseRow(conflict.theirs) as SyncRow | null;
      const id = toPk(conflict.entity, conflict.row_id);

      // Der Stand aus dem Heimnetz ist bereits eingespielt (das passiert
      // direkt beim Erkennen des Konflikts) und dient nun als Basis.
      writeBaseRow(db, conflict.entity, conflict.row_id, theirs);

      let resolved: SyncRow | null;
      if (input.choice === "theirs") {
        resolved = theirs;
      } else if (input.choice === "mine") {
        resolved = mine;
      } else {
        // Feldweise: auf dem Stand aus dem Heimnetz aufsetzen und die
        // ausgewählten Felder durch die eigenen ersetzen.
        if (!theirs || !mine) {
          resolved = mine ?? theirs;
        } else {
          resolved = { ...theirs };
          for (const [field, side] of Object.entries(input.choice.fields)) {
            if (side === "mine") resolved[field] = mine[field] ?? null;
          }
        }
      }

      // Bewusst ohne withTriggersSuspended: Genau dieser Schreibvorgang macht
      // die Entscheidung zu einer lokalen Änderung, die zum Server geht.
      if (resolved === null) {
        deleteById(db, table.name, table.pk, id);
      } else if (
        theirs === null ||
        changedFields(theirs, resolved).length > 0
      ) {
        upsertRow(db, table.name, table.pk, resolved);
      }

      raw
        .prepare("DELETE FROM sync_conflicts WHERE entity = ? AND row_id = ?")
        .run(conflict.entity, conflict.row_id);
      return { ok: true };
    }),

  /** Protokoll der automatisch zusammengeführten Datensätze */
  listMerges: authedQuery
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ input }) => {
      const rows = rawClient(getDb())
        .prepare("SELECT * FROM sync_merges ORDER BY merged_at DESC LIMIT ?")
        .all(input.limit) as unknown as {
        id: number;
        entity: string;
        row_id: string;
        mine_fields: string;
        their_fields: string;
        merged_at: number;
      }[];
      return rows.map(row => ({
        id: row.id,
        entity: row.entity,
        rowId: row.row_id,
        mineFields: JSON.parse(row.mine_fields) as string[],
        theirFields: JSON.parse(row.their_fields) as string[],
        mergedAt: row.merged_at,
      }));
    }),

  /** Merge-Protokoll leeren, wenn es gesichtet ist */
  clearMerges: authedQuery.mutation(() => {
    rawClient(getDb()).prepare("DELETE FROM sync_merges").run();
    return { ok: true };
  }),
});
