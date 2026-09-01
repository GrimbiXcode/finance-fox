import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../api/router";
import { ensureSchema } from "../../../api/lib/migrate";
import { syncTable, SYNC_TABLES } from "../../../api/lib/sync/tables";
import {
  rawClient,
  selectAll,
  withTriggersSuspended,
} from "../../../api/lib/sync/store";
import type { SyncRow } from "../../../api/lib/sync/merge";
import {
  SYNC_PROTOCOL_VERSION,
  TRPC_LIVE_PATH,
  type SyncChange,
  type SyncReason,
  type SyncStatus,
} from "@contracts/offline";
import { flushDatabase, getDb, initDb, setIdBlock } from "../db/connection";
import {
  clearBootstrapped,
  isBootstrapped,
  loadCursor,
  loadDevice,
  loadIdentity,
  loadBlobBudget,
  loadLastSync,
  markBootstrapped,
  saveCursor,
  saveIdentity,
  saveDevice,
  saveLastSync,
} from "../state";
import { blobBytesStored, blobCount, syncBlobs } from "./blobs";
import { clearAttachmentBlobs } from "../shims/attachmentStore";
import {
  applyRemoteRow,
  changedAfter,
  clearMarksUpTo,
  conflictCount,
  hasConflict,
  maxLocalSeq,
  pendingCount,
  pendingMarks,
  readBase,
  readRow,
  recordConflict,
  recordMerge,
  removeRemoteRow,
  writeBase,
} from "./replica";

/**
 * Der Abgleich, wie er im Service Worker läuft.
 *
 * Ablauf je Durchgang: erst **push** (damit der Server den aktuellen Stand
 * kennt, bevor wir von ihm lesen), dann **pull**. Läuft immer nur ein
 * Durchgang gleichzeitig; weitere Anstöße werden zusammengefasst.
 */

const server = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: TRPC_LIVE_PATH,
      transformer: superjson,
      // Der Worker holt sich das Session-Cookie wie die Seite; lesen kann er
      // es nicht (HttpOnly), mitschicken schon.
      fetch: (input, init) =>
        fetch(input, { ...(init ?? {}), credentials: "include" }),
    }),
  ],
});

let running = false;
let queued = false;
let lastError: string | null = null;
let reachable = false;
let dbReady: Promise<void> | undefined;

async function ensureDatabase(): Promise<void> {
  dbReady ??= (async () => {
    await initDb();
    ensureSchema();
  })();
  return dbReady;
}

/** Aktueller Zustand für die Anzeige in der Kopfzeile */
export async function currentStatus(): Promise<SyncStatus> {
  const identity = await loadIdentity();
  let pending = 0;
  let conflicts = 0;
  let files = 0;
  let bytes = 0;
  if (dbReady) {
    await dbReady;
    pending = pendingCount();
    conflicts = conflictCount();
    files = blobCount();
    bytes = blobBytesStored();
  }
  return {
    offline: !identity
      ? "bootstrapping"
      : (await isBootstrapped())
        ? "ready"
        : "bootstrapping",
    reachable,
    syncing: running,
    lastSyncAt: await loadLastSync(),
    pending,
    conflicts,
    error: lastError,
    storage: { files, bytes, budget: await loadBlobBudget() },
  };
}

/** Ist der Heimserver gerade erreichbar? */
export async function probeServer(): Promise<boolean> {
  try {
    await server.sync.meta.query();
    reachable = true;
  } catch {
    reachable = false;
  }
  return reachable;
}

/**
 * Einen Abgleich anstoßen. Mehrfache Anstöße während eines laufenden
 * Durchgangs werden zu einem weiteren zusammengefasst.
 */
export async function requestSync(reason: SyncReason): Promise<boolean> {
  if (running) {
    queued = true;
    return false;
  }
  running = true;
  try {
    const changed = await runSync(reason);
    return changed;
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void requestSync("interval");
    }
  }
}

async function runSync(reason: SyncReason): Promise<boolean> {
  const identity = await loadIdentity();
  if (!identity) return false;

  await ensureDatabase();

  try {
    const device = await registerDevice();
    const pushedSomething = await pushLocalChanges(device.deviceId);
    const pulledSomething = await pullRemoteChanges(device.deviceId);
    // Erst danach die Dateien: Ein Beleg braucht seine Metadaten-Zeile auf der
    // Gegenseite, sonst weiß sie nicht, wohin damit.
    const blobsChanged = await syncBlobs();
    await flushDatabase();
    await saveLastSync(Date.now());
    lastError = null;
    reachable = true;
    return pushedSomething || pulledSomething || blobsChanged;
  } catch (err) {
    // Der Server hat geantwortet, aber die Sitzung gilt nicht mehr: Dann ist
    // auch die lokal gespeicherte Identität hinfällig — die App führt zur
    // Anmeldung. Ein bloßes „nicht erreichbar" darf das nie auslösen,
    // sonst spülte ein Funkloch die Offline-Daten weg.
    if (isUnauthorized(err)) {
      await saveIdentity(null);
      lastError =
        "Die Anmeldung ist abgelaufen — bitte im Heimnetz neu anmelden.";
      return false;
    }
    reachable = false;
    lastError = errorText(err);
    // Im Alltag ist „nicht erreichbar" der Normalfall unterwegs — das ist
    // kein Fehler, den man dem Benutzer als solchen zeigen müsste.
    if (reason === "manual") console.warn("[Finance Fox] Abgleich:", err);
    return false;
  }
}

