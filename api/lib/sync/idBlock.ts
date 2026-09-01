import type { Db } from "../../queries/connection";
import { rawClient } from "./store";
import { SYNC_TABLES } from "./tables";

/**
 * Eigener ID-Raum je Gerät — ohne eine einzige Änderung am Schema.
 *
 * Alle Tabellen vergeben ihre IDs per `INTEGER PRIMARY KEY AUTOINCREMENT`.
 * Zwei schreibende Repliken würden damit sofort dieselben IDs vergeben. Statt
 * das Schema auf UUIDs umzustellen (jede Tabelle, jede Fremdschlüsselspalte,
 * jede Abfrage) bekommt jedes Gerät vom Server einen eigenen Zahlenblock und
 * setzt hier den AUTOINCREMENT-Zähler darauf.
 *
 * Der Zähler steht bei AUTOINCREMENT-Tabellen in `sqlite_sequence`; SQLite
 * erlaubt Anwendungen ausdrücklich, ihn zu setzen. Ab da vergibt **jedes**
 * lokale INSERT eine global eindeutige ID — ohne dass der Anwendungscode etwas
 * davon wissen muss und ohne dass beim Abgleich je eine ID umgeschrieben
 * werden müsste.
 *
 * Vom Server geholte Zeilen tragen kleine IDs unterhalb des Blocks und heben
 * den Zähler deshalb nicht an.
 */
export function seedIdBlock(db: Db, blockStart: number): void {
  const raw = rawClient(db);
  for (const table of SYNC_TABLES) {
    if (table.pkType !== "integer") continue;
    const current = raw
      .prepare("SELECT seq FROM sqlite_sequence WHERE name = ?")
      .get(table.name);
    if (current === null || current === undefined) {
      raw
        .prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)")
        .run(table.name, blockStart);
      continue;
    }
    // Niemals zurückdrehen: Der Zähler ist bereits im Block, sobald das Gerät
    // eigene Zeilen angelegt hat.
    if (Number(current.seq) < blockStart) {
      raw
        .prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?")
        .run(blockStart, table.name);
    }
  }
}
