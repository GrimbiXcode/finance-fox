import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import {
  accountOwners, accountPermissions, accounts, categories, transactions, users,
} from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const owner: SessionUser = {
  id: 1, email: "owner@example.com", name: "Besitzer", role: "member", color: "#6366f1",
};
const viewer: SessionUser = {
  id: 2, email: "viewer@example.com", name: "Betrachter", role: "member", color: "#f59e0b",
};
const stranger: SessionUser = {
  id: 3, email: "stranger@example.com", name: "Fremder", role: "member", color: "#94a3b8",
};

const ALL_USERS = [owner, viewer, stranger];

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

let nameCounter = 0;

/** Konto direkt in der DB anlegen (eindeutiger Name pro Aufruf) */
async function insertAccount(
  ownerId: number | null,
  initialBalance = 0,
): Promise<number> {
  nameCounter += 1;
  const rows = await getDb().insert(accounts).values({
    name: `Konto ${nameCounter}`,
    type: "checking",
    initialBalance,
    createdAt: new Date(),
  }).returning({ id: accounts.id });
  const id = rows[0].id;
  if (ownerId !== null) {
    await getDb().insert(accountOwners)
      .values({ accountId: id, userId: ownerId });
  }
  return id;
}

async function insertCategory(
  name: string,
  type: "income" | "expense",
  parentId?: number,
): Promise<number> {
  const rows = await getDb().insert(categories).values({
    name,
    type,
    color: "#10b981",
    parentId: parentId ?? null,
  }).returning({ id: categories.id });
  return rows[0].id;
}

/** Heutiges Datum als lokaler ISO-String (wie im Server-Endpunkt berechnet) */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const now = new Date();
  for (const u of ALL_USERS) {
    await getDb().insert(users).values({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      active: true,
      createdAt: now,
    });
  }
});