function isUnauthorized(err: unknown): boolean {
  const code = (err as { data?: { code?: string } })?.data?.code;
  return code === "UNAUTHORIZED";
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Der Heimserver ist gerade nicht erreichbar.";
}

/* ─────────────────────────── Gerät anmelden ──────────────────────────────── */

async function registerDevice() {
  const stored = await loadDevice();
  const claimed = await server.sync.claimDevice.mutate({
    deviceId: stored?.deviceId,
  });
  if (
    !stored ||
    stored.idBlockStart !== claimed.idBlockStart ||
    stored.epoch !== claimed.epoch
  ) {
    await saveDevice({
      deviceId: claimed.deviceId,
      idBlockStart: claimed.idBlockStart,
      epoch: claimed.epoch,
    });
  }
  // Ab jetzt vergibt dieses Gerät IDs aus seinem eigenen Block. Muss vor der
  // ersten lokal angelegten Zeile passiert sein.
  setIdBlock(claimed.idBlockStart);
  return claimed;
}

/* ──────────────────────────────── Push ───────────────────────────────────── */

async function pushLocalChanges(deviceId: string): Promise<boolean> {
  const marks = pendingMarks();
  if (marks.length === 0) return false;

  const cutoff = maxLocalSeq();
  const changes: SyncChange[] = [];
  for (const mark of marks) {
    if (!syncTable(mark.entity)) continue;
    // Zeilen mit offenem Konflikt warten auf die Entscheidung des Benutzers.
    if (hasConflict(mark.entity, mark.rowId)) continue;
    const row = readRow(mark.entity, mark.rowId);
    const base = readBase(mark.entity, mark.rowId);
    if (!row && !base) continue; // angelegt und wieder gelöscht — nie beim Server
    changes.push({
      entity: mark.entity,
      rowId: mark.rowId,
      op: !row ? "delete" : base ? "update" : "insert",
      row,
      base,
    });
  }
  if (changes.length === 0) {
    clearMarksUpTo(cutoff);
    return false;
  }

  // In Paketen, damit ein langer Offline-Zeitraum den Server nicht mit einer
  // einzigen riesigen Anfrage überfährt.
  for (let i = 0; i < changes.length; i += 500) {
    const batch = changes.slice(i, i + 500);
    const result = await server.sync.push.mutate({
      deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: batch,
    });

    for (const outcome of result.outcomes) {
      const { entity, rowId } = outcome;
      // Wurde die Zeile inzwischen erneut geändert, gilt die neue Fassung;
      // dann nur die Basis nachziehen, damit der nächste Push richtig mischt.
      const stale = changedAfter(entity, rowId, cutoff);

      if (outcome.status === "conflict" && outcome.conflict) {
        const conflict = outcome.conflict;
        recordConflict(conflict);
        // Vorerst gilt der Stand aus dem Heimnetz — die eigene Fassung ist im
        // Konflikt festgehalten und geht nicht verloren. So bleibt die lokale
        // Datenbank widerspruchsfrei, bis der Benutzer entschieden hat.
        if (conflict.theirs) {
          applyRemoteRow(entity, conflict.theirs);
        } else if (conflict.kind === "deleted-remote") {
          removeRemoteRow(entity, rowId);
        }
        // Bei „keine Berechtigung" gibt es keinen Serverstand, der gelten
        // könnte — die lokale Zeile bleibt unangetastet, bis der Benutzer
        // entscheidet. Sie hier zu löschen wäre stiller Datenverlust.
        continue;
      }

      if (outcome.status === "skipped") continue;

      if (outcome.status === "merged") {
        recordMerge(
          entity,
          rowId,
          outcome.mergedMine ?? [],
          outcome.mergedTheirs ?? []
        );
      }

      if (outcome.row === null || outcome.row === undefined) {
        withTriggersSuspended(getDb(), () => writeBase(entity, rowId, null));
        continue;
      }
      if (stale) {
        withTriggersSuspended(getDb(), () =>
          writeBase(entity, rowId, outcome.row as SyncRow)
        );
      } else {
        applyRemoteRow(entity, outcome.row);
      }
    }
  }

  clearMarksUpTo(cutoff);
  return true;
}

