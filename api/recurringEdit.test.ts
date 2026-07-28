import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, categories, recurring, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1, email: "admin@example.com", name: "Admin", role: "admin", color: "#10b981",
};
const owner: SessionUser = {
  id: 2, email: "owner@example.com", name: "Besitzer", role: "member", color: "#6366f1",
};
const stranger: SessionUser = {
  id: 3, email: "stranger@example.com", name: "Fremder", role: "member", color: "#94a3b8",
};

const ALL_USERS = [admin, owner, stranger];

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

let nameCounter = 0;

/** Konto direkt in der DB anlegen (eindeutiger Name pro Aufruf) */
async function insertAccount(ownerId: number | null): Promise<number> {
  nameCounter += 1;
  const rows = await getDb().insert(accounts).values({
    name: `Konto ${nameCounter}`,
    type: "checking",
    initialBalance: 0,
    ownerId,
    createdAt: new Date(),
  }).returning({ id: accounts.id });
  return rows[0].id;
}

/** Dauerbuchung über die API anlegen und die ID zurückgeben */
async function insertRecurring(
  user: SessionUser,
  overrides: Partial<Parameters<ReturnType<typeof callerFor>["finance"]["createRecurring"]>[0]> = {},
): Promise<number> {
  const accountId = overrides.accountId ?? (await insertAccount(null));
  await callerFor(user).finance.createRecurring({
    type: "expense",
    accountId,
    amount: 10000,
    userId: user.id,
    note: "Miete",
    interval: "monthly",
    nextDate: "2030-01-01",
    ...overrides,
  });
  const row = await getDb().query.recurring.findFirst({
    where: and(eq(recurring.accountId, accountId), eq(recurring.note, overrides.note ?? "Miete")),
    orderBy: (r, { desc }) => desc(r.id),
  });
  return row!.id;
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const now = new Date();
  for (const u of ALL_USERS) {
    await getDb().insert(users).values({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      active: true,
      createdAt: now,
    });
  }
});

describe("updateRecurring (Felder)", () => {
  it("aktualisiert Einzelfelder und Kombinationen, type bleibt unverändert", async () => {
    const id = await insertRecurring(owner);

    await callerFor(owner).finance.updateRecurring({ id, amount: 25000 });
    await callerFor(owner).finance.updateRecurring({
      id, note: "Kaltmiete", interval: "weekly", nextDate: "2030-06-15",
    });

    const row = await getDb().query.recurring.findFirst({
      where: eq(recurring.id, id),
    });
    expect(row).toMatchObject({
      type: "expense", // unveränderlich
      amount: 25000,
      note: "Kaltmiete",
      interval: "weekly",
      nextDate: "2030-06-15",
    });
  });

  it("setzt und entfernt die Kategorie (null)", async () => {
    const caller = callerFor(owner);
    await caller.finance.createCategory({
      name: "Wohnen", type: "expense", color: "#0ea5e9",
    });
    const cat = await getDb().query.categories.findFirst({
      where: eq(categories.name, "Wohnen"),
    });
    const catId = cat!.id;
    const id = await insertRecurring(owner);

    await caller.finance.updateRecurring({ id, categoryId: catId });
    let row = await getDb().query.recurring.findFirst({ where: eq(recurring.id, id) });
    expect(row!.categoryId).toBe(catId);

    await caller.finance.updateRecurring({ id, categoryId: null });
    row = await getDb().query.recurring.findFirst({ where: eq(recurring.id, id) });
    expect(row!.categoryId).toBeNull();
  });

  it("verschiebt die Dauerbuchung auf ein anderes Gemeinschaftskonto", async () => {
    const target = await insertAccount(null);
    const id = await insertRecurring(owner);
    await callerFor(stranger).finance.updateRecurring({ id, accountId: target });
    const row = await getDb().query.recurring.findFirst({ where: eq(recurring.id, id) });
    expect(row!.accountId).toBe(target);
  });
});

describe("updateRecurring (Rechte)", () => {
  it("fremdes Privatkonto → NOT_FOUND", async () => {
    const priv = await insertAccount(owner.id);
    const id = await insertRecurring(owner, { accountId: priv });
    await expect(
      callerFor(stranger).finance.updateRecurring({ id, note: "Hack" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Konto-Wechsel ohne edit auf dem Zielkonto → NOT_FOUND", async () => {
    const priv = await insertAccount(owner.id);
    const id = await insertRecurring(owner); // Gemeinschaftskonto
    // Admin darf fremde Privatkonten nur ansehen (view), nicht bearbeiten
    await expect(
      callerFor(admin).finance.updateRecurring({ id, accountId: priv })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Umbuchung: Zielwechsel mit view aufs Ziel erlaubt, ohne Sichtbarkeit nicht", async () => {
    const sharedTarget = await insertAccount(null);
    const privTarget = await insertAccount(stranger.id);
    const from = await insertAccount(null);
    const to = await insertAccount(null);
    const id = await insertRecurring(owner, {
      type: "transfer", accountId: from, toAccountId: to, note: "Dauerauftrag",
    });

    // Ziel ist ein Gemeinschaftskonto → für alle mindestens sichtbar
    await callerFor(owner).finance.updateRecurring({ id, toAccountId: sharedTarget });
    const row = await getDb().query.recurring.findFirst({ where: eq(recurring.id, id) });
    expect(row!.toAccountId).toBe(sharedTarget);

    // Fremdes Privatkonto als Ziel: owner sieht es nicht → NOT_FOUND
    await expect(
      callerFor(owner).finance.updateRecurring({ id, toAccountId: privTarget })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateRecurring (Validierung)", () => {
  it("lehnt Umbuchung mit Quell- gleich Zielkonto ab", async () => {
    const from = await insertAccount(null);
    const to = await insertAccount(null);
    const id = await insertRecurring(owner, {
      type: "transfer", accountId: from, toAccountId: to, note: "Dauerauftrag",
    });
    await expect(
      callerFor(owner).finance.updateRecurring({ id, toAccountId: from })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lehnt ungültige Beträge und Datumsformate ab", async () => {
    const id = await insertRecurring(owner);
    await expect(
      callerFor(owner).finance.updateRecurring({ id, amount: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerFor(owner).finance.updateRecurring({ id, amount: -500 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerFor(owner).finance.updateRecurring({ id, nextDate: "15.06.2030" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("unbekannte ID → NOT_FOUND", async () => {
    await expect(
      callerFor(owner).finance.updateRecurring({ id: 999999, note: "x" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateRecurring (Audit)", () => {
  it("schreibt einen recurring.updated-Eintrag", async () => {
    const id = await insertRecurring(owner, { note: "Strom" });
    await callerFor(owner).finance.updateRecurring({ id, amount: 4200 });

    const entries = await callerFor(admin).finance.listAuditLog({ entity: "recurring" });
    const entry = entries.find(
      e => e.action === "recurring.updated" && e.entityId === id
    );
    expect(entry).toBeDefined();
    expect(entry!.userName).toBe("Besitzer");
    expect(entry!.detail).toContain("Strom");
  });
});
