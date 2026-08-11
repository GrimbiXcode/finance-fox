import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { runRecurringJob } from "./lib/recurringJob";
import { advanceDate } from "./lib/recurringSchedule";
import { accounts, recurring, transactions, users } from "@db/schema";
import { monthlyAmount } from "@/lib/moneyflow";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Vierteljährliche und halbjährliche Dauerbuchungen — vor allem für
 * Hypothekarzinsen, die in der Schweiz quartalsweise belastet werden.
 * Der Cron-Job und die Saldo-Prognose müssen dieselben Termine rechnen
 * (gemeinsamer Helper `lib/recurringSchedule.ts`).
 */

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  color: "#10b981",
};

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Heute ± n Tage als ISO-String */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localISO(d);
}

/**
 * Der 15. des nächsten Monats — ein Termin, der sich über jeden Kalender
 * gleich verhält: immer in der Zukunft, immer im ersten Prognosemonat, und
 * weit genug vom Monatsende entfernt, dass `advanceDate` nicht überläuft.
 * Ein Termin am 29.–31. würde in kürzeren Monaten in den Folgemonat
 * rutschen (dokumentiert in `lib/recurringSchedule.ts`) und die Vorkommen
 * dadurch je nach heutigem Datum anders auf die Monate verteilen.
 */
function fifteenthOfNextMonth(): string {
  const d = new Date();
  return localISO(new Date(d.getFullYear(), d.getMonth() + 1, 15));
}

let nameCounter = 0;

async function insertAccount(): Promise<number> {
  nameCounter += 1;
  const rows = await getDb()
    .insert(accounts)
    .values({
      name: `Konto ${nameCounter}`,
      type: "checking",
      initialBalance: 0,
      createdAt: new Date(),
    })
    .returning({ id: accounts.id });
  return rows[0].id;
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  await getDb().insert(users).values({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    color: admin.color,
    createdAt: new Date(),
  });
});

describe("advanceDate", () => {
  it("springt bei quarterly drei und bei semiannual sechs Monate weiter", () => {
    expect(advanceDate("2026-01-15", "quarterly")).toBe("2026-04-15");
    expect(advanceDate("2026-11-15", "quarterly")).toBe("2027-02-15");
    expect(advanceDate("2026-01-15", "semiannual")).toBe("2026-07-15");
    expect(advanceDate("2026-09-15", "semiannual")).toBe("2027-03-15");
  });

  it("lässt die bestehenden Intervalle unverändert", () => {
    expect(advanceDate("2026-01-15", "weekly")).toBe("2026-01-22");
    expect(advanceDate("2026-01-15", "monthly")).toBe("2026-02-15");
    expect(advanceDate("2026-01-15", "yearly")).toBe("2027-01-15");
  });
});

describe("Cron-Verbuchung", () => {
  it("verbucht eine vierteljährliche Dauerbuchung viermal pro Jahr", async () => {
    const accountId = await insertAccount();
    // Start vor knapp einem Jahr: fällig sind die Vorkommen in Monat
    // 0/3/6/9 — das in Monat 12 liegt noch ein paar Tage in der Zukunft.
    const start = daysFromToday(-360);
    await callerFor(admin).finance.createRecurring({
      type: "expense",
      accountId,
      amount: 360000,
      userId: admin.id,
      note: "Hypothekarzins",
      interval: "quarterly",
      nextDate: start,
    });

    await runRecurringJob();

    const booked = await getDb()
      .select({ date: transactions.date })
      .from(transactions)
      .where(eq(transactions.accountId, accountId));
    expect(booked.map(b => b.date).sort()).toEqual([
      start,
      advanceDate(start, "quarterly"),
      advanceDate(advanceDate(start, "quarterly"), "quarterly"),
      advanceDate(
        advanceDate(advanceDate(start, "quarterly"), "quarterly"),
        "quarterly"
      ),
    ]);

    // nextDate steht auf dem ersten Vorkommen in der Zukunft
    const row = await getDb().query.recurring.findFirst({
      where: eq(recurring.accountId, accountId),
    });
    expect(row!.nextDate > localISO(new Date())).toBe(true);
  });
});

describe("Saldo-Prognose", () => {
  it("zählt eine vierteljährliche Ausgabe in 12 Monaten viermal", async () => {
    const accountId = await insertAccount();
    // Die Prognose summiert über alle Konten — also gegen einen vorher
    // gemessenen Nullpunkt vergleichen statt gegen absolute Beträge.
    // Sonst zählt dieser Test die Dauerbuchungen der anderen Tests mit.
    const before = await callerFor(admin).forecast.balance({ months: 12 });

    await callerFor(admin).finance.createRecurring({
      type: "expense",
      accountId,
      amount: 300000,
      userId: admin.id,
      note: "Quartalszins Prognose",
      interval: "quarterly",
      nextDate: fifteenthOfNextMonth(),
    });

    const after = await callerFor(admin).forecast.balance({ months: 12 });
    const quarterMonths = after.projection.filter(
      (p, i) =>
        p.recurringExpense - before.projection[i].recurringExpense === 300000
    );
    expect(quarterMonths).toHaveLength(4);
  });
});

describe("Geldfluss-Normalisierung", () => {
  it("rechnet Quartals- und Halbjahresbeträge auf den Monat um", () => {
    expect(monthlyAmount(300000, "quarterly")).toBe(100000);
    expect(monthlyAmount(300000, "semiannual")).toBe(50000);
    expect(monthlyAmount(120000, "yearly")).toBe(10000);
    expect(monthlyAmount(100000, "monthly")).toBe(100000);
  });
});
