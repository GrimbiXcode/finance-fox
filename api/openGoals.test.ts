import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, savingsGoals, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

/** Minimal-Typ für den better-sqlite3-kompatiblen Proxy (wie in migrate.ts) */
type RawClient = {
  prepare(sql: string): { raw(): { all(...params: unknown[]): unknown[][] } };
};

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

const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

/** Datum als YYYY-MM-DD (lokal) */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function createAccount(
  name: string,
  initialBalance: number
): Promise<number> {
  const rows = await getDb()
    .insert(accounts)
    .values({
      name,
      type: "savings",
      initialBalance,
      createdAt: new Date(),
    })
    .returning({ id: accounts.id });
  return rows[0].id;
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  vi.stubGlobal("fetch", fetchMock);
  await getDb().insert(users).values({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    color: admin.color,
    active: true,
    createdAt: new Date(),
  });
});

beforeEach(() => {
  fetchMock.mockClear();
});

describe("Migration: target_amount wird nullable", () => {
  it("baut eine Bestands-Tabelle mit NOT NULL um, Daten bleiben erhalten", async () => {
    const db = getDb();
    // Alt-Stand simulieren: Tabelle mit NOT NULL auf target_amount
    db.run("DROP TABLE savings_goals" as never);
    db.run(
      `CREATE TABLE savings_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        target_amount INTEGER NOT NULL,
        saved_amount INTEGER NOT NULL DEFAULT 0,
        color TEXT NOT NULL,
        deadline TEXT
      )` as never
    );
    db.run(
      `INSERT INTO savings_goals (name, target_amount, saved_amount, color, deadline)
       VALUES ('Alt-Ziel', 500000, 12345, '#0ea5e9', '2030-01-01')` as never
    );

    ensureSchema();

    const raw = (db as unknown as { $client: RawClient }).$client;
    const cols = raw.prepare("PRAGMA table_info(savings_goals)").raw().all();
    const targetCol = cols.find(c => c[1] === "target_amount");
    expect(targetCol).toBeDefined();
    expect(targetCol![3]).toBe(0); // notnull-Flag entfernt

    const migrated = (await db.select().from(savingsGoals)).find(
      r => r.name === "Alt-Ziel"
    );
    expect(migrated?.targetAmount).toBe(500000);
    expect(migrated?.savedAmount).toBe(12345);
    expect(migrated?.color).toBe("#0ea5e9");
    expect(migrated?.deadline).toBe("2030-01-01");

    // Idempotent: zweiter Lauf läuft fehlerfrei, NULL ist jetzt erlaubt
    ensureSchema();
    db.run(
      `INSERT INTO savings_goals (name, target_amount, color)
       VALUES ('Offenes Alt-Ziel', NULL, '#10b981')` as never
    );
    ensureSchema();
    const open = (await db.select().from(savingsGoals)).find(
      r => r.name === "Offenes Alt-Ziel"
    );
    expect(open?.targetAmount).toBeNull();
  });
});

describe("Offene Sparziele (ohne Zielbetrag)", () => {
  it("legt ein Ziel ohne Zielbetrag an und ändert ihn per updateGoal", async () => {
    const caller = callerFor(admin);
    await caller.finance.createGoal({
      name: "Notgroschen",
      targetAmount: null,
      color: "#0ea5e9",
    });
    const created = (await caller.finance.listGoals()).find(
      g => g.name === "Notgroschen"
    )!;
    expect(created.targetAmount).toBeNull();
    expect(created.percent).toBeNull();

    // Zielbetrag nachträglich setzen und wieder entfernen
    await caller.finance.updateGoal({
      id: created.id,
      name: "Notgroschen",
      targetAmount: 100000,
      color: "#0ea5e9",
    });
    let updated = (await caller.finance.listGoals()).find(
      g => g.id === created.id
    )!;
    expect(updated.targetAmount).toBe(100000);

    await caller.finance.updateGoal({
      id: created.id,
      name: "Notgroschen",
      targetAmount: null,
      color: "#0ea5e9",
    });
    updated = (await caller.finance.listGoals()).find(
      g => g.id === created.id
    )!;
    expect(updated.targetAmount).toBeNull();
    expect(updated.percent).toBeNull();
  });

  it("lehnt ungültige Zielbeträge weiterhin ab", async () => {
    const caller = callerFor(admin);
    await expect(
      caller.finance.createGoal({
        name: "Ungültig",
        targetAmount: 0,
        color: "#0ea5e9",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.finance.createGoal({
        name: "Ungültig",
        targetAmount: -500,
        color: "#0ea5e9",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("zählt den Fortschritt aus verknüpften Quellen trotz fehlendem Ziel", async () => {
    const caller = callerFor(admin);
    const accountId = await createAccount("Sparkonto offen", 42000);
    await caller.finance.createGoal({
      name: "Offenes Sparen",
      color: "#10b981",
    });
    const goal = (await caller.finance.listGoals()).find(
      g => g.name === "Offenes Sparen"
    )!;
    await caller.finance.addGoalSource({
      goalId: goal.id,
      accountId,
      mode: "full",
    });

    const loaded = (await caller.finance.listGoals()).find(
      g => g.id === goal.id
    )!;
    expect(loaded.targetAmount).toBeNull();
    expect(loaded.percent).toBeNull();
    expect(loaded.totalSaved).toBe(42000);
    expect(loaded.sources).toHaveLength(1);
  });

  it("löst keine Meilenstein-Benachrichtigungen aus", async () => {
    const caller = callerFor(admin);
    await caller.finance.setNotifySettings({
      ntfyUrl: "https://ntfy.example.org/t",
      webhookUrl: null,
      events: { budget: true, recurring: true, goal: true },
    });
    const accountId = await createAccount("Meilenstein-frei", 100000);
    await caller.finance.createGoal({
      name: "Ohne Meilensteine",
      targetAmount: null,
      color: "#f59e0b",
    });
    const goal = (await caller.finance.listGoals()).find(
      g => g.name === "Ohne Meilensteine"
    )!;

    // Verknüpfen: kein Meilenstein-Vergleich für offene Ziele
    await caller.finance.addGoalSource({
      goalId: goal.id,
      accountId,
      mode: "full",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Buchung auf dem verknüpften Konto: ebenfalls keine Meldung
    await caller.finance.createTransaction({
      type: "income",
      accountId,
      amount: 50000,
      userId: admin.id,
      date: todayISO(),
      note: "",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await caller.finance.setNotifySettings({
      ntfyUrl: null,
      webhookUrl: null,
      events: { budget: true, recurring: true, goal: true },
    });
  });

  it("liefert in der Prognose total, aber kein ETA und keinen Restbetrag", async () => {
    const caller = callerFor(admin);
    const accountId = await createAccount("Prognose offen", 25000);
    await caller.finance.createGoal({
      name: "Prognose-Ziel offen",
      color: "#6366f1",
    });
    const goal = (await caller.finance.listGoals()).find(
      g => g.name === "Prognose-Ziel offen"
    )!;
    await caller.finance.addGoalSource({
      goalId: goal.id,
      accountId,
      mode: "full",
    });

    const forecast = await caller.forecast.goalForecast();
    const row = forecast.find(f => f.goalId === goal.id)!;
    expect(row.targetAmount).toBeNull();
    expect(row.total).toBe(25000);
    expect(row.remaining).toBeNull();
    expect(row.etaMonth).toBeNull();
  });
});
