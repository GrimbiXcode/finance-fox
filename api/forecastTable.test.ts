import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, accountOwners, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Prognose-Tabelle (`forecast.table`): Horizont und Aggregationsgröße frei
 * wählbar, Zeilen für Konten, Gesamt, Ein-/Ausgaben, Nettovermögen und
 * Sparziele. Die Konten sammeln sich über die Tests dieser Datei an — die
 * Zusicherungen greifen deshalb bewusst auf die Zeile des jeweiligen Kontos
 * zu und nicht auf die Gesamtsumme (Ausnahme: der Ø-Test, der mit einer
 * Differenz arbeitet).
 */

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

let nameCounter = 0;

async function insertAccount(
  initialBalance = 0,
  ownerId: number | null = null
): Promise<number> {
  nameCounter += 1;
  const rows = await getDb()
    .insert(accounts)
    .values({
      name: `Konto ${nameCounter}`,
      type: "checking",
      initialBalance,
      createdAt: new Date(),
    })
    .returning({ id: accounts.id });
  const id = rows[0].id;
  if (ownerId !== null) {
    await getDb()
      .insert(accountOwners)
      .values({ accountId: id, userId: ownerId });
  }
  return id;
}

/**
 * Sparziel über den Router anlegen und die ID nachschlagen — `createGoal`
 * liefert nur `{ ok: true }`. `targetAmount` weglassen = offenes Ziel.
 */
async function createGoal(
  name: string,
  targetAmount?: number
): Promise<number> {
  await callerFor(admin).finance.createGoal({
    name,
    color: "#0ea5e9",
    ...(targetAmount !== undefined ? { targetAmount } : {}),
  });
  const goals = await callerFor(admin).finance.listGoals();
  return goals.find(g => g.name === name)!.id;
}

/** Erster Tag des Monats mit `offset` Monaten Abstand zu heute */
function firstOfMonth(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Letzter Tag des Monats mit `offset` Monaten Abstand zu heute */
function lastOfMonth(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
      createdAt: new Date(),
    });
  }
});

describe("forecast.table (Perioden)", () => {
  it("liefert eine Spalte je Periode", async () => {
    const res = await callerFor(admin).forecast.table({
      months: 60,
      granularity: "semiannual",
    });
    expect(res.periods).toHaveLength(10);
    expect(res.months).toBe(60);
    expect(res.granularity).toBe("semiannual");
    // Perioden schließen lückenlos aneinander an
    expect(res.periods[0].startMonth).toBe(firstOfMonth(1).slice(0, 7));
    expect(res.periods[0].endMonth).toBe(firstOfMonth(6).slice(0, 7));
    expect(res.periods[1].startMonth).toBe(firstOfMonth(7).slice(0, 7));
  });

  it("rundet den Horizont auf ganze Perioden auf", async () => {
    const res = await callerFor(admin).forecast.table({
      months: 13,
      granularity: "yearly",
    });
    expect(res.months).toBe(24);
    expect(res.periods).toHaveLength(2);
  });
});

