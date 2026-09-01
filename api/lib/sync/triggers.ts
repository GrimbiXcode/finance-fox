import { SYNC_TABLES } from "./tables";

/**
 * Änderungsverfolgung per SQLite-Trigger.
 *
 * Das Schema kennt weder `updated_at` noch Tombstones, und die Lösch-Kaskaden
 * sind von Hand geschrieben (`deleteAccount`, `resetFinanceData`, …). Statt 43
 * Tabellen um Spalten zu erweitern und jeden Schreibpfad einzeln anzufassen,
 * protokolliert die Datenbank sich selbst: Trigger greifen unterhalb des
 * Anwendungscodes und können deshalb **keinen** Schreibpfad verpassen.
 *
 * Beide Seiten benutzen dieselben Trigger und dieselbe Tabelle `sync_log`,
 * lesen sie aber verschieden: Auf dem Server ist sie der fortlaufende Feed, aus
 * dem `pull` das Delta schneidet; in der lokalen Replik ist sie die Liste der
 * noch nicht übertragenen Änderungen, die `push` abarbeitet und danach löscht.
 *
 * `sync_guard` schaltet die Trigger vorübergehend ab. Ohne das würde jede vom
 * Server geholte Zeile beim Einspielen als lokale Änderung gelten und beim
 * nächsten Push zurückgeschickt.
 */

/** Zeitstempel in Millisekunden — SQLite kennt nur Sekunden von Haus aus */
const NOW_MS = "CAST(strftime('%s','now') AS INTEGER) * 1000";

const GUARD_OFF = "(SELECT suspended FROM sync_guard WHERE id = 1) = 0";

function triggerFor(
  table: string,
  pk: string,
  event: "INSERT" | "UPDATE" | "DELETE"
): string[] {
  const suffix = event === "INSERT" ? "ai" : event === "UPDATE" ? "au" : "ad";
  const name = `sync_${suffix}_${table}`;
  const rowRef = event === "DELETE" ? "OLD" : "NEW";
  const op =
    event === "INSERT" ? "insert" : event === "UPDATE" ? "update" : "delete";
  return [
    `DROP TRIGGER IF EXISTS ${name}`,
    `CREATE TRIGGER ${name} AFTER ${event} ON ${table}
     WHEN ${GUARD_OFF}
     BEGIN
       INSERT INTO sync_log (entity, row_id, op, changed_at)
       VALUES ('${table}', CAST(${rowRef}.${pk} AS TEXT), '${op}', ${NOW_MS});
     END`,
  ];
}

/**
 * Alle Trigger-Anweisungen, in der Reihenfolge zum Ausführen.
 * Bewusst immer DROP + CREATE: `ensureSchema` läuft bei jedem Start, und so
 * wirken Änderungen an der Registry sofort — ohne Migrationsschritt.
 */
export function syncTriggerStatements(): string[] {
  const stmts: string[] = [];
  for (const table of SYNC_TABLES) {
    stmts.push(...triggerFor(table.name, table.pk, "INSERT"));
    stmts.push(...triggerFor(table.name, table.pk, "UPDATE"));
    stmts.push(...triggerFor(table.name, table.pk, "DELETE"));
  }
  return stmts;
}
