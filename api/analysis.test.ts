import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { analysisRouter } from "./analysisRouter";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accountOwners, accounts, users } from "@db/schema";
import { localISO } from "./lib/recurringSchedule";
import { shiftMonth } from "@contracts/planning";
import { monthLastDay } from "@contracts/period";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = { id: 1, email: "a@example.com", name: "Anna", role: "admin", color: "#10b981" };
const member: SessionUser = { id: 2, email: "b@example.com", name: "Ben", role: "member", color: "#6366f1" };

const ctxFor = (user: SessionUser): TrpcContext => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user,
});
const app = (u: SessionUser) => appRouter.createCaller(ctxFor(u));
const analysis = (u: SessionUser) => analysisRouter.createCaller(ctxFor(u));

const today = localISO(new Date());
const thisMonth = today.slice(0, 7);
const lastMonth = shiftMonth(thisMonth, -1);
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localISO(d);
};

let shared = 0;
let privateAdmin = 0;
let food = 0;
let bakery = 0;
let fun = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [admin, member]) await db.insert(users).values({ ...u, active: true, createdAt: new Date() });
  const insert = async (name: string, initialBalance: number) =>
    (await db.insert(accounts).values({ name, type: "checking", initialBalance, createdAt: new Date() }).returning({ id: accounts.id }))[0].id;
  shared = await insert("Haushalt", 10_000);
  privateAdmin = await insert("Privat Anna", 0);
  await db.insert(accountOwners).values({ accountId: privateAdmin, userId: admin.id });
  await app(admin).finance.addDefaultCategories({ keys: ["lebensmittel", "freizeit"] });
  const cats = await app(admin).finance.listCategories();
  food = cats.find(c => c.name === "Lebensmittel")!.id;
  bakery = cats.find(c => c.name === "Bäckerei")!.id;
  fun = cats.find(c => c.name === "Freizeit")!.id;
  const tx = app(admin).finance.createTransaction;
  await tx({ type: "income", accountId: shared, amount: 500_000, userId: admin.id, date: `${lastMonth}-02`, note: "Lohn" });
  await tx({ type: "expense", accountId: shared, amount: 30_000, categoryId: food, userId: admin.id, date: `${lastMonth}-05`, note: "Coop" });
  await tx({ type: "expense", accountId: shared, amount: 5_000, categoryId: bakery, userId: admin.id, date: `${lastMonth}-06`, note: "Beck" });
  await tx({ type: "expense", accountId: shared, amount: 4_000, categoryId: fun, userId: admin.id, date: `${thisMonth}-01`, note: "Kino" });
  await tx({ type: "expense", accountId: shared, amount: 2_000, categoryId: food, userId: admin.id, date: `${thisMonth}-01`, note: "Migros" });
  await tx({ type: "expense", accountId: privateAdmin, amount: 9_000, categoryId: fun, userId: admin.id, date: `${thisMonth}-01`, note: "Privat" });
});

describe("analysis.categoryMatrix", () => {
  it("summiert je Monat, Oberkategorien enthalten Unterkategorien", async () => {
    const m = await analysis(admin).categoryMatrix({ months: 3 });
    expect(m.months).toEqual([shiftMonth(thisMonth, -2), lastMonth, thisMonth]);
    const lebensmittel = m.rows.find(r => r.categoryId === food)!;
    expect(lebensmittel.values).toEqual([0, 35_000, 2_000]);
    expect(m.rows.find(r => r.categoryId === bakery)?.values).toEqual([0, 5_000, 0]);
    // Summenzeile nur über Oberkategorien (keine Doppelzählung)
    expect(m.totals).toEqual([0, 35_000, 15_000]);
  });

  it("zählt fremde Privatkonten nicht mit", async () => {
    const m = await analysis(member).categoryMatrix({ months: 3 });
    expect(m.totals[2]).toBe(6_000);
  });
});

describe("analysis.monthlyTrend", () => {
  it("liefert Sparquote und Durchschnitte", async () => {
    const t = await analysis(admin).monthlyTrend({ months: 3 });
    const last = t.rows.find(r => r.month === lastMonth)!;
    expect(last).toMatchObject({ income: 500_000, expense: 35_000, saved: 465_000, rate: 93 });
    expect(t.rows.find(r => r.month === thisMonth)?.rate).toBeNull();
    expect(t.best).toBe(lastMonth);
  });
});

