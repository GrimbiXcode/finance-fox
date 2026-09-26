import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, users } from "@db/schema";
import { withoutReversals } from "@contracts/flows";
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
const caller = () => {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user: admin,
  };
  return appRouter.createCaller(ctx);
};

const today = localISO(new Date());
const thisMonth = today.slice(0, 7);
const lastMonth = shiftMonth(thisMonth, -1);
let account = 0;
let food = 0;

describe("withoutReversals", () => {
  it("entfernt Original und Gegenbuchung, lässt den Rest stehen", () => {
    const rows = [
      { id: 1, stornoOfId: null },
      { id: 2, stornoOfId: null },
      { id: 3, stornoOfId: 1 },
    ];
    expect(withoutReversals(rows).map(r => r.id)).toEqual([2]);
    const plain = [{ id: 5, stornoOfId: null }];
    expect(withoutReversals(plain)).toBe(plain);
  });
});

describe("Stornos in Summen", () => {
  beforeAll(async () => {
    await initDb();
    ensureSchema();
    const db = getDb();
    await db
      .insert(users)
      .values({ ...admin, active: true, createdAt: new Date() });
    account = (
      await db
        .insert(accounts)
        .values({
          name: "Haushalt",
          type: "checking",
          initialBalance: 100_000,
          createdAt: new Date(),
        })
        .returning({ id: accounts.id })
    )[0].id;
    await caller().finance.addDefaultCategories({ keys: ["lebensmittel"] });
    food = (await caller().finance.listCategories()).find(
      c => c.name === "Lebensmittel"
    )!.id;
    await caller().finance.setBudget({
      categoryId: food,
      amount: 50_000,
      period: "monthly",
      rollover: false,
    });
    const tx = caller().finance.createTransaction;
    await tx({
      type: "expense",
      accountId: account,
      amount: 10_000,
      categoryId: food,
      userId: admin.id,
      date: `${thisMonth}-01`,
      note: "Wocheneinkauf",
    });
    // Fehlbuchung im Vormonat, heute storniert
    const wrong = await tx({
      type: "expense",
      accountId: account,
      amount: 40_000,
      categoryId: food,
      userId: admin.id,
      date: `${lastMonth}-20`,
      note: "Vertippt",
    });
    const wrongNow = await tx({
      type: "expense",
      accountId: account,
      amount: 30_000,
      categoryId: food,
      userId: admin.id,
      date: `${thisMonth}-01`,
      note: "Doppelt",
    });
    await caller().finance.reverseTransaction({ id: wrong.id });
    await caller().finance.reverseTransaction({ id: wrongNow.id });
  });

  it("zählt weder Original noch Gegenbuchung in Dashboard, Budget und Liste", async () => {
    const summary = await caller().dashboard.summary({
      month: thisMonth,
      today,
    });
    expect(summary.totals.current).toEqual({ income: 0, expense: 10_000 });
    expect(summary.totals.previous).toEqual({ income: 0, expense: 0 });
    // Saldo rechnet weiter mit beiden Buchungen — sie heben sich auf
    expect(summary.balance.current).toBe(100_000 - 10_000);

    const [status] = await caller().finance.listBudgetStatus();
    expect(status.spent).toBe(10_000);

    const list = await caller().finance.searchTransactions({
      from: `${thisMonth}-01`,
      to: `${thisMonth}-31`,
    });
    // Liste zeigt alle vier Zeilen (Einkauf, Doppelt, zwei Stornos) …
    expect(list.total).toBe(4);
    // … die Summen nur den echten Einkauf
    expect(list.expense).toBe(10_000);
    expect(list.income).toBe(0);
    const previous = await caller().finance.searchTransactions({
      from: `${lastMonth}-01`,
      to: `${lastMonth}-31`,
    });
    expect(previous.expense).toBe(0);
  });

  it("wirkt auch in Auswertung und Jahresvergleich", async () => {
    const matrix = await caller().analysis.categoryMatrix({
      months: 3,
      type: "expense",
    });
    expect(matrix.total).toBe(10_000);
    const income = await caller().analysis.categoryMatrix({
      months: 3,
      type: "income",
    });
    expect(income.total).toBe(0);
    const year = await caller().finance.yearComparison({
      year: Number(thisMonth.slice(0, 4)),
    });
    const sum = year.rows.reduce((s, r) => s + r.current + r.previous, 0);
    // Vormonat kann im Vorjahr liegen (Januar) — die Summe über beide Jahre stimmt immer
    expect(sum).toBe(10_000);
  });
});
