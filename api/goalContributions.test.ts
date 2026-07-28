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
let adminContributionId: number;
let memberContributionId: number;

/**
 * Sparziele 2.0: addGoalContribution ist gesperrt — Beiträge sind reiner
 * Alt-Bestand. Diese Tests seeden Beiträge daher direkt in die DB und
 * prüfen die verbleibenden Lese-/Lösch-Endpunkte.
 */
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
  const goal = await getDb()
    .insert(savingsGoals)
    .values({
      name: "Urlaub",
      targetAmount: 10000,
      savedAmount: 2000,
      color: "#0ea5e9",
    })
    .returning({ id: savingsGoals.id });
  goalId = goal[0].id;
  const contribs = await getDb()
    .insert(goalContributions)
    .values([
      {
        goalId,
        userId: admin.id,
        amount: 500,
        note: "Start",
        createdAt: new Date(),
      },
      {
        goalId,
        userId: member.id,
        amount: 750,
        note: "",
        createdAt: new Date(),
      },
    ])
    .returning({ id: goalContributions.id, userId: goalContributions.userId });
  adminContributionId = contribs.find(c => c.userId === admin.id)!.id;
  memberContributionId = contribs.find(c => c.userId === member.id)!.id;
});

beforeEach(() => {
  fetchMock.mockClear();
});

describe("Sparziel-Beiträge (Alt-Bestand, schreibgeschützt)", () => {
  it("listet Beiträge mit User-Infos", async () => {
    const list = await callerFor(member).finance.listGoalContributions({
      goalId,
    });
    expect(list).toHaveLength(2);
    const fromMember = list.find(c => c.id === memberContributionId);
    expect(fromMember?.userId).toBe(member.id);
    expect(fromMember?.userName).toBe("Mitglied");
    expect(fromMember?.userColor).toBe(member.color);
    expect(fromMember?.amount).toBe(750);
    expect(fromMember?.note).toBe("");
    const fromAdmin = list.find(c => c.userId === admin.id);
    expect(fromAdmin?.note).toBe("Start");
  });

  it("verbietet Mitgliedern das Löschen fremder Beiträge", async () => {
    await expect(
      callerFor(member).finance.deleteGoalContribution({
        id: adminContributionId,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Nur eigene Beiträge dürfen gelöscht werden.",
    });
  });

  it("lässt Mitglieder eigene Beiträge löschen", async () => {
    const rows = await getDb()
      .insert(goalContributions)
      .values({
        goalId,
        userId: member.id,
        amount: 100,
        note: "",
        createdAt: new Date(),
      })
      .returning({ id: goalContributions.id });
    await callerFor(member).finance.deleteGoalContribution({ id: rows[0].id });
    await expect(
      callerFor(admin).finance.deleteGoalContribution({ id: rows[0].id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lässt Admins fremde Beiträge löschen", async () => {
    // Admin löscht den fremden Beitrag des Mitglieds
    await callerFor(admin).finance.deleteGoalContribution({
      id: memberContributionId,
    });
    const after = await callerFor(admin).finance.listGoalContributions({
      goalId,
    });
    expect(after.find(c => c.id === memberContributionId)).toBeUndefined();
    expect(after.find(c => c.id === adminContributionId)).toBeDefined();
  });

  it("löscht Beiträge kaskadierend beim Löschen des Ziels", async () => {
    const temp = await getDb()
      .insert(savingsGoals)
      .values({
        name: "Temporär",
        targetAmount: 1000,
        savedAmount: 0,
        color: "#f59e0b",
      })
      .returning({ id: savingsGoals.id });
    await getDb().insert(goalContributions).values({
      goalId: temp[0].id,
      userId: admin.id,
      amount: 100,
      note: "",
      createdAt: new Date(),
    });
    await callerFor(admin).finance.deleteGoal({ id: temp[0].id });
    const rows = await getDb()
      .select()
      .from(goalContributions)
      .where(eq(goalContributions.goalId, temp[0].id));
    expect(rows).toHaveLength(0);
  });
});

describe("Alt-Bestand im Fortschritt", () => {
  it("zählt savedAmount + Beiträge als Quelle „Manuell (Bestand)“", async () => {
    // Urlaub: 2000 Basis + 500 Admin-Beitrag (Member-Beitrag oben gelöscht)
    const goal = (await callerFor(admin).finance.listGoals()).find(
      g => g.id === goalId
    )!;
    expect(goal.savedAmount).toBe(2000);
    expect(goal.totalSaved).toBe(2500);
    const legacy = goal.sources.find(s => s.kind === "legacy");
    expect(legacy?.amount).toBe(2500);
  });
});

describe("Schema", () => {
  it("Tabelle goal_contributions existiert nach ensureSchema", async () => {
    const rows = await getDb().select().from(savingsGoals);
    expect(rows.length).toBeGreaterThan(0);
    // Select auf die Tabelle schlägt fehl, wenn sie nicht existiert
    await expect(
      getDb().select().from(goalContributions)
    ).resolves.toBeDefined();
  });
});