describe("Budgets: Detail, Abdeckung, Vorschlag", () => {
  it("zeigt Verlauf, Treffer-Quote und Aufschlüsselung", async () => {
    await app(admin).finance.setBudget({ categoryId: food, amount: 20_000, period: "monthly", rollover: false });
    const budget = (await app(admin).finance.listBudgets()).find(b => b.categoryId === food)!;
    const d = await analysis(admin).budgetDetail({ budgetId: budget.id, periods: 3 });
    expect(d.history.map(h => h.spent)).toEqual([0, 35_000, 2_000]);
    // Nur Perioden ab der ersten Buchung zählen: Vormonat, überschritten
    expect(d.closedCount).toBe(1);
    expect(d.keptCount).toBe(0);
    expect(d.average).toBe(35_000);
    expect(d.breakdown).toEqual([expect.objectContaining({ categoryId: food, amount: 2_000 })]);
  });

  it("weist unbudgetierte Ausgaben aus", async () => {
    const c = await analysis(admin).budgetCoverage();
    expect(c.total).toBe(15_000);
    expect(c.uncovered).toBe(13_000);
    expect(c.top[0]).toMatchObject({ categoryId: fun, amount: 13_000 });
  });

  it("schlägt ein Limit aus den letzten Monaten vor", async () => {
    const s = await analysis(admin).categoryStats({ categoryId: food });
    expect(s.max).toBe(35_000);
    expect(s.average6).toBe(Math.round(35_000 / 6));
  });
});

describe("analysis.upcoming", () => {
  it("löst Termine auf und warnt vor einem negativen Saldo", async () => {
    await app(admin).finance.createRecurring({ type: "expense", accountId: shared, amount: 200_000, userId: admin.id, note: "Wöchentlich", interval: "weekly", nextDate: inDays(2) });
    const u = await analysis(admin).upcoming({ days: 30 });
    const weekly = u.occurrences.filter(o => o.note === "Wöchentlich");
    expect(weekly.length).toBeGreaterThanOrEqual(4);
    // 10'000 + 500'000 − 50'000 = 460'000; 5 × 200'000 überschreitet das
    expect(u.warnings.map(w => w.accountId)).toContain(shared);
    // Das Mitglied sieht dieselbe Dauerbuchung (Gemeinschaftskonto)
    expect((await analysis(member).upcoming({ days: 30 })).occurrences.length).toBe(u.occurrences.length);
  });
});

describe("analysis.projectSummary", () => {
  it("rechnet bezahlt und getragen je Person", async () => {
    await app(admin).finance.createProject({ name: "Ferien", color: "#D9692C" });
    const project = (await app(admin).finance.listProjects())[0];
    await app(admin).finance.createTransaction({ type: "expense", accountId: shared, amount: 10_000, userId: admin.id, date: today, note: "Hotel", projectId: project.id, categoryId: fun, splits: [{ userId: admin.id, amount: 5_000 }, { userId: member.id, amount: 5_000 }] });
    await app(admin).finance.createTransaction({ type: "expense", accountId: shared, amount: 3_000, userId: member.id, date: today, note: "Essen", projectId: project.id });
    const s = await analysis(admin).projectSummary({ projectId: project.id });
    expect(s.total).toBe(13_000);
    const byUser = new Map(s.persons.map(p => [p.userId, p]));
    expect(byUser.get(admin.id)).toMatchObject({ paid: 10_000, share: 5_000 });
    expect(byUser.get(member.id)).toMatchObject({ paid: 3_000, share: 8_000 });
    expect(s.categories.map(c => c.categoryId)).toEqual([fun, -1]);
  });

  it("zählt verbuchte Ausgleiche nicht als Projektkosten", async () => {
    const project = (await app(admin).finance.listProjects())[0];
    // So legt „Verbuchen“ den Ausgleich an: Ausgabe, die ganz die andere Person trägt
    await app(admin).finance.createTransaction({ type: "expense", accountId: shared, amount: 5_000, userId: member.id, date: today, note: "Ausgleich an Anna", projectId: project.id, splits: [{ userId: admin.id, amount: 5_000 }] });
    const s = await analysis(admin).projectSummary({ projectId: project.id });
    expect(s.total).toBe(13_000);
    expect(s.count).toBe(2);
    expect(s).toMatchObject({ settledTotal: 5_000, settledCount: 1 });
    const byUser = new Map(s.persons.map(p => [p.userId, p]));
    // Kosten unverändert, offen bleibt nach dem Ausgleich nichts
    expect(byUser.get(admin.id)).toMatchObject({ paid: 10_000, share: 5_000, settled: -5_000 });
    expect(byUser.get(member.id)).toMatchObject({ paid: 3_000, share: 8_000, settled: 5_000 });
    expect(s.categories.map(c => c.categoryId)).toEqual([fun, -1]);
  });
});

