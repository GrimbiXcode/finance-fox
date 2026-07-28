import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { initDb, getDb } from "./queries/connection";
import { transactionChanges, users } from "@db/schema";
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
let catFoodId: number;
let catRestaurantId: number;
let projectId: number;
let tagAId: number;
let tagBId: number;

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
  await callerFor(admin).finance.createCategory({
    name: "Lebensmittel",
    type: "expense",
    color: "#f43f5e",
  });
  await callerFor(admin).finance.createCategory({
    name: "Restaurant",
    type: "expense",
    color: "#3b82f6",
  });
  const cats = await callerFor(admin).finance.listCategories();
  catFoodId = cats.find(c => c.name === "Lebensmittel")!.id;
  catRestaurantId = cats.find(c => c.name === "Restaurant")!.id;
  const project = await callerFor(admin).finance.createProject({
    name: "Urlaub",
    color: "#a855f7",
  });
  projectId = project.id;
  tagAId = (await callerFor(admin).finance.createTag({ name: "Wichtig" })).id;
  tagBId = (await callerFor(admin).finance.createTag({ name: "Steuer" })).id;
});

describe("updateTransaction: Felder und Validierung", () => {
  let txId: number;

  it("ändert Einzelfelder und Kombinationen, type bleibt unverändert", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 1234,
      categoryId: catFoodId,
      userId: admin.id,
      date: "2026-07-01",
      note: "Wocheneinkauf",
    });
    txId = id;
    // Einzelfeld
    await callerFor(admin).finance.updateTransaction({ id, amount: 1500 });
    // Kombination inkl. Kategorie-Wechsel und Projekt
    await callerFor(admin).finance.updateTransaction({
      id,
      amount: 2000,
      date: "2026-07-02",
      note: "Großeinkauf",
      categoryId: catRestaurantId,
      projectId,
    });
    const tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === id
    );
    expect(tx).toMatchObject({
      type: "expense",
      amount: 2000,
      date: "2026-07-02",
      note: "Großeinkauf",
      categoryId: catRestaurantId,
      projectId,
    });
  });

  it("ignoriert ein mitgeschicktes type-Feld (Art ist unveränderlich)", async () => {
    // zod verwirft unbekannte Felder — die Buchungsart bleibt erhalten
    await callerFor(admin).finance.updateTransaction({
      id: txId,
      note: "Unverändert Ausgabe",
      // @ts-expect-error type ist bewusst nicht Teil des Inputs
      type: "income",
    });
    const tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === txId
    );
    expect(tx?.type).toBe("expense");
    expect(tx?.note).toBe("Unverändert Ausgabe");
  });

  it("entfernt Kategorie und Projekt über null", async () => {
    await callerFor(admin).finance.updateTransaction({
      id: txId,
      categoryId: null,
      projectId: null,
    });
    const tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === txId
    );
    expect(tx?.categoryId).toBeNull();
    expect(tx?.projectId).toBeNull();
  });

  it("validiert Kategorie, Projekt und Tags (BAD_REQUEST)", async () => {
    await expect(
      callerFor(admin).finance.updateTransaction({
        id: txId,
        categoryId: 99999,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Die angegebene Kategorie existiert nicht.",
    });
    await expect(
      callerFor(admin).finance.updateTransaction({ id: txId, projectId: 99999 })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Das angegebene Projekt existiert nicht.",
    });
    await expect(
      callerFor(admin).finance.updateTransaction({ id: txId, tagIds: [99999] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Mindestens ein Tag existiert nicht.",
    });
  });

  it("meldet unbekannte Buchungen als NOT_FOUND", async () => {
    await expect(
      callerFor(admin).finance.updateTransaction({ id: 99999, amount: 100 })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Buchung nicht gefunden.",
    });
  });

  it("ersetzt die Tags der Buchung (Ersetzen-Semantik)", async () => {
    await callerFor(admin).finance.updateTransaction({
      id: txId,
      tagIds: [tagAId, tagBId],
    });
    let tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === txId
    );
    expect(tx?.tags.map(t => t.id).sort()).toEqual([tagAId, tagBId].sort());
    await callerFor(admin).finance.updateTransaction({ id: txId, tagIds: [] });
    tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === txId
    );
    expect(tx?.tags).toEqual([]);
  });
});

