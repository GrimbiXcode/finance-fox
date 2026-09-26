import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, goalSources, users } from "@db/schema";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  normalizeDashboardLayout,
} from "@contracts/dashboard";
import type { SessionUser, TrpcContext } from "./context";

const anna: SessionUser = {
  id: 1,
  email: "a@example.com",
  name: "Anna",
  role: "admin",
  color: "#10b981",
};
const ben: SessionUser = {
  id: 2,
  email: "b@example.com",
  name: "Ben",
  role: "member",
  color: "#6366f1",
};
const as = (user: SessionUser) => {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
};

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [anna, ben])
    await db
      .insert(users)
      .values({ ...u, active: true, createdAt: new Date() });
  await db
    .insert(accounts)
    .values({
      name: "Haushalt",
      type: "checking",
      initialBalance: 0,
      createdAt: new Date(),
    });
});

describe("normalizeDashboardLayout", () => {
  it("verwirft Unbekanntes und Doppeltes, hängt neue Karten sichtbar an", () => {
    const out = normalizeDashboardLayout([
      { id: "recent", visible: false },
      { id: "gibtsnicht", visible: true },
      { id: "recent", visible: true },
      { id: "kpis" },
    ]);
    expect(out[0]).toEqual({ id: "recent", visible: false });
    expect(out[1]).toEqual({ id: "kpis", visible: true });
    expect(out).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.length);
    expect(normalizeDashboardLayout("kaputt")).toBe(DEFAULT_DASHBOARD_LAYOUT);
  });
});

describe("auth.setDashboardLayout", () => {
  it("speichert pro Benutzer und setzt mit null zurück", async () => {
    expect((await as(anna).auth.me())?.dashboardCustomized).toBe(false);
    await as(anna).auth.setDashboardLayout({
      layout: [
        { id: "goals", visible: true },
        { id: "attention", visible: false },
      ],
    });
    const me = await as(anna).auth.me();
    expect(me?.dashboardCustomized).toBe(true);
    expect(me?.dashboardLayout.slice(0, 2)).toEqual([
      { id: "goals", visible: true },
      { id: "attention", visible: false },
    ]);
    // Ben bleibt beim Standard
    expect((await as(ben).auth.me())?.dashboardLayout).toEqual(
      DEFAULT_DASHBOARD_LAYOUT
    );
    await as(anna).auth.setDashboardLayout({ layout: null });
    expect((await as(anna).auth.me())?.dashboardCustomized).toBe(false);
  });
});

describe("finance.setGoalArchived", () => {
  it("löst die Verknüpfungen, blendet das Ziel aus Prognosen aus und holt es zurück", async () => {
    await as(anna).finance.createGoal({
      name: "Velo",
      targetAmount: 100_000,
      color: "#D9692C",
    });
    const goal = (await as(anna).finance.listGoals()).find(
      g => g.name === "Velo"
    )!;
    const account = (await as(anna).finance.listAccounts())[0];
    await as(anna).finance.addGoalSource({
      goalId: goal.id,
      accountId: account.id,
      mode: "full",
    });
    expect(
      (await as(anna).forecast.goalForecast()).some(g => g.goalId === goal.id)
    ).toBe(true);

    const res = await as(ben).finance.setGoalArchived({
      id: goal.id,
      archived: true,
    });
    expect(res.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const archived = (await as(anna).finance.listGoals()).find(
      g => g.id === goal.id
    )!;
    expect(archived.archivedAt).toBe(res.archivedAt);
    expect(archived.sources.filter(s => s.kind === "account")).toHaveLength(0);
    expect(
      (await as(anna).forecast.goalForecast()).some(g => g.goalId === goal.id)
    ).toBe(false);
    const log = await as(anna).finance.listAuditLog({ entity: "goal" });
    expect(log[0].action).toBe("goal.archived");

    await as(anna).finance.setGoalArchived({ id: goal.id, archived: false });
    expect(
      (await as(anna).finance.listGoals()).find(g => g.id === goal.id)!
        .archivedAt
    ).toBeNull();
    await expect(
      as(anna).finance.setGoalArchived({ id: 9999, archived: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("schützt laufende Ziele und das Archiv vor Nebenwirkungen", async () => {
    const account = (await as(anna).finance.listAccounts())[0];
    await as(anna).finance.createGoal({
      name: "Laufend",
      targetAmount: 50_000,
      color: "#2F7D4A",
    });
    const running = (await as(anna).finance.listGoals()).find(
      g => g.name === "Laufend"
    )!;
    await as(anna).finance.addGoalSource({
      goalId: running.id,
      accountId: account.id,
      mode: "percent",
      value: 10,
    });
    // „Zurückholen“ eines laufenden Ziels lässt seine Quellen stehen
    await as(anna).finance.setGoalArchived({ id: running.id, archived: false });
    const after = (await as(anna).finance.listGoals()).find(
      g => g.id === running.id
    )!;
    expect(after.sources.filter(s => s.kind === "account")).toHaveLength(1);

    // Zweimal abschließen: erstes Datum bleibt, ein Log-Eintrag
    const first = await as(anna).finance.setGoalArchived({
      id: running.id,
      archived: true,
    });
    const second = await as(anna).finance.setGoalArchived({
      id: running.id,
      archived: true,
    });
    expect(second.archivedAt).toBe(first.archivedAt);
    const log = await as(anna).finance.listAuditLog({ entity: "goal" });
    expect(
      log.filter(e => e.entityId === running.id && e.action === "goal.archived")
    ).toHaveLength(1);

    // Neue Quellen nur für laufende Ziele
    await expect(
      as(anna).finance.addGoalSource({
        goalId: running.id,
        accountId: account.id,
        mode: "full",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Kommt über den Abgleich doch eine Quelle an ein archiviertes Ziel,
    // verplant sie das Konto nicht
    await getDb()
      .insert(goalSources)
      .values({
        goalId: running.id,
        accountId: account.id,
        mode: "full",
        value: null,
        createdAt: new Date(),
      });
    const availability = await as(anna).finance.goalSourceAvailability({
      accountId: account.id,
    });
    expect(availability.hasFullSource).toBe(false);
    expect(availability.committedTotal).toBe(0);
    const archivedGoal = (await as(anna).finance.listGoals()).find(
      g => g.id === running.id
    )!;
    expect(archivedGoal.sources.filter(s => s.kind === "account")).toHaveLength(0);

    // … und Zurückholen startet ohne sie
    await as(anna).finance.setGoalArchived({ id: running.id, archived: false });
    const restored = (await as(anna).finance.listGoals()).find(
      g => g.id === running.id
    )!;
    expect(restored.sources.filter(s => s.kind === "account")).toHaveLength(0);
  });
});
