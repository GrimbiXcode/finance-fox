import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accountOwners, accounts, users } from "@db/schema";
import { localISO } from "./lib/recurringSchedule";
import { shiftMonth } from "@contracts/planning";
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

const today = localISO(new Date());
const thisMonth = today.slice(0, 7);
const lastMonth = shiftMonth(thisMonth, -1);
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localISO(d);
};
/** Tag im laufenden Monat, der sicher nicht in der Zukunft liegt */
const earlyThisMonth = `${thisMonth}-01`;

let shared = 0;
let cash = 0;
let privateAdmin = 0;
let food = 0;
let bakery = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [admin, member]) {
    await db.insert(users).values({ ...u, active: true, createdAt: new Date() });
  }
  const insert = async (name: string, type: string, initialBalance: number) =>
    (
      await db
        .insert(accounts)
        .values({ name, type, initialBalance, createdAt: new Date() })
        .returning({ id: accounts.id })
    )[0].id;
  shared = await insert("Haushalt", "checking", 100_000);
  cash = await insert("Kasse", "cash", 1_000);
  privateAdmin = await insert("Privat Anna", "checking", 50_000);
  await db.insert(accountOwners).values({ accountId: privateAdmin, userId: admin.id });

  await asAdmin().finance.addDefaultCategories({ keys: ["lebensmittel", "lohn"] });
  const cats = await asAdmin().finance.listCategories();
  food = cats.find(c => c.name === "Lebensmittel")!.id;
  bakery = cats.find(c => c.name === "Bäckerei")!.id;
  const salary = cats.find(c => c.name === "Lohn")!.id;

  const tx = asAdmin().finance.createTransaction;
  await tx({ type: "income", accountId: shared, amount: 400_000, categoryId: salary, userId: admin.id, date: earlyThisMonth, note: "Lohn" });
  await tx({ type: "income", accountId: shared, amount: 300_000, categoryId: salary, userId: admin.id, date: `${lastMonth}-15`, note: "Lohn" });
  await tx({ type: "expense", accountId: shared, amount: 20_000, categoryId: food, userId: member.id, date: earlyThisMonth, note: "Coop", splits: [{ userId: admin.id, amount: 10_000 }, { userId: member.id, amount: 10_000 }] });
  await tx({ type: "expense", accountId: shared, amount: 5_000, categoryId: bakery, userId: admin.id, date: earlyThisMonth, note: "Beck" });
  await tx({ type: "expense", accountId: shared, amount: 7_000, userId: admin.id, date: `${lastMonth}-10`, note: "ohne Kategorie" });
  // Kasse ins Minus: 1'000 Anfangsbestand, 3'000 ausgegeben
  await tx({ type: "expense", accountId: cash, amount: 3_000, categoryId: food, userId: admin.id, date: earlyThisMonth, note: "Markt" });
  // Privatausgabe: nur für Anna sichtbar
  await tx({ type: "expense", accountId: privateAdmin, amount: 8_000, userId: admin.id, date: earlyThisMonth, note: "Privat" });

  await asAdmin().finance.setBudget({ categoryId: food, amount: 10_000, period: "monthly", rollover: false });
  await asAdmin().finance.createRecurring({ type: "expense", accountId: shared, amount: 150_000, categoryId: food, userId: admin.id, note: "Miete", interval: "monthly", nextDate: daysFromNow(3) });
});

describe("dashboard.summary", () => {
  it("liefert Monatssummen mit Vormonat und Kategorien auf Oberkategorie-Ebene", async () => {
    const s = await asAdmin().dashboard.summary({ month: thisMonth });
    expect(s.isCurrent).toBe(true);
    expect(s.totals.current).toEqual({ income: 400_000, expense: 36_000 });
    expect(s.totals.previous).toEqual({ income: 300_000, expense: 7_000 });
    const lebensmittel = s.categories.find(c => c.categoryId === food);
    // Bäckerei ist Unterkategorie von Lebensmittel
    expect(lebensmittel?.amount).toBe(28_000);
    expect(s.cashflow).toHaveLength(6);
    expect(s.cashflow[5].month).toBe(thisMonth);
  });

  it("rechnet Vermögen am Monatsende für vergangene Monate", async () => {
    const s = await asAdmin().dashboard.summary({ month: lastMonth });
    expect(s.isCurrent).toBe(false);
    // 151'000 Anfangsbestände + 300'000 − 7'000
    expect(s.balance.current).toBe(151_000 + 300_000 - 7_000);
    expect(s.categories.find(c => c.categoryId === -1)?.amount).toBe(7_000);
  });

  it("zeigt dem Mitglied nur sichtbare Konten", async () => {
    const a = await asAdmin().dashboard.summary({ month: thisMonth });
    const m = await asMember().dashboard.summary({ month: thisMonth });
    expect(a.totals.current.expense - m.totals.current.expense).toBe(8_000);
    expect(a.accountCount).toBe(3);
    expect(m.accountCount).toBe(2);
  });

  it("berechnet die Aufteilungs-Salden", async () => {
    const s = await asAdmin().dashboard.summary({ month: thisMonth });
    const byUser = new Map(s.memberBalances.map(b => [b.userId, b.amount]));
    // Ben hat 200 bezahlt, Anna schuldet ihm ihre Hälfte
    expect(byUser.get(member.id)).toBe(10_000);
    expect(byUser.get(admin.id)).toBe(-10_000);
  });
});

