import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accountOwners, accounts, users } from "@db/schema";
import { parseAmountTerm } from "./lib/transactionSearch";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Anna",
  role: "admin",
  color: "#10b981",
};
const member: SessionUser = {
  id: 2,
  email: "member@example.com",
  name: "Ben",
  role: "member",
  color: "#6366f1",
};

const callerFor = (user: SessionUser) => {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
};
const asAdmin = () => callerFor(admin);
const asMember = () => callerFor(member);

let shared = 0;
let privateAdmin = 0;
let food = 0;
let bakery = 0;
let salary = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [admin, member]) {
    await db.insert(users).values({ ...u, active: true, createdAt: new Date() });
  }
  shared = (
    await db
      .insert(accounts)
      .values({ name: "Haushalt", type: "checking", initialBalance: 100_000, createdAt: new Date() })
      .returning({ id: accounts.id })
  )[0].id;
  privateAdmin = (
    await db
      .insert(accounts)
      .values({ name: "Privat Anna", type: "checking", initialBalance: 0, createdAt: new Date() })
      .returning({ id: accounts.id })
  )[0].id;
  await db.insert(accountOwners).values({ accountId: privateAdmin, userId: admin.id });

  await asAdmin().finance.addDefaultCategories({ keys: ["lebensmittel", "lohn"] });
  const cats = await asAdmin().finance.listCategories();
  food = cats.find(c => c.name === "Lebensmittel")!.id;
  bakery = cats.find(c => c.name === "Bäckerei")!.id;
  salary = cats.find(c => c.name === "Lohn")!.id;
  await asAdmin().finance.createTag({ name: "Steuern" });
  const tagId = (await asAdmin().finance.listTags())[0].id;

  const tx = asAdmin().finance.createTransaction;
  await tx({ type: "income", accountId: shared, amount: 500_000, categoryId: salary, userId: admin.id, date: "2026-08-25", note: "Lohn Anna" });
  await tx({ type: "expense", accountId: shared, amount: 4_550, categoryId: food, userId: member.id, date: "2026-08-03", note: "Coop Wocheneinkauf" });
  await tx({ type: "expense", accountId: shared, amount: 1_250, categoryId: bakery, userId: admin.id, date: "2026-08-04", note: "Bäckerei Steiner", tagIds: [tagId] });
  await tx({ type: "expense", accountId: shared, amount: 12_000, categoryId: food, userId: admin.id, date: "2026-09-02", note: "Migros", splits: [{ userId: admin.id, amount: 6_000 }, { userId: member.id, amount: 6_000 }] });
  await tx({ type: "expense", accountId: privateAdmin, amount: 9_900, userId: admin.id, date: "2026-09-10", note: "Geheimes Geschenk" });
  await tx({ type: "transfer", accountId: shared, toAccountId: privateAdmin, amount: 20_000, userId: admin.id, date: "2026-09-12", note: "Taschengeld" });
});

describe("parseAmountTerm", () => {
  it("versteht beide Dezimaltrennzeichen und Tausender", () => {
    expect(parseAmountTerm("12,50")).toEqual({ cents: 1250, exact: true });
    expect(parseAmountTerm("12.5")).toEqual({ cents: 1250, exact: true });
    expect(parseAmountTerm("1'234")).toEqual({ cents: 123_400, exact: false });
    expect(parseAmountTerm("1.234")).toEqual({ cents: 123_400, exact: false });
    expect(parseAmountTerm("45")).toEqual({ cents: 4_500, exact: false });
    expect(parseAmountTerm("Coop")).toBeNull();
  });
});

