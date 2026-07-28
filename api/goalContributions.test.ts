import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { goalContributions, savingsGoals, users } from "@db/schema";
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

let goalId: number;

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
  await callerFor(admin).finance.createGoal({
    name: "Urlaub",
    targetAmount: 10000,
    savedAmount: 2000,
    color: "#0ea5e9",
  });
  goalId = (await callerFor(admin).finance.listGoals())[0].id;
});

beforeEach(() => {
  fetchMock.mockClear();
});

describe("Sparziel-Beiträge", () => {
  let memberContributionId: number;

  it("legt Beiträge an und listet sie mit User-Infos", async () => {
    await callerFor(admin).finance.addGoalContribution({
      goalId,
      amount: 500,
      note: "Start",
    });
    const created = await callerFor(member).finance.addGoalContribution({
      goalId,
      amount: 750,
    });
    memberContributionId = created.id;

    const list = await callerFor(member).finance.listGoalContributions({
      goalId,
    });
    expect(list).toHaveLength(2);
    const fromMember = list.find((c) => c.id === memberContributionId);
    expect(fromMember?.userId).toBe(member.id);
    expect(fromMember?.userName).toBe("Mitglied");
    expect(fromMember?.userColor).toBe(member.color);
    expect(fromMember?.amount).toBe(750);
    expect(fromMember?.note).toBe("");
    const fromAdmin = list.find((c) => c.userId === admin.id);
    expect(fromAdmin?.note).toBe("Start");
  });

  it("verbietet Mitgliedern das Löschen fremder Beiträge", async () => {
    const list = await callerFor(member).finance.listGoalContributions({
      goalId,
    });
    const adminContribution = list.find((c) => c.userId === admin.id)!;
    await expect(
      callerFor(member).finance.deleteGoalContribution({
        id: adminContribution.id,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Nur eigene Beiträge dürfen gelöscht werden.",
    });
  });

  it("lässt Admins fremde Beiträge löschen", async () => {
    const list = await callerFor(admin).finance.listGoalContributions({
      goalId,
    });
    const adminContribution = list.find((c) => c.userId === admin.id)!;
    // Admin löscht den fremden Beitrag des Mitglieds
    await callerFor(admin).finance.deleteGoalContribution({
      id: memberContributionId,
    });
    const after = await callerFor(admin).finance.listGoalContributions({
      goalId,
    });
    expect(after.find((c) => c.id === memberContributionId)).toBeUndefined();
    expect(after.find((c) => c.id === adminContribution.id)).toBeDefined();
  });

  it("lässt Mitglieder eigene Beiträge löschen", async () => {
    const created = await callerFor(member).finance.addGoalContribution({
      goalId,
      amount: 100,
    });
    await callerFor(member).finance.deleteGoalContribution({ id: created.id });
    await expect(
      callerFor(admin).finance.deleteGoalContribution({ id: created.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validiert: Betrag muss positiv sein", async () => {
    await expect(
      callerFor(admin).finance.addGoalContribution({ goalId, amount: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerFor(admin).finance.addGoalContribution({ goalId, amount: -500 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validiert: unbekanntes Sparziel wird abgelehnt", async () => {
    await expect(
      callerFor(admin).finance.addGoalContribution({
        goalId: 99999,
        amount: 100,
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Sparziel nicht gefunden.",
    });
  });

  it("löscht Beiträge kaskadierend beim Löschen des Ziels", async () => {
    await callerFor(admin).finance.createGoal({
      name: "Temporär",
      targetAmount: 1000,
      color: "#f59e0b",
    });
    const goals = await callerFor(admin).finance.listGoals();
    const temp = goals.find((g) => g.name === "Temporär")!;
    await callerFor(admin).finance.addGoalContribution({
      goalId: temp.id,
      amount: 100,
    });
    await callerFor(admin).finance.deleteGoal({ id: temp.id });
    const rows = await getDb()
      .select()
      .from(goalContributions)
      .where(eq(goalContributions.goalId, temp.id));
    expect(rows).toHaveLength(0);
  });
});

describe("Gesamtfortschritt (Basis + Beiträge)", () => {
  it("goalForecast summiert savedAmount und Beiträge", async () => {
    await callerFor(admin).finance.createGoal({
      name: "Auto",
      targetAmount: 10000,
      savedAmount: 3000,
      color: "#a855f7",
    });
    const goals = await callerFor(admin).finance.listGoals();
    const auto = goals.find((g) => g.name === "Auto")!;
    await callerFor(admin).finance.addGoalContribution({
      goalId: auto.id,
      amount: 2000,
    });
    await callerFor(member).finance.addGoalContribution({
      goalId: auto.id,
      amount: 1500,
    });

    const forecast = await callerFor(member).forecast.goalForecast();
    const row = forecast.find((f) => f.id === auto.id)!;
    // Gesamt = 3000 Basis + 2000 + 1500 Beiträge
    expect(row.savedAmount).toBe(6500);
    expect(row.remaining).toBe(3500);
  });
});

describe("Meilenstein-Benachrichtigung über Beiträge", () => {
  it("löst beim Überschreiten von 25 % des Gesamtfortschritts aus", async () => {
    await callerFor(admin).finance.setNotifySettings({
      ntfyUrl: "https://ntfy.example.org/t",
      webhookUrl: null,
      events: { budget: true, recurring: true, goal: true },
    });
    await callerFor(admin).finance.createGoal({
      name: "Notgroschen",
      targetAmount: 10000,
      savedAmount: 2000, // 20 %
      color: "#f43f5e",
    });
    const goals = await callerFor(admin).finance.listGoals();
    const goal = goals.find((g) => g.name === "Notgroschen")!;
    const caller = callerFor(member);

    // 20 % → 24 %: noch kein Meilenstein
    await caller.finance.addGoalContribution({ goalId: goal.id, amount: 400 });
    expect(fetchMock).not.toHaveBeenCalled();

    // 24 % → 26 %: 25-%-Meilenstein überschritten
    await caller.finance.addGoalContribution({ goalId: goal.id, amount: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).Title).toContain("25 %");

    // Cleanup: Benachrichtigungs-Konfiguration zurücksetzen
    await callerFor(admin).finance.setNotifySettings({
      ntfyUrl: null,
      webhookUrl: null,
      events: { budget: true, recurring: true, goal: true },
    });
  });
});

describe("Schema", () => {
  it("Tabelle goal_contributions existiert nach ensureSchema", async () => {
    const rows = await getDb().select().from(savingsGoals);
    expect(rows.length).toBeGreaterThan(0);
    // Select auf die neue Tabelle schlägt fehl, wenn sie nicht existiert
    await expect(
      getDb().select().from(goalContributions)
    ).resolves.toBeDefined();
  });
});
