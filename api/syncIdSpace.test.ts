import { beforeAll, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { rawClient } from "./lib/sync/store";
import {
  assignInsertIds,
  createIdAllocator,
  deviceIdSpace,
  ID_BLOCK_BASE,
  ID_BLOCK_SIZE,
  SERVER_ID_SPACE,
} from "@db/idSpace";
import { banks } from "@db/schema";
import * as schema from "@db/schema";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { SYNC_TABLES } from "./lib/sync/tables";

/**
 * Die ID-Vergabe ist die Voraussetzung dafür, dass Heimserver und Geräte
 * gleichzeitig schreiben dürfen. Geht sie kaputt, bekommen zwei verschiedene
 * Buchungen dieselbe ID — und die eine überschreibt beim Abgleich die andere,
 * ohne dass jemand etwas merkt. Deshalb hier ausführlich geprüft.
 */

const DEVICE_1 = ID_BLOCK_BASE + ID_BLOCK_SIZE;
const DEVICE_2 = ID_BLOCK_BASE + 2 * ID_BLOCK_SIZE;

beforeAll(async () => {
  await initDb();
  ensureSchema();
});

describe("assignInsertIds", () => {
  const fixed = (start: number) => {
    let n = start;
    return { next: () => ++n, setSpace: () => {}, reset: () => {} };
  };

  it("ersetzt den id-Platzhalter eines Drizzle-Inserts", () => {
    const sql = 'insert into "banks" ("id", "name") values (null, ?)';
    expect(assignInsertIds(sql, fixed(100))).toBe(
      'insert into "banks" ("id", "name") values (101, ?)'
    );
  });

  it("vergibt bei mehreren Zeilen je eine eigene ID", () => {
    const sql =
      'insert into "banks" ("id", "name") values (null, ?), (null, ?)';
    expect(assignInsertIds(sql, fixed(100))).toBe(
      'insert into "banks" ("id", "name") values (101, ?), (102, ?)'
    );
  });

  it("lässt null-Werte anderer Spalten unangetastet", () => {
    const sql =
      'insert into "accounts" ("id", "name", "bank_id", "iban") values (null, ?, null, null)';
    expect(assignInsertIds(sql, fixed(7))).toBe(
      'insert into "accounts" ("id", "name", "bank_id", "iban") values (8, ?, null, null)'
    );
  });

  it("rührt ausdrücklich gesetzte IDs nicht an", () => {
    const sql = 'insert into "banks" ("id", "name") values (?, ?)';
    expect(assignInsertIds(sql, fixed(100))).toBe(sql);
  });

  it("ignoriert Inserts ohne id-Spalte (Abgleich, ensureSchema)", () => {
    const sql =
      "INSERT INTO account_types (key, name, builtin) VALUES ('a', 'A', 1)";
    expect(assignInsertIds(sql, fixed(100))).toBe(sql);
  });
});

describe("Zahlenräume", () => {
  it("beginnt im Geräteblock, nicht bei 1", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(
      "CREATE TABLE banks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)"
    );
    const ids = createIdAllocator(() => db, deviceIdSpace(DEVICE_1));
    expect(ids.next("banks")).toBe(DEVICE_1);
    expect(ids.next("banks")).toBe(DEVICE_1 + 1);
  });

  it("zählt nur eigene IDs — fremde Blöcke ziehen den Zähler nicht mit", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(
      "CREATE TABLE banks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)"
    );
    // Zeilen vom Server und von einem zweiten Gerät
    db.run("INSERT INTO banks (id, name) VALUES (17, 'Server')");
    db.run(
      `INSERT INTO banks (id, name) VALUES (${DEVICE_2 + 500}, 'Gerät 2')`
    );
    db.run(`INSERT INTO banks (id, name) VALUES (${DEVICE_1 + 3}, 'Eigene')`);

    const ids = createIdAllocator(() => db, deviceIdSpace(DEVICE_1));
    const next = ids.next("banks");
    expect(next).toBe(DEVICE_1 + 4);
    expect(next).toBeGreaterThanOrEqual(DEVICE_1);
    expect(next).toBeLessThan(DEVICE_1 + ID_BLOCK_SIZE);
  });

  it("hält den Server unterhalb aller Geräteblöcke, auch nach einem Push", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(
      "CREATE TABLE banks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)"
    );
    db.run("INSERT INTO banks (id, name) VALUES (12, 'Server')");
    // Ein Gerät hat gepusht — SQLites AUTOINCREMENT wäre danach bei 1002…
    db.run(
      `INSERT INTO banks (id, name) VALUES (${DEVICE_2 + 900}, 'Gepusht')`
    );

    const ids = createIdAllocator(() => db, SERVER_ID_SPACE);
    expect(ids.next("banks")).toBe(13);
  });
});

describe("Zusammenspiel mit Drizzle", () => {
  it("vergibt über den echten Proxy IDs aus dem Server-Raum", async () => {
    const rows = await getDb()
      .insert(banks)
      .values({ name: `Bank ${Math.random()}` })
      .returning({ id: banks.id });
    expect(rows[0].id).toBeGreaterThan(0);
    expect(rows[0].id).toBeLessThan(ID_BLOCK_BASE);
  });

  it("bleibt im Server-Raum, obwohl eine Geräte-Zeile eingespielt wurde", async () => {
    rawClient(getDb())
      .prepare("INSERT INTO banks (id, name) VALUES (?, ?)")
      .run(DEVICE_2 + 4711, "Vom Gerät");
    const rows = await getDb()
      .insert(banks)
      .values({ name: `Bank ${Math.random()}` })
      .returning({ id: banks.id });
    expect(rows[0].id).toBeLessThan(ID_BLOCK_BASE);
  });
});

describe("Voraussetzung der ID-Vergabe", () => {
  it("führt jede abgeglichene Tabelle mit `id` als erster Spalte", () => {
    // `assignInsertIds` erkennt Drizzles Inserts an `insert into "t" ("id",`.
    // Rutscht `id` in `db/schema.ts` an eine andere Stelle, greift die
    // Erkennung stillschweigend nicht mehr — und die Vergabe fiele auf
    // SQLites AUTOINCREMENT zurück, also genau auf die Kollision zwischen
    // zwei Geräten, die dieses Modul verhindern soll. Deshalb hier festgehalten.
    const byName = new Map<string, SQLiteTable>();
    for (const value of Object.values(schema)) {
      if (is(value, SQLiteTable)) byName.set(getTableName(value), value);
    }

    const wrong: string[] = [];
    for (const table of SYNC_TABLES) {
      if (table.pkType !== "integer") continue;
      const drizzleTable = byName.get(table.name);
      expect(drizzleTable, `${table.name} fehlt in db/schema.ts`).toBeDefined();
      const first = Object.values(getTableColumns(drizzleTable!))[0];
      if (first.name !== table.pk) wrong.push(`${table.name} → ${first.name}`);
    }
    expect(wrong).toEqual([]);
  });
});
