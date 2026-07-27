import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { buildSessionCookie } from "./lib/session";
import { users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";
import app from "./boot";

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  color: "#10b981",
};
const member: SessionUser = {
  id: 2,
  email: "member@example.com",
  name: "Mitglied",
  role: "member",
  color: "#6366f1",
};

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

let sharedAccountId = 0;
let privateAccountId = 0;
let catFoodId = 0;
let catSalaryId = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  // Nutzer echt in der DB: die Backup-Routen lösen das Session-Cookie
  // gegen die users-Tabelle auf.
  await db.insert(users).values([
    {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: "admin",
      color: admin.color,
      createdAt: new Date(),
    },
    {
      id: member.id,
      email: member.email,
      name: member.name,
      role: "member",
      color: member.color,
      createdAt: new Date(),
    },
  ]);

  const adminCaller = callerFor(admin);
  await adminCaller.finance.createAccount({
    name: "Gemeinschaftskonto",
    type: "checking",
    initialBalance: 0,
    private: false,
  });
  await adminCaller.finance.createAccount({
    name: "Privatkonto",
    type: "checking",
    initialBalance: 0,
    private: true,
  });
  const accs = await adminCaller.finance.listAccounts();
  sharedAccountId = accs.find(a => a.name === "Gemeinschaftskonto")!.id;
  privateAccountId = accs.find(a => a.name === "Privatkonto")!.id;

  await adminCaller.finance.createCategory({
    name: "Lebensmittel",
    type: "expense",
    color: "#ff0000",
  });
  await adminCaller.finance.createCategory({
    name: "Gehalt",
    type: "income",
    color: "#00ff00",
  });
  const cats = await adminCaller.finance.listCategories();
  catFoodId = cats.find(c => c.name === "Lebensmittel")!.id;
  catSalaryId = cats.find(c => c.name === "Gehalt")!.id;

  await adminCaller.finance.createTransaction({
    type: "income",
    accountId: sharedAccountId,
    amount: 250000,
    categoryId: catSalaryId,
    userId: admin.id,
    date: "2026-01-01",
    note: "",
  });
  await adminCaller.finance.createTransaction({
    type: "expense",
    accountId: sharedAccountId,
    amount: 1234,
    categoryId: catFoodId,
    userId: admin.id,
    date: "2026-01-15",
    note: 'Einkauf; "Wochenende"',
  });
  await adminCaller.finance.createTransaction({
    type: "transfer",
    accountId: sharedAccountId,
    toAccountId: privateAccountId,
    amount: 50000,
    userId: admin.id,
    date: "2026-01-20",
    note: "",
  });
  // Nur auf dem privaten Konto — für das Mitglied unsichtbar
  await adminCaller.finance.createTransaction({
    type: "expense",
    accountId: privateAccountId,
    amount: 999,
    userId: admin.id,
    date: "2026-01-10",
    note: "Geheim",
  });
});

describe("CSV-Export", () => {
  it("liefert Kopfzeile, Dezimalkomma und RFC-4180-Escaping", async () => {
    const csv = await callerFor(admin).finance.exportTransactionsCsv();
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Datum;Typ;Betrag;Kategorie;Konto;Zielkonto;Notiz");
    // Sortiert nach Datum: Gehalt (01-01), Geheim (01-10), Einkauf (01-15)
    expect(lines[1]).toBe(
      "2026-01-01;Einnahme;2500,00;Gehalt;Gemeinschaftskonto;;"
    );
    expect(lines[2]).toBe("2026-01-10;Ausgabe;9,99;;Privatkonto;;Geheim");
    expect(lines[3]).toBe(
      "2026-01-15;Ausgabe;12,34;Lebensmittel;Gemeinschaftskonto;;" +
        '"Einkauf; ""Wochenende"""'
    );
    expect(lines[4]).toBe(
      "2026-01-20;Umbuchung;500,00;;Gemeinschaftskonto;Privatkonto;"
    );
    expect(lines).toHaveLength(5);
  });

  it("filtert unsichtbare Transaktionen (Sichtbarkeitsregeln)", async () => {
    const csv = await callerFor(member).finance.exportTransactionsCsv();
    const lines = csv.split("\r\n");
    // 3 sichtbare Buchungen: die private Ausgabe fehlt, die Umbuchung
    // bleibt sichtbar (Quellkonto sichtbar)
    expect(lines).toHaveLength(4);
    expect(csv).not.toContain("Geheim");
    expect(csv).toContain("Umbuchung");
  });

  it("exportiert mit Locale en-US komma-getrennt mit Dezimalpunkt", async () => {
    const csv = await callerFor(admin).finance.exportTransactionsCsv({
      locale: "en-US",
    });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Datum,Typ,Betrag,Kategorie,Konto,Zielkonto,Notiz");
    expect(lines[1]).toBe(
      "2026-01-01,Einnahme,2500.00,Gehalt,Gemeinschaftskonto,,"
    );
    expect(lines[2]).toBe("2026-01-10,Ausgabe,9.99,,Privatkonto,,Geheim");
    // Notiz mit Anführungszeichen bleibt RFC-4180-gequotet
    expect(lines[3]).toBe(
      "2026-01-15,Ausgabe,12.34,Lebensmittel,Gemeinschaftskonto,," +
        '"Einkauf; ""Wochenende"""'
    );
    expect(lines[4]).toBe(
      "2026-01-20,Umbuchung,500.00,,Gemeinschaftskonto,Privatkonto,"
    );
    expect(lines).toHaveLength(5);
  });
});

