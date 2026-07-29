import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accountOwners, accountPermissions, accounts, transactions, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const owner: SessionUser = {
  id: 1, email: "owner@example.com", name: "Besitzer", role: "member", color: "#6366f1",
};
const viewer: SessionUser = {
  id: 2, email: "viewer@example.com", name: "Betrachter", role: "member", color: "#f59e0b",
};
const stranger: SessionUser = {
  id: 3, email: "stranger@example.com", name: "Fremder", role: "member", color: "#94a3b8",
};

const ALL_USERS = [owner, viewer, stranger];

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
async function insertAccount(
  ownerId: number | null,
  initialBalance = 0,
): Promise<number> {
  nameCounter += 1;
  const rows = await getDb().insert(accounts).values({
    name: `Verlauf-Konto ${nameCounter}`,
    type: "checking",
    initialBalance,
    createdAt: new Date(),
  }).returning({ id: accounts.id });
  const id = rows[0].id;
  if (ownerId !== null) {
    await getDb().insert(accountOwners)
      .values({ accountId: id, userId: ownerId });
  }
  return id;
}

/** Buchung direkt in der DB anlegen */
async function insertTx(
  type: "income" | "expense" | "transfer",
  accountId: number,
  amount: number,
  date: string,
  toAccountId?: number,
): Promise<void> {
  await getDb().insert(transactions).values({
    type,
    accountId,
    toAccountId: toAccountId ?? null,
    amount,
    categoryId: null,
    userId: owner.id,
    date,
    note: "",
    createdAt: new Date(),
  });
}

/** Lokales Datum als ISO-String (wie im Server-Endpunkt berechnet) */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayIso(): string {
  return localIso(new Date());
}

/** Datum n Tage vor heute als ISO-String */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localIso(d);
}

/** Startdatum für den months-Rückblick (Logik wie im Endpunkt) */
function startIso(months: number): string {
  const now = new Date();
  return localIso(
    new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
  );
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

describe("accountBalanceHistory", () => {
  it("rechnet Einnahmen, Ausgaben und beide Transfer-Richtungen korrekt kumulativ", async () => {
    const a = await insertAccount(null, 1000);
    const b = await insertAccount(null, 0);
    // Vor dem Zeitraum: landet nur im Start-Saldo
    await insertTx("income", a, 5000, daysAgo(400));
    // Im Zeitraum (12 Monate): je ein Punkt pro Tag mit Änderung
    await insertTx("income", a, 2000, daysAgo(30));
    await insertTx("expense", a, 1500, daysAgo(20));
    await insertTx("transfer", a, 700, daysAgo(10), b); // Quelle: −700
    await insertTx("transfer", b, 400, daysAgo(5), a); // Ziel: +400

    const points = await callerFor(owner).finance.accountBalanceHistory({
      accountId: a,
      months: 12,
    });
    expect(points).toEqual([
      { date: startIso(12), balance: 6000 },
      { date: daysAgo(30), balance: 8000 },
      { date: daysAgo(20), balance: 6500 },
      { date: daysAgo(10), balance: 5800 },
      { date: daysAgo(5), balance: 6200 },
      { date: todayIso(), balance: 6200 },
    ]);
  });

  it("berücksichtigt alte Buchungen nur im Start-Saldo, nicht als Punkte", async () => {
    const id = await insertAccount(null, 0);
    await insertTx("income", id, 9000, daysAgo(200));
    await insertTx("expense", id, 1000, daysAgo(40));

    const points = await callerFor(owner).finance.accountBalanceHistory({
      accountId: id,
      months: 3,
    });
    // Start-Saldo = 9000, die Buchung vor 200 Tagen ist kein eigener Punkt
    expect(points[0]).toEqual({ date: startIso(3), balance: 9000 });
    expect(points.every(p => p.date >= startIso(3))).toBe(true);
    expect(points).toHaveLength(3); // Start + 1 Änderungstag + heute
    expect(points[points.length - 1]).toEqual({
      date: todayIso(),
      balance: 8000,
    });
  });

  it("liefert mit months=0 die komplette Historie ab der ersten Buchung", async () => {
    const id = await insertAccount(null, 500);
    await insertTx("income", id, 1000, daysAgo(700));
    await insertTx("expense", id, 300, daysAgo(10));

    const points = await callerFor(owner).finance.accountBalanceHistory({
      accountId: id,
      months: 0,
    });
    expect(points).toEqual([
      { date: daysAgo(700), balance: 1500 },
      { date: daysAgo(10), balance: 1200 },
      { date: todayIso(), balance: 1200 },
    ]);
  });

  it("enthält bei einem Konto ohne Buchungen Start- und Endpunkt als Flachlinie", async () => {
    const id = await insertAccount(null, 2500);
    const points = await callerFor(owner).finance.accountBalanceHistory({
      accountId: id,
      months: 12,
    });
    expect(points).toEqual([
      { date: startIso(12), balance: 2500 },
      { date: todayIso(), balance: 2500 },
    ]);
  });

  it("nutzt 12 Monate als Default-Zeitraum", async () => {
    const id = await insertAccount(null, 100);
    const points = await callerFor(owner).finance.accountBalanceHistory({
      accountId: id,
    });
    expect(points[0]).toEqual({ date: startIso(12), balance: 100 });
    expect(points[points.length - 1].date).toBe(todayIso());
  });

  it("erfordert view auf dem Konto; Mitglieder ohne Freigabe werden abgelehnt", async () => {
    const id = await insertAccount(owner.id, 100);
    await getDb().insert(accountPermissions).values({
      accountId: id, userId: viewer.id, canEdit: false,
    });
    // Besitzer und Nutzer mit Lese-Freigabe dürfen
    await callerFor(owner).finance.accountBalanceHistory({ accountId: id });
    const points = await callerFor(viewer).finance.accountBalanceHistory({
      accountId: id,
    });
    expect(points.length).toBeGreaterThanOrEqual(2);
    // Fremdes Mitglied ohne Freigabe: NOT_FOUND (Existenz leakt nicht)
    await expect(
      callerFor(stranger).finance.accountBalanceHistory({ accountId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
