import { describe, expect, it } from "vitest";
import { changedFields, classifyDelete, merge3 } from "./lib/sync/merge";

/**
 * Der Drei-Wege-Vergleich entscheidet, ob eine offline geänderte Zeile glatt
 * durchläuft, automatisch zusammengeführt wird oder den Benutzer fragen muss.
 * Hier sitzen die Fehler, die in einer Finanz-App am teuersten sind — deshalb
 * ist die Logik rein und vollständig geprüft.
 */

const base = { id: 1, amount: 4530, note: "Migros", category_id: 7 };

describe("changedFields", () => {
  it("findet geänderte Spalten", () => {
    expect(changedFields(base, { ...base, note: "Coop" })).toEqual(["note"]);
  });

  it("meldet nichts, wenn sich nichts geändert hat", () => {
    expect(changedFields(base, { ...base })).toEqual([]);
  });

  it("behandelt fehlende Spalten wie NULL", () => {
    expect(changedFields({ id: 1, note: null }, { id: 1 })).toEqual([]);
  });

  it("wertet Zahl und Ziffernfolge als denselben Wert", () => {
    expect(changedFields({ id: 1, active: 1 }, { id: 1, active: "1" })).toEqual(
      []
    );
  });

  it("erkennt neue Spalten als Änderung", () => {
    expect(changedFields({ id: 1 }, { id: 1, note: "neu" })).toEqual(["note"]);
  });
});

describe("merge3", () => {
  it("übernimmt die eigene Änderung, wenn der Server unverändert ist", () => {
    const mine = { ...base, note: "Coop" };
    const result = merge3(base, mine, base);
    expect(result).toEqual({ kind: "apply", row: mine });
  });

  it("übernimmt den Serverstand, wenn lokal nichts geändert wurde", () => {
    const theirs = { ...base, amount: 5000 };
    const result = merge3(base, { ...base }, theirs);
    expect(result).toEqual({ kind: "apply", row: theirs });
  });

  it("führt verschiedene Felder ohne Rückfrage zusammen", () => {
    const mine = { ...base, note: "Coop" };
    const theirs = { ...base, amount: 5000 };
    const result = merge3(base, mine, theirs);
    expect(result.kind).toBe("merge");
    if (result.kind !== "merge") return;
    expect(result.row).toEqual({ ...base, note: "Coop", amount: 5000 });
    expect(result.mine).toEqual(["note"]);
    expect(result.theirs).toEqual(["amount"]);
  });

  it("fragt nur, wenn dasselbe Feld verschieden geändert wurde", () => {
    const mine = { ...base, amount: 4600 };
    const theirs = { ...base, amount: 5000 };
    const result = merge3(base, mine, theirs);
    expect(result).toEqual({ kind: "conflict", fields: ["amount"] });
  });

  it("ist kein Konflikt, wenn beide dasselbe Feld gleich geändert haben", () => {
    const same = { ...base, amount: 5000 };
    const result = merge3(base, { ...same }, { ...same });
    expect(result.kind).toBe("apply");
  });

  it("nennt bei mehreren Kollisionen alle betroffenen Felder", () => {
    const mine = { ...base, amount: 1, note: "A" };
    const theirs = { ...base, amount: 2, note: "B" };
    const result = merge3(base, mine, theirs);
    expect(result).toEqual({ kind: "conflict", fields: ["amount", "note"] });
  });

  it("kommt ohne Basis aus (Zeile war dem Gerät unbekannt)", () => {
    const mine = { id: 1, note: "A" };
    const theirs = { id: 1, note: "B" };
    const result = merge3(null, mine, theirs);
    expect(result.kind).toBe("conflict");
  });
});

describe("classifyDelete", () => {
  it("löscht, wenn der Server denselben Stand hat", () => {
    expect(classifyDelete(base, { ...base })).toEqual({ kind: "apply" });
  });

  it("löscht, wenn die Zeile ohnehin schon weg ist", () => {
    expect(classifyDelete(base, null)).toEqual({ kind: "apply" });
  });

  it("fragt, wenn die Zeile inzwischen geändert wurde", () => {
    expect(classifyDelete(base, { ...base, amount: 9999 })).toEqual({
      kind: "conflict",
      conflict: "deleted-local",
    });
  });
});
