import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { computeGoalProgress } from "./lib/goalProgress";
import {
  accounts,
  goalContributions,
  goalSources,
  recurring,
  savingsGoals,
  users,
} from "@db/schema";
import { eq } from "drizzle-orm";
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

const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

/** Datum als YYYY-MM-DD (lokal) */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monats-Key (YYYY-MM) um n Monate verschieben — wie im forecastRouter */
function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function createAccount(
  name: string,
  initialBalance: number,
  ownerId: number | null = null
): Promise<number> {
  const rows = await getDb()
    .insert(accounts)
    .values({
      name,
      type: "savings",
      initialBalance,
      ownerId,
      createdAt: new Date(),
    })
    .returning({ id: accounts.id });
  return rows[0].id;
}

async function createGoalDb(
  name: string,
  targetAmount: number,
  savedAmount = 0
): Promise<number> {
  const rows = await getDb()
    .insert(savingsGoals)
    .values({ name, targetAmount, savedAmount, color: "#0ea5e9" })
    .returning({ id: savingsGoals.id });
  return rows[0].id;
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  vi.stubGlobal("fetch", fetchMock);
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
});

beforeEach(() => {
  fetchMock.mockClear();
});

describe("Quellen-CRUD und Validierung", () => {
  it("verknüpft ein Konto und lehnt Duplikate mit CONFLICT ab", async () => {
    const accountId = await createAccount("Giro", 100000);
    const goalId = await createGoalDb("Urlaub", 500000);
    const caller = callerFor(admin);

    const created = await caller.finance.addGoalSource({
      goalId,
      accountId,
      mode: "full",
    });
    expect(created.id).toBeGreaterThan(0);

    await expect(
      caller.finance.addGoalSource({
        goalId,
        accountId,
        mode: "percent",
        value: 50,
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Dieses Konto ist bereits mit dem Sparziel verknüpft.",
    });

    // Verknüpfung wieder entfernen
    await caller.finance.deleteGoalSource({ id: created.id });
    const goals = await caller.finance.listGoals();
    expect(goals.find(g => g.id === goalId)?.sources).toHaveLength(0);
  });

  it("validiert Modus und Wert mit deutschen Meldungen", async () => {
    const accountId = await createAccount("Extra", 1000);
    const goalId = await createGoalDb("Validierung", 100000);
    const caller = callerFor(admin);

    await expect(
      caller.finance.addGoalSource({
        goalId,
        accountId,
        mode: "full",
        value: 5,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Beim Modus „Ganzes Konto“ darf kein Wert angegeben werden.",
    });
    await expect(
      caller.finance.addGoalSource({ goalId, accountId, mode: "absolute" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Beim Modus „Absoluter Betrag“ muss ein Betrag größer 0 angegeben werden.",
    });
    await expect(
      caller.finance.addGoalSource({
        goalId,
        accountId,
        mode: "absolute",
        value: 0,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.finance.addGoalSource({
        goalId,
        accountId,
        mode: "percent",
        value: 0,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Beim Modus „Prozent“ muss ein Wert zwischen 1 und 100 angegeben werden.",
    });
    await expect(
      caller.finance.addGoalSource({
        goalId,
        accountId,
        mode: "percent",
        value: 101,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lehnt unbekannte Ziele und nicht sichtbare Konten ab", async () => {
    const accountId = await createAccount("Sichtbar", 1000);
    const privateId = await createAccount("Admin-Privat", 50000, admin.id);
    const goalId = await createGoalDb("Rechte", 100000);

    await expect(
      callerFor(admin).finance.addGoalSource({
        goalId: 99999,
        accountId,
        mode: "full",
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Sparziel nicht gefunden.",
    });
    // Privates Konto des Admins ist für das Mitglied nicht sichtbar
    await expect(
      callerFor(member).finance.addGoalSource({
        goalId,
        accountId: privateId,
        mode: "full",
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Konto nicht gefunden.",
    });
  });

  it("darf eine Verknüpfung nur mit sichtbarem Konto lösen", async () => {
    const privateId = await createAccount("Privat-Löschen", 50000, admin.id);
    const goalId = await createGoalDb("Löschrecht", 100000);
    const created = await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId: privateId,
      mode: "full",
    });
    await expect(
      callerFor(member).finance.deleteGoalSource({ id: created.id })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Konto nicht gefunden.",
    });
    await callerFor(admin).finance.deleteGoalSource({ id: created.id });
  });
});

describe("Fortschrittsformel", () => {
  it("rechnet full/absolute/percent inkl. Kappung und Rundung", async () => {
    const fullAcc = await createAccount("Full", 100000);
    const absAcc = await createAccount("Absolut", 100000);
    const cappedAcc = await createAccount("Gedeckelt", 100000);
    const pctAcc = await createAccount("Prozent", 999);
    const goalId = await createGoalDb("Formel", 1000000);
    const caller = callerFor(admin);

    await caller.finance.addGoalSource({
      goalId,
      accountId: fullAcc,
      mode: "full",
    });
    await caller.finance.addGoalSource({
      goalId,
      accountId: absAcc,
      mode: "absolute",
      value: 30000,
    });
    // Kappung: Anteil größer als der Saldo → Saldo zählt
    await caller.finance.addGoalSource({
      goalId,
      accountId: cappedAcc,
      mode: "absolute",
      value: 150000,
    });
    // Rundung: 999 × 50 % = 499,5 → 500
    await caller.finance.addGoalSource({
      goalId,
      accountId: pctAcc,
      mode: "percent",
      value: 50,
    });

    const goal = (await caller.finance.listGoals()).find(g => g.id === goalId)!;
    // 100000 + 30000 + 100000 (gekappt) + 500
    expect(goal.totalSaved).toBe(230500);
    expect(goal.percent).toBe(23);
    const byAccount = new Map(goal.sources.map(s => [s.accountId, s.amount]));
    expect(byAccount.get(fullAcc)).toBe(100000);
    expect(byAccount.get(absAcc)).toBe(30000);
    expect(byAccount.get(cappedAcc)).toBe(100000);
    expect(byAccount.get(pctAcc)).toBe(500);
  });

  it("zählt negative Salden als 0", async () => {
    const accountId = await createAccount("Minus", 0);
    const goalId = await createGoalDb("Negativ", 100000);
    const caller = callerFor(admin);
    await caller.finance.addGoalSource({ goalId, accountId, mode: "full" });
    // Konto ins Minus buchen
    await caller.finance.createTransaction({
      type: "expense",
      accountId,
      amount: 5000,
      userId: admin.id,
      date: todayISO(),
      note: "",
    });
    const goal = (await caller.finance.listGoals()).find(g => g.id === goalId)!;
    expect(goal.totalSaved).toBe(0);
  });

  it("summiert Alt-Bestand (savedAmount + Beiträge) als Quelle „Manuell“", async () => {
    const goalId = await createGoalDb("Bestand", 100000, 3000);
    await getDb()
      .insert(goalContributions)
      .values([
        {
          goalId,
          userId: admin.id,
          amount: 2000,
          note: "",
          createdAt: new Date(),
        },
        {
          goalId,
          userId: member.id,
          amount: 1500,
          note: "",
          createdAt: new Date(),
        },
      ]);
    const goal = (await callerFor(admin).finance.listGoals()).find(
      g => g.id === goalId
    )!;
    expect(goal.totalSaved).toBe(6500);
    const legacy = goal.sources.find(s => s.kind === "legacy");
    expect(legacy?.amount).toBe(6500);
  });
});

describe("Sichtbarkeit der Quellen", () => {
  it("verbirgt Quellen auf fremden Privatkonten ohne Leak", async () => {
    const privateId = await createAccount("Geheimkonto", 50000, admin.id);
    const goalId = await createGoalDb("Gemeinsam", 100000);
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId: privateId,
      mode: "full",
    });

    const forMember = (await callerFor(member).finance.listGoals()).find(
      g => g.id === goalId
    )!;
    expect(forMember.totalSaved).toBe(0);
    expect(forMember.sources).toHaveLength(0);
    expect(forMember.hasHiddenSources).toBe(true);

    const forAdmin = (await callerFor(admin).finance.listGoals()).find(
      g => g.id === goalId
    )!;
    expect(forAdmin.totalSaved).toBe(50000);
    expect(forAdmin.hasHiddenSources).toBe(false);

    // Ungefilterte Systemperspektive (für Benachrichtigungen)
    const goalRow = await getDb().query.savingsGoals.findFirst({
      where: eq(savingsGoals.id, goalId),
    });
    const unfiltered = await computeGoalProgress(getDb(), null, goalRow!);
    expect(unfiltered.total).toBe(50000);
    expect(unfiltered.hasHiddenSources).toBe(false);
  });
});

describe("Gesperrte Legacy-Mutationen", () => {
  it("lehnt updateGoalSaved und addGoalContribution mit Hinweis ab", async () => {
    const goalId = await createGoalDb("Legacy", 100000, 1000);
    const caller = callerFor(admin);
    const message =
      "Manuelle Einzahlungen sind nicht mehr möglich — verknüpfe das Sparziel mit einem Konto.";
    await expect(
      caller.finance.updateGoalSaved({ id: goalId, savedAmount: 5000 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message });
    await expect(
      caller.finance.addGoalContribution({ goalId, amount: 500 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message });
    // Bestand bleibt lesbar
    await expect(
      caller.finance.listGoalContributions({ goalId })
    ).resolves.toBeDefined();
    const goal = (await caller.finance.listGoals()).find(g => g.id === goalId)!;
    expect(goal.totalSaved).toBe(1000);
  });
});

describe("Prognose (goalForecast)", () => {
  it("findet die ETA über eine wiederkehrende Buchung auf dem verknüpften Konto", async () => {
    const accountId = await createAccount("Spar-Auto", 0);
    const goalId = await createGoalDb("Auto", 100000);
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId,
      mode: "full",
    });
    // 250 €/Monat aufs Sparkonto → Ziel (1'000 €) nach 4 Monaten erreicht
    await getDb().insert(recurring).values({
      type: "income",
      accountId,
      amount: 25000,
      userId: admin.id,
      interval: "monthly",
      nextDate: todayISO(),
      active: true,
      createdAt: new Date(),
    });

    const forecast = await callerFor(member).forecast.goalForecast();
    const row = forecast.find(f => f.goalId === goalId)!;
    const currentKey = todayISO().slice(0, 7);
    expect(row.total).toBe(0);
    expect(row.remaining).toBe(100000);
    expect(row.etaMonth).toBe(addMonths(currentKey, 4));
    expect(row.monthlyRate).toBe(25000);
  });

  it("meldet ohne Dauerbuchung etaMonth null", async () => {
    const accountId = await createAccount("Still", 10000);
    const goalId = await createGoalDb("Ohne Rate", 100000);
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId,
      mode: "full",
    });
    const forecast = await callerFor(admin).forecast.goalForecast();
    const row = forecast.find(f => f.goalId === goalId)!;
    expect(row.total).toBe(10000);
    expect(row.etaMonth).toBeNull();
    expect(row.monthlyRate).toBe(0);
  });
});

describe("Meilenstein-Benachrichtigungen", () => {
  async function configureNotify(ntfyUrl: string | null) {
    await callerFor(admin).finance.setNotifySettings({
      ntfyUrl,
      webhookUrl: null,
      events: { budget: true, recurring: true, goal: true },
    });
  }

  it("löst beim Verknüpfen eines Kontos aus (ungefilterter Gesamtwert)", async () => {
    await configureNotify("https://ntfy.example.org/t");
    const accountId = await createAccount("Meilenstein", 3000);
    const goalId = await createGoalDb("Verknüpfungs-Meilenstein", 10000);
    // 0 % → 30 %: 25-%-Meilenstein kippt beim Verknüpfen
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId,
      mode: "full",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).Title).toContain("25 %");
    await configureNotify(null);
  });

  it("löst bei einer Buchung auf dem verknüpften Konto aus", async () => {
    await configureNotify("https://ntfy.example.org/t");
    const accountId = await createAccount("Buchungskonto", 2000); // 20 %
    const goalId = await createGoalDb("Buchungs-Meilenstein", 10000);
    const caller = callerFor(admin);
    await caller.finance.addGoalSource({ goalId, accountId, mode: "full" });
    expect(fetchMock).not.toHaveBeenCalled();

    const income = (amount: number) =>
      caller.finance.createTransaction({
        type: "income",
        accountId,
        amount,
        userId: admin.id,
        date: todayISO(),
        note: "",
      });

    await income(400); // 20 % → 24 %: noch kein Meilenstein
    expect(fetchMock).not.toHaveBeenCalled();

    await income(200); // 24 % → 26 %: 25-%-Meilenstein überschritten
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).Title).toContain("25 %");
    await configureNotify(null);
  });
});