describe("dashboard.attention", () => {
  it("meldet Budget, negative Kasse, fällige Dauerbuchung und Ausgleich", async () => {
    const items = await asAdmin().dashboard.attention();
    const kinds = items.map(i => i.kind);
    expect(kinds).toContain("budget_over");
    expect(kinds).toContain("negative_cash");
    expect(kinds).toContain("recurring_due");
    expect(kinds).toContain("settlement");
    // Schwere zuerst
    expect(items[0].severity).toBe("bad");
    const cashItem = items.find(i => i.kind === "negative_cash");
    expect(cashItem).toMatchObject({ accountId: cash, balance: -2_000 });
    const due = items.find(i => i.kind === "recurring_due");
    expect(due).toMatchObject({ count: 1, expense: 150_000 });
  });

  it("meldet Sparziele mit Stichtag, die nicht erreicht werden", async () => {
    const deadline = `${shiftMonth(thisMonth, 4)}-01`;
    await asAdmin().finance.createGoal({ name: "Velo", targetAmount: 400_000, color: "#2F6FC4", deadline });
    const goal = (await asAdmin().finance.listGoals()).find(g => g.name === "Velo")!;
    await asAdmin().finance.addGoalSource({ goalId: goal.id, accountId: privateAdmin, mode: "absolute", value: 10_000 });
    const items = await asAdmin().dashboard.attention();
    const behind = items.find(i => i.kind === "goal_behind");
    expect(behind).toMatchObject({ goalId: goal.id, required: Math.ceil(390_000 / 4) });
  });
});

describe("finance.yearComparison mit upTo", () => {
  it("vergleicht nur bis zum gleichen Tag in beiden Jahren", async () => {
    const year = Number(thisMonth.slice(0, 4));
    const tx = asAdmin().finance.createTransaction;
    await tx({ type: "expense", accountId: shared, amount: 1_000, categoryId: food, userId: admin.id, date: `${year - 1}-02-10`, note: "Vorjahr früh" });
    await tx({ type: "expense", accountId: shared, amount: 50_000, categoryId: food, userId: admin.id, date: `${year - 1}-12-20`, note: "Vorjahr spät" });
    const full = await asAdmin().finance.yearComparison({ year });
    const ytd = await asAdmin().finance.yearComparison({ year, upTo: "06-30" });
    const prev = (r: typeof full) => r.rows.find(x => x.categoryId === food)?.previous;
    expect(prev(full)).toBe(51_000);
    expect(prev(ytd)).toBe(1_000);
    expect(ytd.upTo).toBe("06-30");
  });
});

describe("dashboard.attention: Dauerbuchungen hinter dem Enddatum", () => {
  it("meldet keine Termine, die der Cron-Job nie mehr verbucht", async () => {
    const { recurring } = await import("@db/schema");
    // Zustand nach dem letzten Lauf: nextDate liegt hinter dem Enddatum
    await getDb().insert(recurring).values({
      type: "expense", accountId: shared, amount: 99_900, categoryId: null, userId: admin.id,
      note: "Abgelaufen", interval: "weekly", nextDate: daysFromNow(2), endDate: daysFromNow(1),
      active: true, createdAt: new Date(),
    });
    const due = (await asAdmin().dashboard.attention()).find(i => i.kind === "recurring_due");
    expect(due).toMatchObject({ count: 1, expense: 150_000 });
  });
});

describe("Meine Sicht (userId)", () => {
  it("rechnet Summen und letzte Buchungen nur für die Person, Vermögen bleibt", async () => {
    const all = await asAdmin().dashboard.summary({ month: thisMonth, today });
    const mine = await asAdmin().dashboard.summary({ month: thisMonth, today, userId: member.id });
    expect(mine.balance.current).toBe(all.balance.current);
    expect(mine.recent.every(t => t.userId === member.id)).toBe(true);
    expect(mine.totals.current.expense).toBeLessThanOrEqual(all.totals.current.expense);
    const trend = await asAdmin().analysis.monthlyTrend({ months: 3, userId: member.id });
    expect(trend.rows.at(-1)?.expense).toBe(mine.totals.current.expense);
  });
});
