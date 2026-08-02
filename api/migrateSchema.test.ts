import { beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";

/** PRAGMA/sqlite_master über den rohen Client abfragen (wie in migrate.ts) */
function rawAll(sql: string): unknown[][] {
  const raw = (
    getDb() as unknown as {
      $client: {
        prepare(s: string): { raw(): { all(): unknown[][] } };
      };
    }
  ).$client;
  return raw.prepare(sql).raw().all();
}

// Bestands-DB einer älteren Version nachbauen: die Tabellen existieren
// bereits, aber ohne die später eingeführten Spalten (pension_deductions
// ohne salary_id, accounts ohne owner_id/bank_id/iban).
beforeAll(async () => {
  await initDb();
  const db = getDb();
  db.run(
    `CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      initial_balance INTEGER NOT NULL DEFAULT 0
    )` as never
  );
  db.run(
    `CREATE TABLE pension_deductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      value INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )` as never
  );
  db.run(
    `INSERT INTO pension_deductions
       (user_id, name, mode, value, active, created_at)
     VALUES (1, 'AHV', 'percent', 530, 1, 0)` as never
  );
});

describe("ensureSchema auf Bestands-Datenbanken", () => {
  it("startet ohne Fehler und rüstet pension_deductions.salary_id nach", () => {
    expect(() => ensureSchema()).not.toThrow();

    const cols = rawAll("PRAGMA table_info(pension_deductions)");
    expect(cols.some(c => c[1] === "salary_id")).toBe(true);
  });

  it("rüstet auch ältere accounts-Spalten nach", () => {
    const cols = rawAll("PRAGMA table_info(accounts)").map(c => c[1]);
    expect(cols).toEqual(
      expect.arrayContaining(["owner_id", "bank_id", "iban"])
    );
  });

  it("legt den Index auf salary_id erst nach der Spalte an", () => {
    const idx = rawAll(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'pension_deductions_salary_idx'`
    );
    expect(idx).toHaveLength(1);
  });

  it("erhält bestehende Abzüge als globale Abzüge (salary_id NULL)", () => {
    const rows = rawAll(
      "SELECT name, salary_id FROM pension_deductions ORDER BY id"
    );
    expect(rows).toEqual([["AHV", null]]);
  });

  it("legt die Hypotheken-Tabellen samt Indizes an", () => {
    const tables = rawAll(
      `SELECT name FROM sqlite_master WHERE type = 'table'`
    ).map(t => t[0]);
    expect(tables).toEqual(
      expect.arrayContaining([
        "properties",
        "mortgage_tranches",
        "mortgage_amortizations",
        "mortgage_changes",
      ])
    );

    const indexes = rawAll(
      `SELECT name FROM sqlite_master WHERE type = 'index'`
    ).map(i => i[0]);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "mortgage_tranches_property_idx",
        "mortgage_amort_property_idx",
        "mortgage_changes_created_idx",
      ])
    );
  });

  it("legt die Versicherungs-Tabellen samt Indizes an", () => {
    const tables = rawAll(
      `SELECT name FROM sqlite_master WHERE type = 'table'`
    ).map(t => t[0]);
    expect(tables).toEqual(
      expect.arrayContaining([
        "insurance_policies",
        "insurance_policy_persons",
        "insurance_coverages",
        "insurance_attachments",
        "insurance_changes",
        "insurance_gap_dismissals",
      ])
    );

    const indexes = rawAll(
      `SELECT name FROM sqlite_master WHERE type = 'index'`
    ).map(i => i[0]);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "insurance_policies_branch_idx",
        "insurance_policies_status_idx",
        "insurance_policy_person_unique_idx",
        "insurance_policy_person_policy_idx",
        "insurance_coverages_policy_idx",
        "insurance_att_policy_idx",
        "insurance_changes_created_idx",
      ])
    );
  });

  it("ist idempotent — ein zweiter Lauf ändert nichts", () => {
    expect(() => ensureSchema()).not.toThrow();
    const rows = rawAll("SELECT COUNT(*) FROM pension_deductions");
    expect(rows[0][0]).toBe(1);
  });
});