describe("Sparziel bearbeiten (updateGoal)", () => {
  it("ändert Name, Zielbetrag, Farbe und setzt/entfernt den Stichtag", async () => {
    const goalId = await createGoalDb("Alt", 100000);
    const caller = callerFor(admin);

    await caller.finance.updateGoal({
      id: goalId,
      name: "Neu",
      targetAmount: 250000,
      color: "#f59e0b",
      deadline: "2030-12-31",
    });
    const updated = (await caller.finance.listGoals()).find(
      g => g.id === goalId
    )!;
    expect(updated.name).toBe("Neu");
    expect(updated.targetAmount).toBe(250000);
    expect(updated.color).toBe("#f59e0b");
    expect(updated.deadline).toBe("2030-12-31");

    // Stichtag entfernen (null)
    await caller.finance.updateGoal({
      id: goalId,
      name: "Neu",
      targetAmount: 250000,
      color: "#f59e0b",
      deadline: null,
    });
    const cleared = (await caller.finance.listGoals()).find(
      g => g.id === goalId
    )!;
    expect(cleared.deadline).toBeNull();
  });

  it("lehnt unbekannte Ziele mit NOT_FOUND ab", async () => {
    await expect(
      callerFor(admin).finance.updateGoal({
        id: 99999,
        name: "Gibt es nicht",
        targetAmount: 1000,
        color: "#0ea5e9",
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Sparziel nicht gefunden.",
    });
  });

  it("validiert Zielbetrag, Farbe und Stichtag", async () => {
    const goalId = await createGoalDb("Validierung", 100000);
    const caller = callerFor(admin);
    const base = { id: goalId, name: "Validierung", color: "#0ea5e9" };
    await expect(
      caller.finance.updateGoal({ ...base, targetAmount: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.finance.updateGoal({ ...base, targetAmount: 1000, color: "rot" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.finance.updateGoal({
        ...base,
        targetAmount: 1000,
        deadline: "31.12.2030",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Unverändert nach den fehlgeschlagenen Versuchen
    const goal = (await caller.finance.listGoals()).find(g => g.id === goalId)!;
    expect(goal.targetAmount).toBe(100000);
  });

  it("schreibt einen Audit-Eintrag goal.updated", async () => {
    const goalId = await createGoalDb("Audit-Alt", 50000);
    const caller = callerFor(admin);
    await caller.finance.updateGoal({
      id: goalId,
      name: "Audit-Neu",
      targetAmount: 60000,
      color: "#0ea5e9",
    });
    const entries = await caller.finance.listAuditLog({ entity: "goal" });
    const entry = entries.find(
      e => e.action === "goal.updated" && e.entityId === goalId
    );
    expect(entry?.detail).toContain("Audit-Neu");
  });
});

describe("Kaskaden", () => {
  it("löscht Quellen kaskadierend beim Löschen des Ziels", async () => {
    const accountId = await createAccount("Kaskade", 1000);
    const goalId = await createGoalDb("Weg damit", 100000);
    await callerFor(admin).finance.addGoalSource({
      goalId,
      accountId,
      mode: "full",
    });
    await callerFor(admin).finance.deleteGoal({ id: goalId });
    const rows = await getDb()
      .select()
      .from(goalSources)
      .where(eq(goalSources.goalId, goalId));
    expect(rows).toHaveLength(0);
  });

  it("Tabelle goal_sources existiert nach ensureSchema", async () => {
    await expect(getDb().select().from(goalSources)).resolves.toBeDefined();
  });
});