/* ──────────────────────────────── Pull ───────────────────────────────────── */

async function pullRemoteChanges(deviceId: string): Promise<boolean> {
  const since = await loadCursor();
  const result = await server.sync.pull.query({
    deviceId,
    since,
    protocolVersion: SYNC_PROTOCOL_VERSION,
  });

  let touched = false;
  for (const change of result.changes) {
    const table = syncTable(change.entity);
    if (!table) continue;

    if (result.full) {
      touched = applySnapshot(change.entity, change.upserts) || touched;
      continue;
    }
    for (const row of change.upserts) {
      const rowId = String(row[table.pk]);
      if (isLocallyOwned(change.entity, rowId)) {
        continue;
      }
      applyRemoteRow(change.entity, row);
      touched = true;
    }
    for (const rowId of change.removed) {
      if (isLocallyOwned(change.entity, rowId)) continue;
      removeRemoteRow(change.entity, rowId);
      touched = true;
    }
  }

  // Erst das Datenbank-Abbild sichern, dann den Stand quittieren: Bricht der
  // Worker dazwischen ab, wird derselbe Ausschnitt einfach noch einmal geholt.
  // Andersherum wäre der Cursor weiter als die Daten — und beim allerersten
  // Abgleich stünde `bootstrapped` über einer leeren Replik, aus der die App
  // auf eine nötige Ersteinrichtung schlösse.
  await flushDatabase();
  await saveCursor(result.seq);
  await markBootstrapped();
  return touched;
}

/**
 * Zeilen mit eigener, noch nicht übertragener Änderung bleiben unangetastet.
 * Ihre Basis darf **nicht** nachgezogen werden: Der Drei-Wege-Vergleich
 * braucht den gemeinsamen Ausgangspunkt, sonst sähe die Serveränderung wie
 * eine eigene aus und würde zurückgedreht.
 */
function isLocallyOwned(entity: string, rowId: string): boolean {
  return (
    hasConflict(entity, rowId) ||
    Boolean(
      rawClient(getDb())
        .prepare(
          "SELECT 1 AS hit FROM sync_log WHERE entity = ? AND row_id = ? LIMIT 1"
        )
        .get(entity, rowId)
    )
  );
}

/**
 * Vollständiger Abgleich einer Tabelle: übernehmen, was der Server schickt,
 * und lokal wegwerfen, was er nicht mehr kennt (weil gelöscht oder nicht mehr
 * sichtbar). Tabellen mit `snapshotLimit` werden nur ergänzt — von ihnen
 * schickt der Server bewusst nur den jüngsten Ausschnitt.
 */
function applySnapshot(
  entity: string,
  rows: Record<string, unknown>[]
): boolean {
  const table = syncTable(entity);
  if (!table) return false;
  const incoming = new Set(rows.map(row => String(row[table.pk])));

  withTriggersSuspended(getDb(), () => {
    if (!table.snapshotLimit) {
      const existing = selectAll(getDb(), table.name, table.pk);
      for (const row of existing) {
        const rowId = String(row[table.pk]);
        if (incoming.has(rowId)) continue;
        if (isLocallyOwned(entity, rowId)) continue;
        rawClient(getDb())
          .prepare(`DELETE FROM ${table.name} WHERE ${table.pk} = ?`)
          .run(row[table.pk]);
        writeBase(entity, rowId, null);
      }
    }
    for (const row of rows) {
      const rowId = String(row[table.pk]);
      if (isLocallyOwned(entity, rowId)) continue;
      applyRemoteRow(entity, row);
    }
  });
  return rows.length > 0;
}

/* ─────────────────────────── Lokale Daten verwerfen ──────────────────────── */

/** Notbremse: lokale Replik leeren und beim nächsten Start neu aufbauen */
export async function resetReplica(): Promise<void> {
  await ensureDatabase();
  withTriggersSuspended(getDb(), () => {
    const raw = rawClient(getDb());
    for (const table of SYNC_TABLES) {
      raw.prepare(`DELETE FROM ${table.name}`).run();
    }
    raw.prepare("DELETE FROM sync_log").run();
    raw.prepare("DELETE FROM sync_base").run();
    raw.prepare("DELETE FROM sync_conflicts").run();
    raw.prepare("DELETE FROM sync_merges").run();
    raw.prepare("DELETE FROM sync_blobs").run();
  });
  // Die Anhang-Dateien liegen nicht in der Datenbank — ohne diesen Schritt
  // blieben Belege, Vorsorge- und Versicherungsdokumente auf dem Gerät.
  await clearAttachmentBlobs();
  await flushDatabase();
  await saveCursor(0);
  await saveDevice(null);
  await clearBootstrapped();
}
