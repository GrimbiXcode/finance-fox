import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { runRecurringJob } from "./lib/recurringJob";
import { accounts, recurring, transactions, users } from "@db/schema";
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
async function insertAccount(
  ownerId: number | null,
  initialBalance = 0,
): Promise<number> {
  nameCounter += 1;
  const rows = await getDb().insert(accounts).values({
    name: `Konto ${nameCounter}`,
    type: "checking",
    initialBalance,
    ownerId,
    createdAt: new Date(),
  }).returning({ id: accounts.id });
  return rows[0].id;
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Erster Tag des nächsten Monats (fällt in Prognose-Monat 1) */
function nextMonthFirst(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
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

describe("createRecurring (Umbuchung)", () => {
  it("legt eine Dauer-Umbuchung mit Zielkonto an, Kategorie wird ignoriert", async () => {
    const from = await insertAccount(null);
    const to = await insertAccount(null);
    await callerFor(owner).finance.createRecurring({
      type: "transfer",
      accountId: from,
      toAccountId: to,
      amount: 50000,
      categoryId: 1, // irrelevant bei Umbuchungen
      userId: owner.id,
      note: "Dauerauftrag",
      interval: "monthly",
      nextDate: nextMonthFirst(),
    });
    const row = await getDb().query.recurring.findFirst({
      where: and(eq(recurring.accountId, from), eq(recurring.toAccountId, to)),
    });
    expect(row).toMatchObject({
      type: "transfer", accountId: from, toAccountId: to, categoryId: null,
    });
  });

  it("lehnt Umbuchung ohne Zielkonto ab", async () => {
    const from = await insertAccount(null);
    await expect(callerFor(owner).finance.createRecurring({
      type: "transfer",
      accountId: from,
      amount: 1000,
      userId: owner.id,
      interval: "monthly",
      nextDate: nextMonthFirst(),
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Bei Umbuchungen muss ein Zielkonto angegeben werden.",
    });
  });

  it("lehnt Umbuchung mit Quell- gleich Zielkonto ab", async () => {
    const from = await insertAccount(null);
    await expect(callerFor(owner).finance.createRecurring({
      type: "transfer",
      accountId: from,
      toAccountId: from,
      amount: 1000,
      userId: owner.id,
      interval: "monthly",
      nextDate: nextMonthFirst(),
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Zielkonto muss ein anderes Konto sein.",
    });
  });

  it("erfordert edit auf dem Quellkonto und view auf dem Zielkonto", async () => {
    const privateFrom = await insertAccount(owner.id);
    const privateTo = await insertAccount(stranger.id);
    const shared = await insertAccount(null);
    // Fremder hat kein edit auf dem privaten Quellkonto
    await expect(callerFor(stranger).finance.createRecurring({
      type: "transfer",
      accountId: privateFrom,
      toAccountId: shared,
      amount: 1000,
      userId: stranger.id,
      interval: "monthly",
      nextDate: nextMonthFirst(),
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Besitzer sieht das fremde private Zielkonto nicht
    await expect(callerFor(owner).finance.createRecurring({
      type: "transfer",
      accountId: privateFrom,
      toAccountId: privateTo,
      amount: 1000,
      userId: owner.id,
      interval: "monthly",
      nextDate: nextMonthFirst(),
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("runRecurringJob (Umbuchung)", () => {
  it("verbucht mit Zielkonto, korrekten Salden und Idempotenz", async () => {
    const giro = await insertAccount(null, 100000);
    const spar = await insertAccount(null, 0);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await callerFor(owner).finance.createRecurring({
      type: "transfer",
      accountId: giro,
      toAccountId: spar,
      amount: 20000,
      userId: owner.id,
      note: "Sparen",
      interval: "monthly",
      nextDate: localISO(yesterday),
    });

    const created = await runRecurringJob();
    expect(created).toBe(1);

    const rec = await getDb().query.recurring.findFirst({
      where: and(eq(recurring.accountId, giro), eq(recurring.toAccountId, spar)),
    });
    expect(rec).toBeDefined();
    // Nächste Fälligkeit liegt nach der verbuchten
    expect(rec!.nextDate).toBe(localISO(
      new Date(yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate()),
    ));

    const booked = await getDb().select().from(transactions)
      .where(eq(transactions.recurringId, rec!.id));
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({
      type: "transfer", accountId: giro, toAccountId: spar, amount: 20000,
    });

    // Saldo-Effekte: Giro -X, Sparkonto +X
    const list = await callerFor(admin).finance.listAccounts();
    expect(list.find(a => a.id === giro)?.balance).toBe(80000);
    expect(list.find(a => a.id === spar)?.balance).toBe(20000);

    // Idempotenz: erneuter Lauf bucht nichts doppelt
    expect(await runRecurringJob()).toBe(0);
    expect(await getDb().select().from(transactions)
      .where(eq(transactions.recurringId, rec!.id))).toHaveLength(1);
  });
});

describe("listRecurring (Sichtbarkeit bei Umbuchungen)", () => {
  it("sichtbar, wenn Quell- ODER Zielkonto sichtbar ist", async () => {
    const priv = await insertAccount(owner.id);
    const priv2 = await insertAccount(owner.id);
    const shared = await insertAccount(null);
    const base = {
      type: "transfer" as const,
      amount: 1000,
      userId: owner.id,
      interval: "monthly" as const,
      nextDate: nextMonthFirst(),
    };
    const mk = async (accountId: number, toAccountId: number) => {
      await callerFor(owner).finance.createRecurring({
        ...base, accountId, toAccountId,
      });
      const row = await getDb().query.recurring.findFirst({
        where: and(
          eq(recurring.accountId, accountId),
          eq(recurring.toAccountId, toAccountId),
        ),
      });
      return row!.id;
    };
    const privToShared = await mk(priv, shared);
    const sharedToPriv = await mk(shared, priv);
    const privToPriv = await mk(priv, priv2);

    const strangerList = await callerFor(stranger).finance.listRecurring();
    const strangerIds = strangerList.map(r => r.id);
    expect(strangerIds).toContain(privToShared);
    expect(strangerIds).toContain(sharedToPriv);
    expect(strangerIds).not.toContain(privToPriv);

    const ownerList = await callerFor(owner).finance.listRecurring();
    const ownerIds = ownerList.map(r => r.id);
    expect(ownerIds).toEqual(expect.arrayContaining([
      privToShared, sharedToPriv, privToPriv,
    ]));

    // Aufräumen, damit die Prognose-Tests isoliert bleiben
    await getDb().delete(recurring).where(eq(recurring.id, privToShared));
    await getDb().delete(recurring).where(eq(recurring.id, sharedToPriv));
    await getDb().delete(recurring).where(eq(recurring.id, privToPriv));
  });
});

describe("forecast.balance (Dauer-Umbuchungen)", () => {
  it("Umbuchungen tauchen nicht in recurringIncome/Expense auf", async () => {
    const res = await callerFor(admin).forecast.balance({ months: 3 });
    for (const p of res.projection) {
      expect(p.recurringIncome).toBe(0);
      expect(p.recurringExpense).toBe(0);
    }
    // Für den Admin sind beide Seiten aller Dauer-Umbuchungen sichtbar:
    // saldo-neutral, die Projektion bleibt flach
    const last = res.history[res.history.length - 1].balance;
    for (const p of res.projection) {
      expect(p.balance).toBe(last);
    }
  });

  it("nur eine Seite sichtbar: Abfluss (Quelle) bzw. Zufluss (Ziel)", async () => {
    const priv = await insertAccount(owner.id);
    const shared = await insertAccount(null);
    await callerFor(owner).finance.createRecurring({
      type: "transfer",
      accountId: shared,
      toAccountId: priv,
      amount: 5000,
      userId: owner.id,
      interval: "monthly",
      nextDate: nextMonthFirst(),
    });
    await callerFor(owner).finance.createRecurring({
      type: "transfer",
      accountId: priv,
      toAccountId: shared,
      amount: 3000,
      userId: owner.id,
      interval: "monthly",
      nextDate: nextMonthFirst(),
    });

    const res = await callerFor(stranger).forecast.balance({ months: 3 });
    // Auch einseitige Umbuchungen bleiben keine Einnahmen/Ausgaben
    for (const p of res.projection) {
      expect(p.recurringIncome).toBe(0);
      expect(p.recurringExpense).toBe(0);
    }
    // Netto: -5000 (Quelle sichtbar) + 3000 (Ziel sichtbar) = -2000/Monat
    const last = res.history[res.history.length - 1].balance;
    expect(res.projection[0].balance).toBe(last - 2000);
    expect(res.projection[1].balance).toBe(last - 4000);
    expect(res.projection[2].balance).toBe(last - 6000);
  });
});
