import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accountOwners, accounts, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Anna",
  role: "admin",
  color: "#10b981",
};
const member: SessionUser = {
  id: 2,
  email: "member@example.com",
  name: "Ben",
  role: "member",
  color: "#6366f1",
};

const callerFor = (user: SessionUser) => {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
};
const asAdmin = () => callerFor(admin);
const asMember = () => callerFor(member);

let shared = 0;
let savings = 0;
let privateAnna = 0;
let food = 0;
let salary = 0;
let tagA = 0;
let tagB = 0;
let project = 0;
const ids: number[] = [];
let transferId = 0;
let incomeId = 0;
let privateTx = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [admin, member]) {
    await db
      .insert(users)
      .values({ ...u, active: true, createdAt: new Date() });
  }
  const insert = async (name: string) =>
    (
      await db
        .insert(accounts)
        .values({
          name,
          type: "checking",
          initialBalance: 0,
          createdAt: new Date(),
        })
        .returning({ id: accounts.id })
    )[0].id;
  shared = await insert("Haushalt");
  savings = await insert("Sparen");
  privateAnna = await insert("Privat Anna");
  await db
    .insert(accountOwners)
    .values({ accountId: privateAnna, userId: admin.id });

  await asAdmin().finance.addDefaultCategories({
    keys: ["lebensmittel", "lohn"],
  });
  const cats = await asAdmin().finance.listCategories();
  food = cats.find(c => c.name === "Lebensmittel")!.id;
  salary = cats.find(c => c.name === "Lohn")!.id;
  tagA = (await asAdmin().finance.createTag({ name: "Import" })).id;
  tagB = (await asAdmin().finance.createTag({ name: "Prüfen" })).id;
  await asAdmin().finance.createProject({ name: "Umbau", color: "#123456" });
  project = (await asAdmin().finance.listProjects())[0].id;

  const tx = asAdmin().finance.createTransaction;
  for (let i = 0; i < 3; i++) {
    const r = await tx({
      type: "expense",
      accountId: shared,
      amount: 1000 + i,
      userId: admin.id,
      date: "2026-03-0" + (i + 1),
      note: `Laden ${i}`,
      tagIds: i === 0 ? [tagB] : [],
    });
    ids.push(r.id);
  }
  transferId = (
    await tx({
      type: "transfer",
      accountId: shared,
      toAccountId: savings,
      amount: 500,
      userId: admin.id,
      date: "2026-03-05",
    })
  ).id;
  incomeId = (
    await tx({
      type: "income",
      accountId: shared,
      amount: 9000,
      userId: admin.id,
      date: "2026-03-06",
      categoryId: salary,
    })
  ).id;
  privateTx = (
    await tx({
      type: "expense",
      accountId: privateAnna,
      amount: 700,
      userId: admin.id,
      date: "2026-03-07",
    })
  ).id;
});

