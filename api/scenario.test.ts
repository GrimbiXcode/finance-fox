import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

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

const now = new Date();
// Erster Tag des Folgemonats → genau eine Fälligkeit pro Projektionsmonat
const FIRST_NEXT = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const firstNextISO = `${FIRST_NEXT.getFullYear()}-${String(
  FIRST_NEXT.getMonth() + 1
).padStart(2, "0")}-01`;

let sharedAccId: number;
let privateAccId: number;
let wohnenId: number;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  for (const u of [admin, member]) {
    await getDb().insert(users).values({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      active: true,
      createdAt: new Date(),
    });
  }
  // Gemeinschaftskonto + privates Konto von admin (für member unsichtbar)
  await callerFor(admin).finance.createAccount({
    name: "Gemeinschaft",
    type: "checking",
    initialBalance: 0,
    private: false,
  });
  await callerFor(admin).finance.createAccount({
    name: "Privat",
    type: "checking",
    initialBalance: 0,
    private: true,
  });
  const accs = await getDb().select().from(accounts);
  sharedAccId = accs.find((a) => a.name === "Gemeinschaft")!.id;
  privateAccId = accs.find((a) => a.name === "Privat")!.id;

  await callerFor(admin).finance.createCategory({
    name: "Gehalt",
    type: "income",
    color: "#10b981",
  });
  await callerFor(admin).finance.createCategory({
    name: "Wohnen",
    type: "expense",
    color: "#3b82f6",
  });
  const catsBefore = await callerFor(admin).finance.listCategories();
  wohnenId = catsBefore.find((c) => c.name === "Wohnen")!.id;
  await callerFor(admin).finance.createCategory({
    name: "Strom",
    type: "expense",
    color: "#000000",
    parentId: wohnenId,
  });
  const cats = await callerFor(admin).finance.listCategories();

  // Dauerbuchungen (alle monatlich, je eine Fälligkeit pro Monat):
  // 1000 € Einnahme, 300 € Wohnen, 50 € Strom (Unterkategorie von Wohnen)
  // auf dem Gemeinschaftskonto + 200 € Ausgabe auf dem privaten Konto
  const recs = [
    { type: "income", accountId: sharedAccId, amount: 100000 },
    { type: "expense", accountId: sharedAccId, amount: 30000, categoryId: wohnenId },
    {
      type: "expense",
      accountId: sharedAccId,
      amount: 5000,
      categoryId: cats.find((c) => c.name === "Strom")!.id,
    },
    { type: "expense", accountId: privateAccId, amount: 20000 },
  ] as const;
  for (const r of recs) {
    await callerFor(admin).finance.createRecurring({
      ...r,
      userId: admin.id,
      interval: "monthly",
      nextDate: firstNextISO,
    });
  }
});

describe("forecast.balance — Szenario-Planung", () => {
  it("liefert ohne Szenario das unveränderte Ergebnis (scenario = neutral)", async () => {
    const res = await callerFor(member).forecast.balance({ months: 3 });
    expect(res.scenario).toEqual({ incomePct: 100, excludeCategoryId: null });
    // Keine Ist-Buchungen → Historie 0, Projektion ab 0:
    // (100000 - 30000 - 5000) × 3 Monate
    expect(res.projection[0].recurringIncome).toBe(100000);
    expect(res.projection[0].recurringExpense).toBe(35000);
    expect(res.projection[2].balance).toBe(195000);
  });

  it("skaliert wiederkehrende Einnahmen mit incomePct", async () => {
    const res = await callerFor(member).forecast.balance({
      months: 3,
      incomePct: 110,
    });
    expect(res.scenario.incomePct).toBe(110);
    expect(res.projection[0].recurringIncome).toBe(110000);
    // +10000 pro Monat gegenüber der Basis
    expect(res.projection[2].balance).toBe(225000);
    // Historie bleibt unverändert
    expect(res.history.every((h) => h.balance === 0)).toBe(true);
  });

  it("entfernt bei excludeCategoryId Ausgaben der Kategorie inkl. Unterkategorien", async () => {
    const res = await callerFor(member).forecast.balance({
      months: 3,
      excludeCategoryId: wohnenId,
    });
    expect(res.scenario.excludeCategoryId).toBe(wohnenId);
    // Wohnen (30000) UND Strom (5000, Unterkategorie) entfallen
    expect(res.projection[0].recurringExpense).toBe(0);
    expect(res.projection[0].recurringIncome).toBe(100000);
    expect(res.projection[2].balance).toBe(300000);
  });

  it("kombiniert incomePct und excludeCategoryId", async () => {
    const res = await callerFor(member).forecast.balance({
      months: 3,
      incomePct: 90,
      excludeCategoryId: wohnenId,
    });
    // 90000 Einnahmen, keine Ausgaben → 90000 × 3
    expect(res.projection[0].recurringIncome).toBe(90000);
    expect(res.projection[2].balance).toBe(270000);
  });

  it("incomePct 100 ohne Kategorie entspricht exakt der Basis", async () => {
    const [base, neutral] = await Promise.all([
      callerFor(member).forecast.balance({ months: 3 }),
      callerFor(member).forecast.balance({ months: 3, incomePct: 100 }),
    ]);
    expect(neutral.projection).toEqual(base.projection);
  });

  it("beachtet den Sichtbarkeitsfilter auch im Szenario", async () => {
    // Die private Dauerausgabe (20000) ist nur für admin sichtbar
    const [asMember, asAdmin] = await Promise.all([
      callerFor(member).forecast.balance({ months: 3, incomePct: 110 }),
      callerFor(admin).forecast.balance({ months: 3, incomePct: 110 }),
    ]);
    // member: (110000 - 35000) × 3, admin: zusätzlich -20000 × 3
    expect(asMember.projection[2].balance).toBe(225000);
    expect(asAdmin.projection[2].balance).toBe(165000);
  });
});