describe("updateTransaction: Splits und Umbuchungen", () => {
  it("ersetzt Splits mit Summen-Validierung und entfernt sie über []", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 10000,
      userId: admin.id,
      date: "2026-07-03",
      splits: [
        { userId: admin.id, amount: 5000 },
        { userId: member.id, amount: 5000 },
      ],
    });
    // Summe muss dem (ggf. neuen) Betrag entsprechen
    await expect(
      callerFor(admin).finance.updateTransaction({
        id,
        amount: 12000,
        splits: [
          { userId: admin.id, amount: 5000 },
          { userId: member.id, amount: 5000 },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Anteile müssen in Summe dem Betrag entsprechen.",
    });
    await callerFor(admin).finance.updateTransaction({
      id,
      amount: 12000,
      splits: [
        { userId: admin.id, amount: 8000 },
        { userId: member.id, amount: 4000 },
      ],
    });
    let tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === id
    );
    expect(tx?.splits).toEqual([
      { userId: admin.id, amount: 8000 },
      { userId: member.id, amount: 4000 },
    ]);
    // Leeres Array entfernt die Aufteilung
    await callerFor(admin).finance.updateTransaction({ id, splits: [] });
    tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === id
    );
    expect(tx?.splits).toEqual([]);
    // Diff der Aufteilung ist lesbar in der Historie (neue Werte ≠ Entfernen)
    const history = await callerFor(admin).finance.listTransactionChanges({
      transactionId: id,
    });
    const splitChange = history
      .flatMap(h => h.changes)
      .find(c => c.field === "splits" && c.to !== null);
    expect(splitChange?.to).toContain("Admin: 80,00");
    expect(splitChange?.to).toContain("Mitglied: 40,00");
  });

  it("lehnt Splits bei Nicht-Ausgaben ab", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "income",
      accountId,
      amount: 5000,
      userId: admin.id,
      date: "2026-07-04",
    });
    await expect(
      callerFor(admin).finance.updateTransaction({
        id,
        splits: [{ userId: admin.id, amount: 5000 }],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Eine Aufteilung ist nur bei Ausgaben möglich.",
    });
  });

  it("ändert das Zielkonto einer Umbuchung (Validierung wie beim Anlegen)", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "transfer",
      accountId,
      toAccountId: secondAccountId,
      amount: 3000,
      userId: admin.id,
      date: "2026-07-05",
    });
    // Zielkonto darf nicht dem Quellkonto entsprechen
    await expect(
      callerFor(admin).finance.updateTransaction({
        id,
        accountId: secondAccountId,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Zielkonto muss ein anderes Konto sein.",
    });
    // Zielkonto darf nicht entfernt werden
    await expect(
      callerFor(admin).finance.updateTransaction({ id, toAccountId: null })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Bei Umbuchungen muss ein Zielkonto angegeben werden.",
    });
    // Zulässige Änderung von Betrag und Zielkonto
    await callerFor(admin).finance.updateTransaction({
      id,
      amount: 3500,
      toAccountId: privateAccountId,
    });
    const tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === id
    );
    expect(tx?.amount).toBe(3500);
    expect(tx?.toAccountId).toBe(privateAccountId);
  });
});

describe("updateTransaction: Rechte", () => {
  it("erfordert edit auf dem aktuellen Konto (fremd/view-only → NOT_FOUND)", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId: privateAccountId,
      amount: 900,
      userId: admin.id,
      date: "2026-07-06",
    });
    // Ohne Freigabe: kein Zugriff
    await expect(
      callerFor(member).finance.updateTransaction({ id, amount: 1000 })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Konto nicht gefunden.",
    });
    // Mit view-Freigabe: Lesen der Historie ok, Bearbeiten nicht
    await callerFor(admin).finance.setAccountPermission({
      accountId: privateAccountId,
      userId: member.id,
      level: "view",
    });
    await callerFor(admin).finance.updateTransaction({ id, amount: 1000 });
    const history = await callerFor(member).finance.listTransactionChanges({
      transactionId: id,
    });
    expect(history).toHaveLength(1);
    await expect(
      callerFor(member).finance.updateTransaction({ id, amount: 1100 })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Konto nicht gefunden.",
    });
    await callerFor(admin).finance.setAccountPermission({
      accountId: privateAccountId,
      userId: member.id,
      level: "none",
    });
  });

  it("erfordert beim Verschieben edit auf dem Zielkonto", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 700,
      userId: admin.id,
      date: "2026-07-07",
    });
    // Mitglied darf das Gemeinschaftskonto bearbeiten, aber nicht aufs
    // private Konto des Admins verschieben
    await expect(
      callerFor(member).finance.updateTransaction({
        id,
        accountId: privateAccountId,
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Konto nicht gefunden.",
    });
    // Admin verschiebt aufs Zweitkonto — Diff zeigt Kontonamen
    await callerFor(admin).finance.updateTransaction({
      id,
      accountId: secondAccountId,
    });
    const tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === id
    );
    expect(tx?.accountId).toBe(secondAccountId);
    const history = await callerFor(admin).finance.listTransactionChanges({
      transactionId: id,
    });
    const accountChange = history[0]?.changes.find(
      c => c.field === "accountId"
    );
    expect(accountChange).toEqual({
      field: "accountId",
      from: "Gemeinschaft",
      to: "Zweitkonto",
    });
  });
});