describe("bulkUpdateTransactions", () => {
  it("setzt Kategorie, Projekt und Tags in einem Rutsch und schreibt Verlauf", async () => {
    const res = await asMember().finance.bulkUpdateTransactions({
      ids,
      categoryId: food,
      projectId: project,
      addTagIds: [tagA],
      removeTagIds: [tagB],
    });
    expect(res).toEqual({ updated: 3, skipped: 0, unchanged: 0 });
    const list = await asMember().finance.searchTransactions({
      from: "2026-03-01",
      to: "2026-03-03",
      limit: 50,
    });
    for (const t of list.items) {
      expect(t.categoryId).toBe(food);
      expect(t.projectId).toBe(project);
      expect(t.tags.map(x => x.id)).toEqual([tagA]);
      expect(t.changeCount).toBe(1);
    }
    const history = await asMember().finance.listTransactionChanges({
      transactionId: ids[0],
    });
    expect(history[0].comment).toBe("Massenbearbeitung");
    expect(history[0].changes.map(c => c.field).sort()).toEqual([
      "categoryId",
      "projectId",
      "tags",
    ]);
    const audit = await asAdmin().finance.listAuditLog({
      entity: "transaction",
    });
    expect(audit.filter(a => a.action === "transaction.updated")).toHaveLength(
      3
    );
  });

  it("überspringt Buchungen, zu denen die Kategorie nicht passt", async () => {
    const res = await asAdmin().finance.bulkUpdateTransactions({
      ids: [ids[0], transferId, incomeId],
      categoryId: food,
    });
    // ids[0] hat die Kategorie schon → unverändert; Umbuchung und Einnahme passen nicht
    expect(res).toEqual({ updated: 0, skipped: 2, unchanged: 1 });
    const removed = await asAdmin().finance.bulkUpdateTransactions({
      ids: [ids[1]],
      categoryId: null,
    });
    expect(removed.updated).toBe(1);
  });

  it("meldet unsichtbare Buchungen wie fehlende (kein Existenz-Orakel)", async () => {
    const hidden = await asMember()
      .finance.bulkUpdateTransactions({ ids: [privateTx], userId: member.id })
      .catch(e => e);
    const missing = await asMember()
      .finance.bulkUpdateTransactions({ ids: [999_999], userId: member.id })
      .catch(e => e);
    expect(hidden.message).toBe(missing.message);
    expect(hidden.code).toBe("NOT_FOUND");
  });

  it("zählt „Kategorie entfernen“ bei Umbuchungen als unverändert", async () => {
    const res = await asAdmin().finance.bulkUpdateTransactions({
      ids: [transferId],
      categoryId: null,
    });
    expect(res).toEqual({ updated: 0, skipped: 0, unchanged: 1 });
  });

  it("verlangt edit auf jedem Konto — und ändert dann gar nichts", async () => {
    await expect(
      asMember().finance.bulkUpdateTransactions({
        ids: [ids[2], privateTx],
        userId: member.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Das Privatkonto von Anna ist für Ben unsichtbar (NOT_FOUND statt
    // FORBIDDEN) — und die mit ausgewählte geteilte Buchung blieb unverändert
    const t = (
      await asMember().finance.searchTransactions({
        from: "2026-03-03",
        to: "2026-03-03",
      })
    ).items[0];
    expect(t.userId).toBe(admin.id);
  });

  it("lehnt unbekannte Ziele und leere Änderungen ab", async () => {
    await expect(
      asAdmin().finance.bulkUpdateTransactions({ ids, categoryId: 9999 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asAdmin().finance.bulkUpdateTransactions({ ids, addTagIds: [9999] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asAdmin().finance.bulkUpdateTransactions({ ids, userId: 9999 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asAdmin().finance.bulkUpdateTransactions({ ids })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asAdmin().finance.bulkUpdateTransactions({
        ids: [999999],
        userId: member.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("bulkDeleteTransactions", () => {
  it("löscht nichts, wenn eine Buchung nicht bearbeitbar ist", async () => {
    await expect(
      asMember().finance.bulkDeleteTransactions({ ids: [ids[0], privateTx] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const list = await asMember().finance.searchTransactions({
      from: "2026-03-01",
      to: "2026-03-01",
    });
    expect(list.total).toBe(1);
  });

  it("löscht die Auswahl samt Tags und schreibt je Buchung ins Log", async () => {
    const res = await asMember().finance.bulkDeleteTransactions({
      ids: [ids[0], ids[1]],
    });
    expect(res.deleted).toBe(2);
    const list = await asMember().finance.searchTransactions({
      from: "2026-03-01",
      to: "2026-03-02",
    });
    expect(list.total).toBe(0);
    const audit = await asAdmin().finance.listAuditLog({
      entity: "transaction",
    });
    expect(audit.filter(a => a.action === "transaction.deleted")).toHaveLength(
      2
    );
  });
});

describe("createRecurring mit Ursprungsbuchung", () => {
  it("nennt die Ursprungsbuchung im Log", async () => {
    await asAdmin().finance.createRecurring({
      type: "income",
      accountId: shared,
      amount: 9000,
      categoryId: salary,
      userId: admin.id,
      note: "Lohn",
      interval: "monthly",
      nextDate: "2026-04-06",
      sourceTransactionId: incomeId,
    });
    const audit = await asAdmin().finance.listAuditLog({ entity: "recurring" });
    expect(audit[0].detail).toContain("aus Buchung vom 2026-03-06");
  });

  it("verrät keine Buchung, die man nicht sehen darf", async () => {
    // Unsichtbar wie fehlend: kein Fehler, kein Rückverweis im Log
    await asMember().finance.createRecurring({
      type: "expense",
      accountId: shared,
      amount: 700,
      userId: member.id,
      interval: "monthly",
      nextDate: "2026-04-07",
      note: "Ohne Quelle",
      sourceTransactionId: privateTx,
    });
    const audit = await asAdmin().finance.listAuditLog({ entity: "recurring" });
    const entry = audit.find(a => a.detail.includes("Ohne Quelle"))!;
    expect(entry.detail).not.toContain("aus Buchung");
  });
});