describe("CSV-Import", () => {
  it("Roundtrip: exportierte CSV wird wieder importiert", async () => {
    const csv = await callerFor(admin).finance.exportTransactionsCsv();
    const before = await callerFor(admin).finance.listTransactions();
    const result = await callerFor(admin).finance.importTransactionsCsv({
      csv,
      accountId: sharedAccountId,
    });
    // 4 Zeilen: 3 importiert (Einnahme/Ausgaben), 1 Umbuchung übersprungen
    expect(result).toEqual({ imported: 3, skipped: 1, errors: [] });
    const after = await callerFor(admin).finance.listTransactions();
    expect(after).toHaveLength(before.length + 3);
    // Kategorie wurde per Namens-Match zugeordnet
    const importedTx = after.find(
      t =>
        t.date === "2026-01-15" &&
        t.userId === admin.id &&
        t.amount === 1234 &&
        t.categoryId === catFoodId &&
        t.note === 'Einkauf; "Wochenende"'
    );
    expect(importedTx).toBeDefined();
  });

  it("überspringt fehlerhafte Zeilen und meldet sie mit Zeilennummer", async () => {
    const csv = [
      "Datum;Typ;Betrag;Kategorie;Konto;Zielkonto;Notiz",
      "2026-13-01;Ausgabe;10,00;Lebensmittel;;;",
      "2026-01-05;Ausgabe;abc;;;;",
      "2026-01-06;Ausgabe;10.50;Unbekannt;;;",
      "2026-01-07;Umbuchung;20,00;;;;",
      "2026-01-08;Foo;5,00;;;;",
    ].join("\r\n");
    const result = await callerFor(admin).finance.importTransactionsCsv({
      csv,
      accountId: sharedAccountId,
    });
    // Nur die Zeile mit Dezimalpunkt wird importiert (Kategorie unbekannt → null)
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(4);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toContain("Zeile 2");
    expect(result.errors[0]).toContain("ungültiges Datum");
    expect(result.errors[1]).toContain("Zeile 3");
    expect(result.errors[1]).toContain("ungültiger Betrag");
    expect(result.errors[2]).toContain("Zeile 6");
    expect(result.errors[2]).toContain("unbekannter Typ");
  });

  it("erkennt Komma als Trennzeichen automatisch an der Kopfzeile", async () => {
    const csv = [
      "Datum,Typ,Betrag,Kategorie,Konto,Zielkonto,Notiz",
      "2026-02-01,Ausgabe,10.50,Lebensmittel,,,\"Notiz, mit Komma\"",
      "2026-02-02,Einnahme,99,,,,",
    ].join("\r\n");
    const result = await callerFor(admin).finance.importTransactionsCsv({
      csv,
      accountId: sharedAccountId,
    });
    expect(result).toEqual({ imported: 2, skipped: 0, errors: [] });
    const txs = await callerFor(admin).finance.listTransactions();
    const withNote = txs.find(
      t => t.date === "2026-02-01" && t.note === "Notiz, mit Komma"
    );
    expect(withNote?.amount).toBe(1050);
    expect(withNote?.categoryId).toBe(catFoodId);
    // Ganzzahliger Betrag (99 €) wird ebenfalls korrekt gelesen
    expect(txs.some(t => t.date === "2026-02-02" && t.amount === 9900)).toBe(
      true
    );
  });

  it("verweigert den Import ohne Edit-Recht auf das Konto", async () => {
    const csv = "Datum;Typ;Betrag\r\n2026-01-01;Ausgabe;1,00";
    await expect(
      callerFor(member).finance.importTransactionsCsv({
        csv,
        accountId: privateAccountId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Backup/Restore (HTTP-Routen)", () => {
  it("verweigert den Download ohne Admin-Session", async () => {
    const ohneCookie = await app.request("/api/backup");
    expect(ohneCookie.status).toBe(403);
    const alsMitglied = await app.request("/api/backup", {
      headers: { cookie: buildSessionCookie(member.id, false) },
    });
    expect(alsMitglied.status).toBe(403);
  });

  it("liefert als Admin eine SQLite-Datei mit Dateinamen", async () => {
    const res = await app.request("/api/backup", {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(
      "application/octet-stream"
    );
    expect(res.headers.get("content-disposition")).toMatch(
      /filename="finance-fox-backup-\d{4}-\d{2}-\d{2}\.db"/
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    const header = Buffer.from(bytes.subarray(0, 16)).toString("utf-8");
    expect(header).toBe("SQLite format 3\0");
  });

  it("lehnt ungültige Restore-Dateien ab und akzeptiert ein echtes Backup", async () => {
    const cookie = buildSessionCookie(admin.id, false);
    const alsMitglied = await app.request("/api/backup/restore", {
      method: "POST",
      headers: { cookie: buildSessionCookie(member.id, false) },
      body: Buffer.from("irgendwas"),
    });
    expect(alsMitglied.status).toBe(403);

    const ungueltig = await app.request("/api/backup/restore", {
      method: "POST",
      headers: { cookie },
      body: Buffer.from("das ist keine sqlite datei, nur text"),
    });
    expect(ungueltig.status).toBe(400);
    const fehler = (await ungueltig.json()) as { error: string };
    expect(fehler.error).toContain("SQLite");

    const backup = await app.request("/api/backup", { headers: { cookie } });
    const bytes = await backup.arrayBuffer();
    const restore = await app.request("/api/backup/restore", {
      method: "POST",
      headers: { cookie },
      body: bytes,
    });
    expect(restore.status).toBe(200);
    expect(await restore.json()).toEqual({ ok: true });
    // Nach dem Replace arbeitet die App normal weiter
    const txs = await callerFor(admin).finance.listTransactions();
    expect(txs.length).toBeGreaterThan(0);
  });
});