describe("analysis.fixedCosts", () => {
  it("rechnet aktive Dauerbuchungen auf den Monat um und zeigt Schwankungen", async () => {
    const f = await analysis(admin).fixedCosts();
    // wöchentlich 200'000 → 200'000 × 52 / 12
    expect(f.fixedExpense).toBe(Math.round((200_000 * 52) / 12));
    expect(f.top[0].note).toBe("Wöchentlich");
    // Sechs abgeschlossene Monate, aber nur der Vormonat hat Buchungen —
    // Durchschnitt und Schwankung zählen nur Monate mit Buchungen
    expect(f.to).toBe(lastMonth);
    expect(f.averageExpense).toBe(35_000);
    const foodRow = f.variable.find(v => v.categoryId === food);
    expect(foodRow).toMatchObject({ min: 35_000, max: 35_000 });
  });
});

describe("analysis.breakdown", () => {
  const range = { from: `${lastMonth}-01`, to: monthLastDay(lastMonth) };

  it("summiert nach Dimension und vergleicht mit dem Zeitraum davor", async () => {
    const byCat = await analysis(admin).breakdown({ dimension: "category", ...range });
    expect(byCat.total).toBe(35_000);
    expect(byCat.rows).toEqual([
      expect.objectContaining({ key: food, amount: 35_000, count: 2, previous: 0 }),
    ]);
    expect(byCat.previousRange?.to).toBe(shiftDaysIso(range.from, -1));
    const byPerson = await analysis(admin).breakdown({ dimension: "person", ...range });
    expect(byPerson.rows[0]).toMatchObject({ key: admin.id, name: "Anna", amount: 35_000 });
    const byTag = await analysis(admin).breakdown({ dimension: "tag", ...range });
    expect(byTag.rows[0]).toMatchObject({ key: -1, name: "Ohne Tag" });
    const income = await analysis(admin).breakdown({ dimension: "account", type: "income", ...range });
    expect(income.rows[0]).toMatchObject({ key: shared, amount: 500_000 });
  });

  it("vergleicht wahlweise mit denselben Tagen ein Jahr früher", async () => {
    const r = await analysis(admin).breakdown({ dimension: "category", compare: "yearAgo", from: "2024-02-01", to: "2024-02-29" });
    expect(r.previousRange).toEqual({ from: "2023-02-01", to: "2023-02-28" });
  });

  it("gruppiert Notizen unabhängig von Schreibweise (Top-Empfänger)", async () => {
    await app(admin).finance.createTransaction({ type: "expense", accountId: shared, amount: 1_000, userId: admin.id, date: `${lastMonth}-10`, note: "  coop " });
    const r = await analysis(admin).breakdown({ dimension: "note", ...range });
    const coop = r.rows.find(x => x.name.toLowerCase() === "coop")!;
    expect(coop).toMatchObject({ amount: 31_000, count: 2, name: "Coop" });
  });

  it("kappt Top-Empfänger erst nach der gewählten Rangfolge", async () => {
    const byCount = await analysis(admin).breakdown({ dimension: "note", rank: "count", ...range });
    const counts = byCount.rows.map(r => r.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("fällt bei genau einem Jahr Spanne vom Vorjahr auf „davor“ zurück (kein doppelter Tag)", async () => {
    const r = await analysis(admin).breakdown({ dimension: "category", compare: "yearAgo", from: "2025-03-01", to: "2026-03-01" });
    expect(r.previousRange!.to < "2025-03-01").toBe(true);
  });

  it("zählt fremde Privatkonten nicht mit", async () => {
    const month = { from: `${thisMonth}-01`, to: monthLastDay(thisMonth) };
    const a = await analysis(admin).breakdown({ dimension: "account", ...month });
    const m = await analysis(member).breakdown({ dimension: "account", ...month });
    expect(a.rows.some(r => r.key === privateAdmin)).toBe(true);
    expect(m.rows.some(r => r.key === privateAdmin)).toBe(false);
    expect(a.total - m.total).toBe(9_000);
  });
});

function shiftDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