describe("forecast.table (Kontosalden)", () => {
  it("schreibt eine monatliche Ausgabe je Periode fort", async () => {
    const accountId = await insertAccount();
    await callerFor(admin).finance.createRecurring({
      type: "expense",
      accountId,
      amount: 10_000,
      userId: admin.id,
      note: "Monatliche Ausgabe",
      interval: "monthly",
      nextDate: firstOfMonth(1),
    });

    const res = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "quarterly",
    });
    const row = res.accounts.find(a => a.accountId === accountId)!;
    expect(row.current).toBe(0);
    expect(row.values).toEqual([-30_000, -60_000, -90_000, -120_000]);
  });

  it("zählt eine vierteljährliche Ausgabe in 12 Monaten viermal", async () => {
    const accountId = await insertAccount();
    await callerFor(admin).finance.createRecurring({
      type: "expense",
      accountId,
      amount: 300_000,
      userId: admin.id,
      note: "Quartalszins",
      interval: "quarterly",
      nextDate: firstOfMonth(1),
    });

    const res = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "yearly",
    });
    const row = res.accounts.find(a => a.accountId === accountId)!;
    expect(row.values).toEqual([-1_200_000]);
  });

  it("beendet eine Dauerbuchung mit Enddatum (Regression)", async () => {
    const accountId = await insertAccount();
    await callerFor(admin).finance.createRecurring({
      type: "expense",
      accountId,
      amount: 10_000,
      userId: admin.id,
      note: "Läuft aus",
      interval: "monthly",
      nextDate: firstOfMonth(1),
      endDate: lastOfMonth(2),
    });

    const res = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "quarterly",
    });
    const row = res.accounts.find(a => a.accountId === accountId)!;
    // Zwei Vorkommen, danach nichts mehr — vorher lief die Regel endlos weiter
    expect(row.values).toEqual([-20_000, -20_000, -20_000, -20_000]);
  });

  it("verteilt eine Dauer-Umbuchung auf beide Konten", async () => {
    const from = await insertAccount(500_000);
    const to = await insertAccount();
    await callerFor(admin).finance.createRecurring({
      type: "transfer",
      accountId: from,
      toAccountId: to,
      amount: 20_000,
      userId: admin.id,
      note: "Sparplan",
      interval: "monthly",
      nextDate: firstOfMonth(1),
    });

    const res = await callerFor(admin).forecast.table({
      months: 6,
      granularity: "semiannual",
    });
    expect(res.accounts.find(a => a.accountId === from)!.values).toEqual([
      500_000 - 120_000,
    ]);
    expect(res.accounts.find(a => a.accountId === to)!.values).toEqual([
      120_000,
    ]);
    // Beide Seiten sichtbar: in der Gesamtsicht neutral
    expect(res.flows.transferNet).toEqual([0]);
  });
});

describe("forecast.table (Ein-/Ausgaben und Ø variable Buchungen)", () => {
  it("summiert wiederkehrende Ein-/Ausgaben über die Periode", async () => {
    const accountId = await insertAccount();
    await callerFor(admin).finance.createRecurring({
      type: "income",
      accountId,
      amount: 400_000,
      userId: admin.id,
      note: "Lohn",
      interval: "monthly",
      nextDate: firstOfMonth(1),
    });

    const before = await callerFor(admin).forecast.table({
      months: 3,
      granularity: "quarterly",
    });
    // Die Einnahme wirkt dreimal in der Periode
    expect(
      before.accounts.find(a => a.accountId === accountId)!.values
    ).toEqual([1_200_000]);
    expect(before.flows.income[0]).toBeGreaterThanOrEqual(1_200_000);
  });

  it("bezieht den Ø variabler Buchungen nur in die Gesamtzeile ein", async () => {
    const accountId = await insertAccount();
    // Variable Ausgabe im Vormonat (ohne Dauerbuchung) — sie prägt den Ø
    await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 60_000,
      userId: admin.id,
      date: firstOfMonth(-1),
      note: "Einkauf",
    });

    const off = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "yearly",
      includeVariable: false,
    });
    const on = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "yearly",
      includeVariable: true,
    });

    expect(off.avgVariableExpense).toBeGreaterThan(0);
    expect(on.includeVariable).toBe(true);
    // Kontozeilen bleiben gleich — ein Durchschnitt ist keinem Konto zuordenbar
    expect(on.accounts.find(a => a.accountId === accountId)!.values).toEqual(
      off.accounts.find(a => a.accountId === accountId)!.values
    );
    // Gesamt unterscheidet sich um 12 × (Ø Einnahmen − Ø Ausgaben)
    const expected = 12 * (on.avgVariableIncome - on.avgVariableExpense);
    expect(on.total.values[0] - off.total.values[0]).toBe(expected);
  });
});

