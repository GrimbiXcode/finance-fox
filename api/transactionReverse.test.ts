import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { initDb, getDb } from "./queries/connection";
import { users } from "@db/schema";
import { memberBalances } from "@/lib/finance";
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

let accountId: number;
let secondAccountId: number;
let privateAccountId: number;

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
      active: true,
      createdAt: new Date(),
    });
  }
  await callerFor(admin).finance.createAccount({
    name: "Gemeinschaft",
    type: "checking",
    initialBalance: 0,
    private: false,
  });
  await callerFor(admin).finance.createAccount({
    name: "Zweitkonto",
    type: "checking",
    initialBalance: 0,
    private: false,
  });
  await callerFor(admin).finance.createAccount({
    name: "Privat",
    type: "checking",
    initialBalance: 0,
    private: true,
  });
  const accs = await callerFor(admin).finance.listAccounts();
  accountId = accs.find(a => a.name === "Gemeinschaft")!.id;
  secondAccountId = accs.find(a => a.name === "Zweitkonto")!.id;
  privateAccountId = accs.find(a => a.name === "Privat")!.id;
});

describe("reverseTransaction: Gegenbuchung je Buchungsart", () => {
  it("Ausgabe → Einnahme mit übernommenen Splits, stornoOfId gesetzt", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 10000,
      userId: admin.id,
      date: "2026-07-01",
      note: "Wocheneinkauf",
      splits: [
        { userId: admin.id, amount: 6000 },
        { userId: member.id, amount: 4000 },
      ],
    });
    const { id: reversalId } = await callerFor(
      admin
    ).finance.reverseTransaction({ id });
    const txs = await callerFor(admin).finance.listTransactions();
    const reversal = txs.find(t => t.id === reversalId)!;
    expect(reversal).toMatchObject({
      type: "income",
      accountId,
      amount: 10000,
      userId: admin.id,
      note: "Storno: Wocheneinkauf",
      stornoOfId: id,
      // Storno ist eine neue Buchung — Datum ist heute
      date: new Date().toISOString().slice(0, 10),
    });
    expect(reversal.splits).toEqual(
      expect.arrayContaining([
        { userId: admin.id, amount: 6000 },
        { userId: member.id, amount: 4000 },
      ])
    );
    // stornoOfId wird in listTransactions mitgeliefert
    expect(txs.find(t => t.id === id)?.stornoOfId).toBeNull();
  });

  it("eigene Notiz ersetzt den Storno-Standardtext", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 500,
      userId: admin.id,
      date: "2026-07-02",
      note: "Kaffee",
    });
    const { id: reversalId } = await callerFor(
      admin
    ).finance.reverseTransaction({ id, note: "Falsch gebucht" });
    const reversal = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === reversalId
    );
    expect(reversal?.note).toBe("Falsch gebucht");
  });

  it("Einnahme → Ausgabe", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "income",
      accountId,
      amount: 250000,
      userId: admin.id,
      date: "2026-07-01",
      note: "Gehalt",
    });
    const { id: reversalId } = await callerFor(
      admin
    ).finance.reverseTransaction({ id });
    const reversal = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === reversalId
    );
    expect(reversal).toMatchObject({
      type: "expense",
      accountId,
      amount: 250000,
      stornoOfId: id,
    });
  });

  it("Umbuchung → Konten getauscht", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "transfer",
      accountId,
      toAccountId: secondAccountId,
      amount: 5000,
      userId: admin.id,
      date: "2026-07-01",
      note: "Umbuchung",
    });
    const { id: reversalId } = await callerFor(
      admin
    ).finance.reverseTransaction({ id });
    const reversal = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === reversalId
    );
    expect(reversal).toMatchObject({
      type: "transfer",
      accountId: secondAccountId,
      toAccountId: accountId,
      amount: 5000,
      stornoOfId: id,
    });
  });
});

describe("reverseTransaction: Aufteilungs-Salden heben sich auf", () => {
  it("memberBalances netto 0 nach dem Storno einer geteilten Ausgabe", async () => {
    const caller = callerFor(admin);
    const { id } = await caller.finance.createTransaction({
      type: "expense",
      accountId,
      amount: 9000,
      userId: admin.id,
      date: "2026-07-03",
      note: "Möbel",
      splits: [
        { userId: admin.id, amount: 3000 },
        { userId: member.id, amount: 6000 },
      ],
    });
    const userIds = [admin.id, member.id];
    const before = memberBalances(
      await caller.finance.listTransactions(),
      userIds
    );
    expect(before.get(admin.id)).not.toBe(0);
    expect(before.get(member.id)).not.toBe(0);
    await caller.finance.reverseTransaction({ id });
    const after = memberBalances(
      await caller.finance.listTransactions(),
      userIds
    );
    // Die Storno-Einnahme mit denselben Splits hebt die Split-Wirkung exakt auf
    expect(after.get(admin.id)).toBe(0);
    expect(after.get(member.id)).toBe(0);
  });
});

describe("reverseTransaction: Guards", () => {
  it("doppeltes Storno wird abgelehnt (CONFLICT)", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 100,
      userId: admin.id,
      date: "2026-07-04",
    });
    await callerFor(admin).finance.reverseTransaction({ id });
    await expect(
      callerFor(admin).finance.reverseTransaction({ id })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Diese Buchung wurde bereits storniert.",
    });
  });

  it("Storno-Buchung kann nicht erneut storniert werden (CONFLICT)", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 100,
      userId: admin.id,
      date: "2026-07-04",
    });
    const { id: reversalId } = await callerFor(
      admin
    ).finance.reverseTransaction({ id });
    await expect(
      callerFor(admin).finance.reverseTransaction({ id: reversalId })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Eine Storno-Buchung kann nicht erneut storniert werden.",
    });
  });

  it("Mitglied ohne edit-Recht auf dem Konto wird abgelehnt", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId: privateAccountId,
      amount: 100,
      userId: admin.id,
      date: "2026-07-04",
    });
    await expect(
      callerFor(member).finance.reverseTransaction({ id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unbekannte Buchung → NOT_FOUND", async () => {
    await expect(
      callerFor(admin).finance.reverseTransaction({ id: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("reverseTransaction: Audit-Log", () => {
  it("protokolliert transaction.reversed", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 1234,
      userId: admin.id,
      date: "2026-07-05",
      note: "Audit-Test",
    });
    await callerFor(admin).finance.reverseTransaction({ id });
    const entries = await callerFor(admin).finance.listAuditLog();
    const entry = entries.find(e => e.action === "transaction.reversed");
    expect(entry).toBeDefined();
    expect(entry?.entityId).toBe(id);
    expect(entry?.userName).toBe("Admin");
    expect(entry?.detail).toContain("Audit-Test");
  });
});
