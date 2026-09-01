import { beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { seedIdBlock } from "./lib/sync/idBlock";
import { rawClient } from "./lib/sync/store";

/**
 * Der ID-Block ist die Stelle, an der der Abgleich ohne Schema-Umbau
 * auskommt: Jedes Gerät vergibt IDs in einem eigenen Zahlenraum. Geht das
 * kaputt, kollidieren zwei Geräte still miteinander — deshalb hier geprüft.
 */

const BLOCK = 1_000_000_000_000;

beforeAll(async () => {
  await initDb();
  ensureSchema();
});

function insertBank(name: string): number {
  return Number(
    rawClient(getDb()).prepare("INSERT INTO banks (name) VALUES (?)").run(name)
      .lastInsertRowid
  );
}

describe("ID-Block", () => {
  it("vergibt nach dem Setzen IDs innerhalb des Blocks", () => {
    seedIdBlock(getDb(), BLOCK);
    const id = insertBank("Bank im Block");
    expect(id).toBeGreaterThan(BLOCK);
    expect(id).toBeLessThan(BLOCK + 1_000_000);
  });

  it("bleibt auch nach mehreren Einfügungen im Block", () => {
    seedIdBlock(getDb(), BLOCK);
    const first = insertBank("Bank A");
    const second = insertBank("Bank B");
    expect(second).toBe(first + 1);
  });

  it("wird von eingespielten Server-Zeilen nicht zurückgesetzt", () => {
    seedIdBlock(getDb(), BLOCK);
    const before = insertBank("Vor dem Abgleich");
    // Eine vom Server geholte Zeile trägt ihre kleine Original-ID.
    rawClient(getDb())
      .prepare("INSERT INTO banks (id, name) VALUES (?, ?)")
      .run(17, "Bank vom Server");
    const after = insertBank("Nach dem Abgleich");
    expect(after).toBe(before + 1);
  });

  it("dreht einen bereits höheren Zähler nicht zurück", () => {
    seedIdBlock(getDb(), BLOCK);
    const high = insertBank("Hoch");
    seedIdBlock(getDb(), BLOCK);
    const next = insertBank("Danach");
    expect(next).toBe(high + 1);
  });

  it("greift für jede synchronisierte Tabelle, nicht nur für die erste", () => {
    seedIdBlock(getDb(), BLOCK);
    const id = Number(
      rawClient(getDb())
        .prepare(
          `INSERT INTO categories (name, type, color) VALUES ('Test', 'expense', '#000')`
        )
        .run().lastInsertRowid
    );
    expect(id).toBeGreaterThan(BLOCK);
  });
});