describe("forecast.table (Sparziele)", () => {
  it("prognostiziert den Fortschritt und die Periode des Erreichens", async () => {
    const accountId = await insertAccount();
    await callerFor(admin).finance.createRecurring({
      type: "income",
      accountId,
      amount: 50_000,
      userId: admin.id,
      note: "Sparrate",
      interval: "monthly",
      nextDate: firstOfMonth(1),
    });
    const goalId = await createGoal("Reise", 150_000);
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId,
      mode: "full",
    });

    const res = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "monthly",
    });
    const row = res.goals.find(g => g.goalId === goalId)!;
    expect(row.current).toBe(0);
    expect(row.reachedNow).toBe(false);
    expect(row.values.slice(0, 3)).toEqual([50_000, 100_000, 150_000]);
    // Dritte Spalte (Index 2) erreicht den Zielbetrag
    expect(row.reachedIndex).toBe(2);
    expect(row.hasHiddenSources).toBe(false);
  });

  it("markiert ein heute schon erreichtes Ziel nur in der Heute-Spalte", async () => {
    // Guthaben deckt den Zielbetrag bereits ab
    const accountId = await insertAccount(200_000);
    const goalId = await createGoal("Schon erreicht", 100_000);
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId,
      mode: "full",
    });

    const res = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "quarterly",
    });
    const row = res.goals.find(g => g.goalId === goalId)!;
    expect(row.reachedNow).toBe(true);
    // Sonst läse sich die erste Spalte als „hier wird es erreicht"
    expect(row.reachedIndex).toBeNull();
  });

  it("rechnet offene Sparziele ohne Zielbetrag und ohne Erreichen", async () => {
    const accountId = await insertAccount();
    await callerFor(admin).finance.createRecurring({
      type: "income",
      accountId,
      amount: 25_000,
      userId: admin.id,
      note: "Offene Sparrate",
      interval: "monthly",
      nextDate: firstOfMonth(1),
    });
    const goalId = await createGoal("Offener Puffer");
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId,
      mode: "full",
    });

    const res = await callerFor(admin).forecast.table({
      months: 6,
      granularity: "quarterly",
    });
    const row = res.goals.find(g => g.goalId === goalId)!;
    expect(row.targetAmount).toBeNull();
    expect(row.reachedIndex).toBeNull();
    expect(row.reachedNow).toBe(false);
    // Der prognostizierte Stand wird trotzdem gerechnet
    expect(row.values).toEqual([75_000, 150_000]);
  });

  it("wendet den Prozent-Modus einer Quelle je Periode an", async () => {
    const accountId = await insertAccount();
    await callerFor(admin).finance.createRecurring({
      type: "income",
      accountId,
      amount: 100_000,
      userId: admin.id,
      note: "Prozent-Sparrate",
      interval: "monthly",
      nextDate: firstOfMonth(1),
    });
    const goalId = await createGoal("Anteilig", 1_000_000);
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId,
      mode: "percent",
      value: 50,
    });

    const res = await callerFor(admin).forecast.table({
      months: 3,
      granularity: "monthly",
    });
    const row = res.goals.find(g => g.goalId === goalId)!;
    expect(row.values).toEqual([50_000, 100_000, 150_000]);
  });
});

describe("forecast.table (Sichtbarkeit und Nettovermögen)", () => {
  it("lässt private Konten anderer aus Zeilen und Gesamtsumme weg", async () => {
    const privateId = await insertAccount(700_000, admin.id);

    const asAdmin = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "yearly",
    });
    const asMember = await callerFor(member).forecast.table({
      months: 12,
      granularity: "yearly",
    });

    expect(asAdmin.accounts.some(a => a.accountId === privateId)).toBe(true);
    expect(asMember.accounts.some(a => a.accountId === privateId)).toBe(false);
    expect(asMember.total.current).toBe(asAdmin.total.current - 700_000);
  });

  it("liefert netWorth null ohne erfasste Liegenschaft", async () => {
    const res = await callerFor(admin).forecast.table({
      months: 12,
      granularity: "yearly",
    });
    expect(res.netWorth).toBeNull();
    expect(res.mortgageMissingRecurring).toBe(0);
  });

  it("verlangt eine Anmeldung", async () => {
    await expect(
      callerFor().forecast.table({ months: 12, granularity: "yearly" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("forecast.accountBalance", () => {
  it("liefert Monatsendwerte eines Kontos aus den Dauerbuchungen", async () => {
    const accountId = await insertAccount(100_000);
    await callerFor(admin).finance.createRecurring({
      type: "expense",
      accountId,
      amount: 10_000,
      userId: admin.id,
      note: "Abo",
      interval: "monthly",
      nextDate: firstOfMonth(1),
    });

    const res = await callerFor(admin).forecast.accountBalance({
      accountId,
      months: 3,
    });
    expect(res.map(p => p.balance)).toEqual([90_000, 80_000, 70_000]);
    expect(res[0].month).toBe(firstOfMonth(1).slice(0, 7));
    expect(res[0].date).toBe(lastOfMonth(1));
  });

  it("verweigert ein privates Konto eines anderen Nutzers", async () => {
    const privateId = await insertAccount(0, admin.id);
    await expect(
      callerFor(member).forecast.accountBalance({ accountId: privateId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