describe("reconcileAccount", () => {
  it("bucht eine positive Differenz als Einnahme ohne Kategorie", async () => {
    const id = await insertAccount(null, 1000);
    await callerFor(owner).finance.createTransaction({
      type: "expense",
      accountId: id,
      amount: 400,
      userId: owner.id,
      date: "2026-07-01",
      note: "ausgabe",
    });
    // Soll = 600, Ist = 900 → Differenz +300
    const result = await callerFor(owner).finance.reconcileAccount({
      accountId: id,
      actualBalance: 900,
    });
    expect(result).toEqual({ ok: true, difference: 300 });

    const txRow = await getDb().query.transactions.findFirst({
      where: eq(transactions.note, "Kontoabgleich"),
    });
    expect(txRow).toMatchObject({
      type: "income",
      accountId: id,
      amount: 300,
      categoryId: null,
      userId: owner.id,
      date: todayIso(),
    });
    // Saldo stimmt danach mit dem Ist-Saldo überein
    const acc = (await callerFor(owner).finance.listAccounts())
      .find(a => a.id === id);
    expect(acc?.balance).toBe(900);
  });

  it("bucht eine negative Differenz als Ausgabe mit Datum und Notiz", async () => {
    const id = await insertAccount(null, 1000);
    // Soll = 1000, Ist = 750 → Differenz −250
    const result = await callerFor(owner).finance.reconcileAccount({
      accountId: id,
      actualBalance: 750,
      date: "2026-07-15",
      note: "Abgleich mit Kontoauszug",
    });
    expect(result).toEqual({ ok: true, difference: -250 });

    const txRow = await getDb().query.transactions.findFirst({
      where: eq(transactions.note, "Abgleich mit Kontoauszug"),
    });
    expect(txRow).toMatchObject({
      type: "expense",
      accountId: id,
      amount: 250,
      categoryId: null,
      userId: owner.id,
      date: "2026-07-15",
    });
  });

  it("bucht bei Differenz 0 nichts", async () => {
    const id = await insertAccount(null, 500);
    const before = (await getDb().select().from(transactions)).length;
    const result = await callerFor(owner).finance.reconcileAccount({
      accountId: id,
      actualBalance: 500,
    });
    expect(result).toEqual({ ok: true, difference: 0 });
    const after = (await getDb().select().from(transactions)).length;
    expect(after).toBe(before);
  });

  it("berücksichtigt Transfers in der Soll-Saldo-Berechnung", async () => {
    const from = await insertAccount(null, 1000);
    const to = await insertAccount(null, 0);
    await callerFor(owner).finance.createTransaction({
      type: "transfer",
      accountId: from,
      toAccountId: to,
      amount: 300,
      userId: owner.id,
      date: "2026-07-02",
      note: "transfer",
    });
    // Soll Ziel = 300, Ist = 500 → +200
    const result = await callerFor(owner).finance.reconcileAccount({
      accountId: to,
      actualBalance: 500,
    });
    expect(result).toEqual({ ok: true, difference: 200 });
  });

  it("erfordert edit auf dem Konto; Viewer und Fremde werden abgelehnt", async () => {
    const id = await insertAccount(owner.id, 100);
    await getDb().insert(accountPermissions).values({
      accountId: id, userId: viewer.id, canEdit: false,
    });
    await callerFor(owner).finance.reconcileAccount({
      accountId: id, actualBalance: 200,
    });
    await expect(
      callerFor(viewer).finance.reconcileAccount({
        accountId: id, actualBalance: 200,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerFor(stranger).finance.reconcileAccount({
        accountId: id, actualBalance: 200,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("yearComparison", () => {
  it("rollt Unterkategorien auf, vergleicht mit dem Vorjahr und sortiert absteigend", async () => {
    const accountId = await insertAccount(null, 0);
    const root = await insertCategory("Lebensmittel", "expense");
    const sub = await insertCategory("Getränke", "expense", root);
    const miete = await insertCategory("Miete", "expense");

    const book = (
      amount: number, date: string, categoryId?: number, note = "",
    ) =>
      callerFor(owner).finance.createTransaction({
        type: "expense",
        accountId,
        amount,
        categoryId,
        userId: owner.id,
        date,
        note,
      });

    await book(10_000, "2026-03-10", root);
    await book(5_000, "2026-05-20", sub); // zählt zur Oberkategorie
    await book(8_000, "2025-04-10", root);
    await book(60_000, "2026-01-05", miete);
    await book(58_000, "2025-01-05", miete);
    await book(7_000, "2024-06-01", root); // anderes Jahr: ignoriert
    await book(3_000, "2026-02-01"); // ohne Kategorie
    // Einnahmen und Umbuchungen fließen nicht ein
    await callerFor(owner).finance.createTransaction({
      type: "income",
      accountId,
      amount: 99_000,
      userId: owner.id,
      date: "2026-02-01",
      note: "einnahme",
    });

    const result = await callerFor(owner).finance.yearComparison({ year: 2026 });
    expect(result.year).toBe(2026);
    expect(result.prevYear).toBe(2025);
    // Absteigend nach Jahressumme sortiert
    const currents = result.rows.map(r => r.current);
    expect(currents).toEqual([...currents].sort((a, b) => b - a));

    // Exakte Prüfung der hier gebuchten Kategorien (andere Tests dieser Datei
    // buchen ebenfalls unkategorisierte Ausgaben in 2026)
    const byName = new Map(result.rows.map(r => [r.name, r]));
    expect(byName.get("Miete")).toEqual({
      categoryId: miete, name: "Miete", color: "#10b981",
      current: 60_000, previous: 58_000,
    });
    expect(byName.get("Lebensmittel")).toEqual({
      categoryId: root, name: "Lebensmittel", color: "#10b981",
      current: 15_000, previous: 8_000,
    });
    // Unterkategorie "Getränke" ist aufgerollt, keine eigene Zeile
    expect(byName.get("Getränke")).toBeUndefined();
    // Ausgaben ohne Kategorie als eigene Zeile (mindestens die hier gebuchten)
    const uncategorized = byName.get("Ohne Kategorie");
    expect(uncategorized?.categoryId).toBeNull();
    expect(uncategorized?.current).toBeGreaterThanOrEqual(3_000);
  });

  it("filtert Ausgaben auf für den Nutzer unsichtbaren Konten heraus", async () => {
    const privateId = await insertAccount(owner.id, 0);
    const cat = await insertCategory("Privat", "expense");
    await callerFor(owner).finance.createTransaction({
      type: "expense",
      accountId: privateId,
      amount: 42_000,
      categoryId: cat,
      userId: owner.id,
      date: "2026-04-01",
      note: "privat",
    });

    const ownResult = await callerFor(owner).finance.yearComparison({ year: 2026 });
    const ownRow = ownResult.rows.find(r => r.name === "Privat");
    expect(ownRow?.current).toBe(42_000);

    const strangerResult = await callerFor(stranger).finance.yearComparison({ year: 2026 });
    const strangerRow = strangerResult.rows.find(r => r.name === "Privat");
    expect(strangerRow?.current ?? 0).toBe(0);
  });

  it("validiert den Jahres-Input", async () => {
    await expect(
      callerFor(owner).finance.yearComparison({ year: 1999 }),
    ).rejects.toThrow();
  });
});
