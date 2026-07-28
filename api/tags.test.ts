import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { initDb, getDb } from "./queries/connection";
import { transactionTags, users } from "@db/schema";
import { TAG_COLORS } from "@contracts/types";
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
    name: "Privat",
    type: "checking",
    initialBalance: 0,
    private: true,
  });
  const accs = await callerFor(admin).finance.listAccounts();
  accountId = accs.find(a => a.name === "Gemeinschaft")!.id;
  privateAccountId = accs.find(a => a.name === "Privat")!.id;
});

describe("Tags: CRUD", () => {
  let urlaubId: number;

  it("legt Tags an (Farbe aus der Palette) und listet sie alphabetisch", async () => {
    const urlaub = await callerFor(admin).finance.createTag({
      name: "Urlaub",
    });
    urlaubId = urlaub.id;
    expect(TAG_COLORS).toContain(urlaub.color);
    await callerFor(member).finance.createTag({ name: "Arbeit" });
    const list = await callerFor(member).finance.listTags();
    expect(list.map(t => t.name)).toEqual(["Arbeit", "Urlaub"]);
  });

  it("trimmt den Namen und lehnt Duplikate case-insensitiv ab (CONFLICT)", async () => {
    await expect(
      callerFor(admin).finance.createTag({ name: "  urlaub  " })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Ein Tag mit diesem Namen existiert bereits.",
    });
  });

  it("löscht Tags und meldet unbekannte IDs als NOT_FOUND", async () => {
    const tmp = await callerFor(admin).finance.createTag({ name: "Temp" });
    await callerFor(admin).finance.deleteTag({ id: tmp.id });
    const list = await callerFor(admin).finance.listTags();
    expect(list.find(t => t.id === tmp.id)).toBeUndefined();
    await expect(
      callerFor(admin).finance.deleteTag({ id: tmp.id })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Tag nicht gefunden.",
    });
    expect(urlaubId).toBeGreaterThan(0);
  });
});

describe("Tags: Zuordnung zu Buchungen", () => {
  let tagA: number;
  let tagB: number;
  let txId: number;

  beforeAll(async () => {
    tagA = (await callerFor(admin).finance.createTag({ name: "Wichtig" })).id;
    tagB = (await callerFor(admin).finance.createTag({ name: "Steuer" })).id;
  });

  it("speichert tagIds direkt bei createTransaction und liefert sie in listTransactions", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 4200,
      userId: admin.id,
      date: "2026-07-01",
      note: "Bahnticket",
      tagIds: [tagA, tagB],
    });
    txId = id;
    const tx = (await callerFor(member).finance.listTransactions()).find(
      t => t.id === id
    );
    expect(tx?.tags.map(t => t.id).sort()).toEqual([tagA, tagB].sort());
    expect(tx?.tags[0]).toMatchObject({
      name: expect.any(String),
      color: expect.any(String),
    });
    // Buchungen ohne Tags liefern ein leeres Array
    const { id: plainId } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 1000,
      userId: admin.id,
      date: "2026-07-02",
    });
    const plain = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === plainId
    );
    expect(plain?.tags).toEqual([]);
  });

  it("setzt, ersetzt und leert die Tags einer Buchung (Ersetzen-Semantik)", async () => {
    // Ersetzen: nur noch tagB
    await callerFor(admin).finance.setTransactionTags({
      transactionId: txId,
      tagIds: [tagB],
    });
    let tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === txId
    );
    expect(tx?.tags.map(t => t.id)).toEqual([tagB]);
    // Duplikate in tagIds werden dedupliziert
    await callerFor(admin).finance.setTransactionTags({
      transactionId: txId,
      tagIds: [tagA, tagA, tagB],
    });
    tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === txId
    );
    expect(tx?.tags.map(t => t.id).sort()).toEqual([tagA, tagB].sort());
    // Leeren
    await callerFor(admin).finance.setTransactionTags({
      transactionId: txId,
      tagIds: [],
    });
    tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === txId
    );
    expect(tx?.tags).toEqual([]);
  });

  it("validiert unbekannte tagIds (BAD_REQUEST)", async () => {
    await expect(
      callerFor(admin).finance.setTransactionTags({
        transactionId: txId,
        tagIds: [tagA, 99999],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Mindestens ein Tag existiert nicht.",
    });
    await expect(
      callerFor(admin).finance.createTransaction({
        type: "expense",
        accountId,
        amount: 500,
        userId: admin.id,
        date: "2026-07-03",
        tagIds: [99999],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Mindestens ein Tag existiert nicht.",
    });
  });

  it("meldet unbekannte Buchungen als NOT_FOUND", async () => {
    await expect(
      callerFor(admin).finance.setTransactionTags({
        transactionId: 99999,
        tagIds: [tagA],
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Buchung nicht gefunden.",
    });
  });

  it("erfordert edit-Recht auf dem Buchungskonto (NOT_FOUND)", async () => {
    // Buchung auf dem privaten Konto des Admins — das Mitglied hat keinen Zugriff
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId: privateAccountId,
      amount: 900,
      userId: admin.id,
      date: "2026-07-04",
    });
    await expect(
      callerFor(member).finance.setTransactionTags({
        transactionId: id,
        tagIds: [tagA],
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Konto nicht gefunden.",
    });
  });

  it("löst beim Löschen eines Tags die Zuordnungen mit auf", async () => {
    await callerFor(admin).finance.setTransactionTags({
      transactionId: txId,
      tagIds: [tagA],
    });
    await callerFor(admin).finance.deleteTag({ id: tagA });
    const tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === txId
    );
    expect(tx?.tags).toEqual([]);
    const rows = await getDb()
      .select()
      .from(transactionTags)
      .where(eq(transactionTags.tagId, tagA));
    expect(rows).toEqual([]);
  });

  it("räumt Zuordnungen beim Löschen der Buchung ab (Kaskade)", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 700,
      userId: admin.id,
      date: "2026-07-05",
      tagIds: [tagB],
    });
    await callerFor(admin).finance.deleteTransaction({ id });
    const rows = await getDb()
      .select()
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, id));
    expect(rows).toEqual([]);
  });
});