describe("Änderungshistorie (listTransactionChanges)", () => {
  let txId: number;

  beforeAll(async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 4200,
      categoryId: catFoodId,
      userId: admin.id,
      date: "2026-07-08",
      note: "Bahnticket",
    });
    txId = id;
  });

  it("erzeugt bei unveränderten Werten keinen Eintrag", async () => {
    await callerFor(admin).finance.updateTransaction({
      id: txId,
      amount: 4200,
      note: "Bahnticket",
      comment: "Nur ein Kommentar ohne Änderung",
    });
    const history = await callerFor(admin).finance.listTransactionChanges({
      transactionId: txId,
    });
    expect(history).toEqual([]);
  });

  it("speichert Diff mit aufgelösten Namen, Kommentar und Nutzer-Join", async () => {
    await callerFor(admin).finance.updateTransaction({
      id: txId,
      amount: 4500,
      categoryId: catRestaurantId,
      userId: member.id,
      comment: "Betrag korrigiert",
    });
    const history = await callerFor(admin).finance.listTransactionChanges({
      transactionId: txId,
    });
    expect(history).toHaveLength(1);
    const entry = history[0]!;
    expect(entry.comment).toBe("Betrag korrigiert");
    expect(entry.userName).toBe("Admin");
    expect(entry.userColor).toBe(admin.color);
    expect(entry.changes).toContainEqual({
      field: "amount",
      from: 4200,
      to: 4500,
    });
    expect(entry.changes).toContainEqual({
      field: "categoryId",
      from: "Lebensmittel",
      to: "Restaurant",
    });
    expect(entry.changes).toContainEqual({
      field: "userId",
      from: "Admin",
      to: "Mitglied",
    });
  });

  it("liefert Einträge absteigend (neueste zuerst)", async () => {
    await callerFor(admin).finance.updateTransaction({
      id: txId,
      note: "Erste Notiz",
      comment: "erste",
    });
    await callerFor(admin).finance.updateTransaction({
      id: txId,
      note: "Zweite Notiz",
      comment: "zweite",
    });
    const history = await callerFor(admin).finance.listTransactionChanges({
      transactionId: txId,
    });
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history[0]?.comment).toBe("zweite");
    expect(history[1]?.comment).toBe("erste");
  });

  it("verweigert das Lesen ohne view-Recht (NOT_FOUND)", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId: privateAccountId,
      amount: 500,
      userId: admin.id,
      date: "2026-07-09",
    });
    await expect(
      callerFor(member).finance.listTransactionChanges({ transactionId: id })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Konto nicht gefunden.",
    });
  });
});

describe("Änderungshistorie: Kaskaden und changeCount", () => {
  it("liefert changeCount in listTransactions", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 600,
      userId: admin.id,
      date: "2026-07-10",
    });
    let tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === id
    );
    expect(tx?.changeCount).toBe(0);
    await callerFor(admin).finance.updateTransaction({ id, amount: 700 });
    await callerFor(admin).finance.updateTransaction({ id, amount: 800 });
    tx = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === id
    );
    expect(tx?.changeCount).toBe(2);
  });

  it("räumt die Historie beim Löschen der Buchung ab (Kaskade)", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 600,
      userId: admin.id,
      date: "2026-07-11",
    });
    await callerFor(admin).finance.updateTransaction({ id, amount: 700 });
    const before = await getDb()
      .select()
      .from(transactionChanges)
      .where(eq(transactionChanges.transactionId, id));
    expect(before).toHaveLength(1);
    await callerFor(admin).finance.deleteTransaction({ id });
    const after = await getDb()
      .select()
      .from(transactionChanges)
      .where(eq(transactionChanges.transactionId, id));
    expect(after).toEqual([]);
  });

  it("räumt die Historie beim Löschen des Kontos ab (Kaskade)", async () => {
    await callerFor(admin).finance.createAccount({
      name: "Tempkonto",
      type: "checking",
      initialBalance: 0,
      private: false,
    });
    const accs = await callerFor(admin).finance.listAccounts();
    const tempId = accs.find(a => a.name === "Tempkonto")!.id;
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId: tempId,
      amount: 600,
      userId: admin.id,
      date: "2026-07-12",
    });
    await callerFor(admin).finance.updateTransaction({ id, amount: 700 });
    await callerFor(admin).finance.deleteAccount({
      id: tempId,
      name: "Tempkonto",
    });
    const rows = await getDb()
      .select()
      .from(transactionChanges)
      .where(eq(transactionChanges.transactionId, id));
    expect(rows).toEqual([]);
  });
});