describe("finance.searchTransactions", () => {
  it("filtert nach Zeitraum und summiert über alle Treffer", async () => {
    const res = await asAdmin().finance.searchTransactions({ from: "2026-08-01", to: "2026-08-31", limit: 1 });
    expect(res.total).toBe(3);
    expect(res.items).toHaveLength(1);
    expect(res.hasMore).toBe(true);
    expect(res.income).toBe(500_000);
    expect(res.expense).toBe(5_800);
  });

  it("schließt Unterkategorien beim Kategoriefilter ein", async () => {
    const res = await asAdmin().finance.searchTransactions({ categoryId: food });
    expect(res.items.map(t => t.note).sort()).toEqual(["Bäckerei Steiner", "Coop Wocheneinkauf", "Migros"]);
  });

  it("findet Beträge in beiden Schreibweisen, Notizen und Tag-Namen", async () => {
    const byComma = await asAdmin().finance.searchTransactions({ search: "45,50" });
    expect(byComma.items.map(t => t.note)).toEqual(["Coop Wocheneinkauf"]);
    const byDot = await asAdmin().finance.searchTransactions({ search: "45.50" });
    expect(byDot.total).toBe(1);
    const byTag = await asAdmin().finance.searchTransactions({ search: "steuern" });
    expect(byTag.items.map(t => t.note)).toEqual(["Bäckerei Steiner"]);
  });

  it("sortiert nach Betrag und blättert stabil", async () => {
    const first = await asAdmin().finance.searchTransactions({ sort: "amount", dir: "desc", limit: 2 });
    const second = await asAdmin().finance.searchTransactions({ sort: "amount", dir: "desc", limit: 2, cursor: 2 });
    const amounts = [...first.items, ...second.items].map(t => t.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    expect(new Set([...first.items, ...second.items].map(t => t.id)).size).toBe(4);
  });

  it("filtert geteilte Buchungen und liefert Splits mit", async () => {
    const res = await asAdmin().finance.searchTransactions({ shared: true });
    expect(res.total).toBe(1);
    expect(res.items[0].splits).toHaveLength(2);
  });

  it("respektiert private Konten: das Mitglied sieht die Privatbuchung nicht", async () => {
    const admin = await asAdmin().finance.searchTransactions({ search: "Geheim" });
    expect(admin.total).toBe(1);
    const member = await asMember().finance.searchTransactions({ search: "Geheim" });
    expect(member.total).toBe(0);
    // Die Umbuchung vom Gemeinschaftskonto bleibt sichtbar (Quellkonto sichtbar)
    const transfer = await asMember().finance.searchTransactions({ type: "transfer" });
    expect(transfer.total).toBe(1);
  });

  it("markiert stornierte Buchungen", async () => {
    const coop = (await asAdmin().finance.searchTransactions({ search: "Coop" })).items[0];
    expect(coop.isReversed).toBe(false);
    await asAdmin().finance.reverseTransaction({ id: coop.id });
    const after = (await asAdmin().finance.searchTransactions({ search: "Coop" })).items;
    expect(after.find(t => t.id === coop.id)?.isReversed).toBe(true);
  });
});

describe("finance.listAccounts / categoryUsage / noteSuggestions", () => {
  it("zählt Buchungen je Konto", async () => {
    const accs = await asAdmin().finance.listAccounts();
    expect(accs.find(a => a.id === privateAdmin)?.txCount).toBe(2);
  });

  it("liefert zuletzt genutzte und häufige Kategorien", async () => {
    // „Häufig“ zählt die letzten 90 Tage ab heute — daher eine Buchung von heute
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await asAdmin().finance.createTransaction({ type: "expense", accountId: shared, amount: 700, categoryId: bakery, userId: admin.id, date: today, note: "Brot" });
    const usage = await asAdmin().finance.categoryUsage();
    // Die Gegenbuchung des Stornos (Einnahme „Lebensmittel“) zählt nicht
    expect(usage.income.last).toBe(salary);
    expect(usage.expense.frequent).toContain(bakery);
  });

  it("schlägt frühere Notizen mit Kategorie und Konto vor", async () => {
    const hits = await asAdmin().finance.noteSuggestions({ query: "bäck", type: "expense" });
    expect(hits[0]).toMatchObject({ note: "Bäckerei Steiner", categoryId: bakery, accountId: shared, amount: 1_250 });
    // Das Mitglied darf auf Annas Privatkonto nicht buchen → kein Vorschlag
    const member = await asMember().finance.noteSuggestions({ query: "geheim", type: "expense" });
    expect(member).toEqual([]);
  });
});
