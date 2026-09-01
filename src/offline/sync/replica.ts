import { getDb } from "../db/connection";
import type { SyncRow } from "../../../api/lib/sync/merge";
import {
  deleteById,
  rawClient,
  readBaseRow,
  selectById,
  upsertRow,
  withTriggersSuspended,
  writeBaseRow,
} from "../../../api/lib/sync/store";
import { syncTable } from "../../../api/lib/sync/tables";
import type { SyncRowPayload } from "@contracts/offline";

/**
 * Schreibzugriffe der Replik auf ihre eigene SQLite-Datenbank: eingespielte
 * Serverzeilen, die Merge-Basis, offene Konflikte und das Merge-Protokoll.
 *
 * Alles, was vom Server kommt, wird mit **abgeschalteten Triggern**
 * geschrieben — sonst gälte jede geholte Zeile als lokale Änderung und liefe
 * beim nächsten Abgleich zurück zum Server.
 */

function raw() {
  return rawClient(getDb());
}

function pk(entity: string, rowId: string): string | number {
  return syncTable(entity)?.pkType === "text" ? rowId : Number(rowId);
}

/* ───────────────────────────── Merge-Basis ───────────────────────────────── */

export function readBase(entity: string, rowId: string): SyncRow | null {
  return readBaseRow(getDb(), entity, rowId);
}

export function writeBase(
  entity: string,
  rowId: string,
  payload: SyncRow | null
) {
  writeBaseRow(getDb(), entity, rowId, payload);
}

/* ─────────────────────── Zeilen einspielen und löschen ───────────────────── */

/** Zeile vom Server übernehmen und als neue Merge-Basis merken */
export function applyRemoteRow(entity: string, row: SyncRowPayload) {
  const table = syncTable(entity);
  if (!table) return;
  const rowId = String(row[table.pk]);
  withTriggersSuspended(getDb(), () => {
    upsertRow(getDb(), table.name, table.pk, row as SyncRow);
    writeBase(entity, rowId, row as SyncRow);
  });
}

/** Zeile entfernen, weil sie gelöscht wurde oder nicht mehr sichtbar ist */
export function removeRemoteRow(entity: string, rowId: string) {
  const table = syncTable(entity);
  if (!table) return;
  withTriggersSuspended(getDb(), () => {
    deleteById(getDb(), table.name, table.pk, pk(entity, rowId));
    writeBase(entity, rowId, null);
  });
}

export function readRow(entity: string, rowId: string): SyncRow | null {
  const table = syncTable(entity);
  if (!table) return null;
  return selectById(getDb(), table.name, table.pk, pk(entity, rowId));
}

/* ────────────────────────── Lokale Änderungen ────────────────────────────── */

export type LocalMark = { entity: string; rowId: string; seq: number };

/** Noch nicht übertragene lokale Änderungen, je Zeile der jüngste Vermerk */
export function pendingMarks(): LocalMark[] {
  return raw()
    .prepare(
      `SELECT entity, row_id AS rowId, MAX(seq) AS seq
         FROM sync_log GROUP BY entity, row_id ORDER BY seq`
    )
    .all() as unknown as LocalMark[];
}

export function pendingCount(): number {
  return Number(
    raw()
      .prepare(
        "SELECT COUNT(*) AS n FROM (SELECT 1 FROM sync_log GROUP BY entity, row_id)"
      )
      .get()?.n ?? 0
  );
}

/** Hat sich diese Zeile seit dem Aufbau des Pakets noch einmal geändert? */
export function changedAfter(
  entity: string,
  rowId: string,
  seq: number
): boolean {
  const row = raw()
    .prepare(
      "SELECT 1 AS hit FROM sync_log WHERE entity = ? AND row_id = ? AND seq > ? LIMIT 1"
    )
    .get(entity, rowId, seq);
  return Boolean(row);
}

/** Übertragene Vermerke wegwerfen — spätere bleiben stehen */
export function clearMarksUpTo(seq: number) {
  raw().prepare("DELETE FROM sync_log WHERE seq <= ?").run(seq);
}

export function maxLocalSeq(): number {
  return Number(
    raw().prepare("SELECT MAX(seq) AS seq FROM sync_log").get()?.seq ?? 0
  );
}

/* ────────────────────────────── Konflikte ────────────────────────────────── */

export function recordConflict(conflict: {
  entity: string;
  rowId: string;
  kind: string;
  fields: string[];
  base: SyncRowPayload | null;
  mine: SyncRowPayload | null;
  theirs: SyncRowPayload | null;
  detail: string;
}) {
  withTriggersSuspended(getDb(), () => {
    raw()
      .prepare(
        `INSERT INTO sync_conflicts
           (entity, row_id, kind, base, mine, theirs, fields, detail, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (entity, row_id) DO UPDATE SET
           kind = excluded.kind, base = excluded.base, mine = excluded.mine,
           theirs = excluded.theirs, fields = excluded.fields,
           detail = excluded.detail, detected_at = excluded.detected_at`
      )
      .run(
        conflict.entity,
        conflict.rowId,
        conflict.kind,
        conflict.base === null ? null : JSON.stringify(conflict.base),
        conflict.mine === null ? null : JSON.stringify(conflict.mine),
        conflict.theirs === null ? null : JSON.stringify(conflict.theirs),
        JSON.stringify(conflict.fields),
        conflict.detail,
        Date.now()
      );
  });
}

export function conflictCount(): number {
  return Number(
    raw().prepare("SELECT COUNT(*) AS n FROM sync_conflicts").get()?.n ?? 0
  );
}

/** Zeile mit offenem Konflikt? Solche Zeilen darf ein Pull nicht anfassen. */
export function hasConflict(entity: string, rowId: string): boolean {
  return Boolean(
    raw()
      .prepare(
        "SELECT 1 AS hit FROM sync_conflicts WHERE entity = ? AND row_id = ?"
      )
      .get(entity, rowId)
  );
}

export function dropConflict(entity: string, rowId: string) {
  withTriggersSuspended(getDb(), () => {
    raw()
      .prepare("DELETE FROM sync_conflicts WHERE entity = ? AND row_id = ?")
      .run(entity, rowId);
  });
}

/* ─────────────────────────── Merge-Protokoll ─────────────────────────────── */

export function recordMerge(
  entity: string,
  rowId: string,
  mineFields: string[],
  theirFields: string[]
) {
  withTriggersSuspended(getDb(), () => {
    raw()
      .prepare(
        `INSERT INTO sync_merges
           (entity, row_id, mine_fields, their_fields, merged_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        entity,
        rowId,
        JSON.stringify(mineFields),
        JSON.stringify(theirFields),
        Date.now()
      );
  });
}
