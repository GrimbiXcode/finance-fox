import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { runRecurringJob } from "./lib/recurringJob";
import { accountOwners, accounts, recurring, transactions, users } from "@db/schema";
import { isRecurringArchived, sortRecurring } from "@/lib/recurring";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1, email: "admin@example.com", name: "Admin", role: "admin", color: "#10b981",
};
const owner: SessionUser = {
  id: 2, email: "owner@example.com", name: "Besitzer", role: "member", color: "#6366f1",
};

const ALL_USERS = [admin, owner];

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

let nameCounter = 0;

/** Konto direkt in der DB anlegen (eindeutiger Name pro Aufruf) */
async function insertAccount(ownerId: number | null): Promise<number> {
  nameCounter += 1;
  const rows = await getDb().insert(accounts).values({
    name: `Konto ${nameCounter}`,
    type: "checking",
    initialBalance: 0,
    createdAt: new Date(),
  }).returning({ id: accounts.id });
  const id = rows[0].id;
  if (ownerId !== null) {
    await getDb().insert(accountOwners)
      .values({ accountId: id, userId: ownerId });
  }
  return id;
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

describe("createRecurring (Enddatum)", () => {
  it("lehnt ein Enddatum vor der nächsten Fälligkeit ab", async () => {
    const accountId = await insertAccount(null);
    await expect(callerFor(owner).finance.createRecurring({
      type: "expense",
      accountId,
      amount: 1000,
      userId: owner.id,
      interval: "monthly",
      nextDate: "2030-06-01",
      endDate: "2030-05-31",
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Das Enddatum darf nicht vor der nächsten Fälligkeit liegen.",
    });
  });

  it("akzeptiert Enddatum gleich nächster Fälligkeit und speichert es", async () => {
    const id = await insertRecurring(owner, {
      note: "Rate", nextDate: "2030-06-01", endDate: "2030-06-01",
    });
    const row = await getDb().query.recurring.findFirst({
      where: eq(recurring.id, id),
    });
    expect(row!.endDate).toBe("2030-06-01");
  });

  it("ohne Enddatum bleibt endDate NULL", async () => {
    const id = await insertRecurring(owner, { note: "Dauer" });
    const row = await getDb().query.recurring.findFirst({
      where: eq(recurring.id, id),
    });
    expect(row!.endDate).toBeNull();
  });
});

describe("updateRecurring (Enddatum)", () => {
  it("setzt, ändert und entfernt (null) das Enddatum", async () => {
    const caller = callerFor(owner);
    const id = await insertRecurring(owner, { note: "Befristet" });

    await caller.finance.updateRecurring({ id, endDate: "2031-01-01" });
    let row = await getDb().query.recurring.findFirst({ where: eq(recurring.id, id) });
    expect(row!.endDate).toBe("2031-01-01");

    await caller.finance.updateRecurring({ id, endDate: "2032-01-01" });
    row = await getDb().query.recurring.findFirst({ where: eq(recurring.id, id) });
    expect(row!.endDate).toBe("2032-01-01");

    await caller.finance.updateRecurring({ id, endDate: null });
    row = await getDb().query.recurring.findFirst({ where: eq(recurring.id, id) });
    expect(row!.endDate).toBeNull();
  });

  it("prüft das Enddatum gegen die wirksame nächste Fälligkeit", async () => {
    const caller = callerFor(owner);
    const id = await insertRecurring(owner, { note: "Gegencheck" });

    // endDate vor der bestehenden nextDate (2030-01-01)
    await expect(
      caller.finance.updateRecurring({ id, endDate: "2029-12-31" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // endDate gesetzt, dann nextDate dahinter verschieben
    await caller.finance.updateRecurring({ id, endDate: "2030-06-01" });
    await expect(
      caller.finance.updateRecurring({ id, nextDate: "2030-07-01" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Das Enddatum darf nicht vor der nächsten Fälligkeit liegen.",
    });

    // undefined lässt das Enddatum unverändert
    await caller.finance.updateRecurring({ id, note: "Gegencheck 2" });
    const row = await getDb().query.recurring.findFirst({ where: eq(recurring.id, id) });
    expect(row!.endDate).toBe("2030-06-01");
  });
});

describe("runRecurringJob (Enddatum)", () => {
  it("verbucht nur Vorkommen bis einschließlich Enddatum, ohne Dubletten", async () => {
    const accountId = await insertAccount(null);
    // Wöchentlich, Start vor 21 Tagen, Ende vor 7 Tagen → 3 fällige Vorkommen
    // (-21, -14, -7); das Vorkommen heute liegt jenseits des Enddatums.
    const endDate = daysFromToday(-7);
    const id = await insertRecurring(owner, {
      note: "Wochenrate",
      accountId,
      interval: "weekly",
      nextDate: daysFromToday(-21),
      endDate,
    });

    const created = await runRecurringJob();
    expect(created).toBe(3);

    const booked = await getDb().select().from(transactions)
      .where(eq(transactions.recurringId, id));
    expect(booked).toHaveLength(3);
    for (const t of booked) {
      expect(t.date <= endDate).toBe(true);
    }

    // nextDate steht auf dem ersten Vorkommen jenseits des Enddatums …
    const row = await getDb().query.recurring.findFirst({
      where: eq(recurring.id, id),
    });
    expect(row!.nextDate).toBe(daysFromToday(0));

    // … und wird nicht weiter vorgespult: erneuter Lauf bucht nichts
    expect(await runRecurringJob()).toBe(0);
    expect(await getDb().select().from(transactions)
      .where(eq(transactions.recurringId, id))).toHaveLength(3);
  });
});

describe("Archivierung (Einordnung und Sortierung)", () => {
  it("liefert endDate in listRecurring und sortiert aktive vor archiviert", async () => {
    const activeId = await insertRecurring(owner, { note: "Laufend" });
    // Ablauf in der Vergangenheit → archiviert (endDate >= nextDate nötig)
    const archivedId = await insertRecurring(owner, {
      note: "Abgelaufen",
      nextDate: daysFromToday(-10),
      endDate: daysFromToday(-5),
    });

    const list = await callerFor(admin).finance.listRecurring();
    const active = list.find(r => r.id === activeId)!;
    const archived = list.find(r => r.id === archivedId)!;
    expect(active.endDate).toBeNull();
    expect(archived.endDate).toBe(daysFromToday(-5));

    const today = localISO(new Date());
    expect(isRecurringArchived(archived, today)).toBe(true);
    expect(isRecurringArchived(active, today)).toBe(false);

    // Aktive (nach nextDate) zuerst, archivierte ans Ende
    const sorted = sortRecurring([archived, active], today);
    expect(sorted.map(r => r.id)).toEqual([activeId, archivedId]);
  });
});
