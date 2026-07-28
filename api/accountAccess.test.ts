import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accessLevelFor } from "./lib/accountAccess";
import {
  accountPermissions, accounts, recurring, transactions, users,
} from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1, email: "admin@example.com", name: "Admin", role: "admin", color: "#10b981",
};
const owner: SessionUser = {
  id: 2, email: "owner@example.com", name: "Besitzer", role: "member", color: "#6366f1",
};
const viewer: SessionUser = {
  id: 3, email: "viewer@example.com", name: "Betrachter", role: "member", color: "#f59e0b",
};
const editor: SessionUser = {
  id: 4, email: "editor@example.com", name: "Bearbeiter", role: "member", color: "#ef4444",
};
const stranger: SessionUser = {
  id: 5, email: "stranger@example.com", name: "Fremder", role: "member", color: "#94a3b8",
};

const ALL_USERS = [admin, owner, viewer, editor, stranger];

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

async function accountName(id: number): Promise<string> {
  const row = await getDb().query.accounts.findFirst({ where: eq(accounts.id, id) });
  return row!.name;
}

async function setPermission(accountId: number, userId: number, canEdit: boolean) {
  await getDb().insert(accountPermissions).values({ accountId, userId, canEdit });
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

describe("accessLevelFor (reine Regel)", () => {
  it("Gemeinschaftskonto: jeder hat edit", () => {
    expect(accessLevelFor({ ownerId: null }, stranger)).toBe("edit");
  });

  it("privates Konto: Besitzer edit, Admin view, Freigabe view/edit, sonst none", () => {
    const acc = { ownerId: owner.id };
    expect(accessLevelFor(acc, owner)).toBe("edit");
    expect(accessLevelFor(acc, admin)).toBe("view");
    expect(accessLevelFor(acc, viewer, { canEdit: false })).toBe("view");
    expect(accessLevelFor(acc, editor, { canEdit: true })).toBe("edit");
    expect(accessLevelFor(acc, stranger)).toBe("none");
  });
});

describe("listAccounts (Sichtbarkeit)", () => {
  it("Gemeinschaftskonto ist für alle sichtbar und editierbar", async () => {
    const id = await insertAccount(null);
    const list = await callerFor(stranger).finance.listAccounts();
    const acc = list.find((a) => a.id === id);
    expect(acc).toMatchObject({
      access: "edit", isOwner: false, ownerId: null,
    });
  });

  it("privates Konto: Besitzer/Admin/Mitglieder je nach Freigabe", async () => {
    const id = await insertAccount(owner.id);
    await setPermission(id, viewer.id, false);
    await setPermission(id, editor.id, true);

    const byId = (list: { id: number }[]) => list.find((a) => a.id === id);

    const ownerAcc = byId(await callerFor(owner).finance.listAccounts());
    expect(ownerAcc).toMatchObject({ access: "edit", isOwner: true });

    const adminAcc = byId(await callerFor(admin).finance.listAccounts());
    expect(adminAcc).toMatchObject({ access: "view", isOwner: false });

    const viewerAcc = byId(await callerFor(viewer).finance.listAccounts());
    expect(viewerAcc).toMatchObject({ access: "view", isOwner: false });

    const editorAcc = byId(await callerFor(editor).finance.listAccounts());
    expect(editorAcc).toMatchObject({ access: "edit", isOwner: false });

    const strangerList = await callerFor(stranger).finance.listAccounts();
    expect(byId(strangerList)).toBeUndefined();
  });

  it("createAccount mit private: true setzt den Besitzer", async () => {
    await callerFor(owner).finance.createAccount({
      name: "Privates Anlagekonto",
      type: "checking",
      initialBalance: 1000,
      private: true,
    });
    const list = await callerFor(owner).finance.listAccounts();
    const acc = list.find((a) => a.name === "Privates Anlagekonto");
    expect(acc).toMatchObject({ ownerId: owner.id, isOwner: true });
    // Für andere Mitglieder ohne Freigabe nicht sichtbar
    const strangerList = await callerFor(stranger).finance.listAccounts();
    expect(strangerList.find((a) => a.name === "Privates Anlagekonto"))
      .toBeUndefined();
  });
});

describe("updateAccount (Rechte)", () => {
  it("Besitzer und Edit-Berechtigte dürfen, Viewer/Admin/Fremde nicht", async () => {
    const id = await insertAccount(owner.id);
    await setPermission(id, viewer.id, false);
    await setPermission(id, editor.id, true);
    const name = await accountName(id);
    const input = { id, name, type: "savings" as const, initialBalance: 500 };

    await callerFor(owner).finance.updateAccount(input);
    await callerFor(editor).finance.updateAccount(input);

    await expect(callerFor(viewer).finance.updateAccount(input))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerFor(admin).finance.updateAccount(input))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerFor(stranger).finance.updateAccount(input))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    const acc = (await callerFor(owner).finance.listAccounts())
      .find((a) => a.id === id);
    expect(acc).toMatchObject({ type: "savings", initialBalance: 500 });
  });
});

describe("deleteAccount (Namensbestätigung + Rechte)", () => {
  it("lehnt falschen Kontonamen ab", async () => {
    const id = await insertAccount(owner.id);
    await expect(
      callerFor(owner).finance.deleteAccount({ id, name: "Falscher Name" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Der eingegebene Kontoname stimmt nicht überein.",
    });
  });

  it("privates Konto: nur Besitzer oder Admin dürfen löschen", async () => {
    const id = await insertAccount(owner.id);
    await setPermission(id, editor.id, true);
    const name = await accountName(id);

    // Fremder: Konto nicht sichtbar
    await expect(callerFor(stranger).finance.deleteAccount({ id, name }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    // Edit-Freigabe berechtigt nicht zum Löschen
    await expect(callerFor(editor).finance.deleteAccount({ id, name }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    // Besitzer mit korrektem Namen: OK, Freigaben werden mitgelöscht
    await callerFor(owner).finance.deleteAccount({ id, name });
    const rest = await getDb().select().from(accountPermissions)
      .where(eq(accountPermissions.accountId, id));
    expect(rest).toHaveLength(0);
    expect(await getDb().query.accounts
      .findFirst({ where: eq(accounts.id, id) })).toBeUndefined();
  });

  it("Admin darf fremde private Konten löschen", async () => {
    const id = await insertAccount(owner.id);
    const name = await accountName(id);
    await callerFor(admin).finance.deleteAccount({ id, name });
    expect(await getDb().query.accounts
      .findFirst({ where: eq(accounts.id, id) })).toBeUndefined();
  });

  it("Gemeinschaftskonto darf jedes Mitglied löschen", async () => {
    const id = await insertAccount(null);
    const name = await accountName(id);
    await callerFor(stranger).finance.deleteAccount({ id, name });
    expect(await getDb().query.accounts
      .findFirst({ where: eq(accounts.id, id) })).toBeUndefined();
  });
});

describe("listTransactions (Filterung)", () => {
  it("Buchungen unsichtbarer Konten sind verborgen, Transfers bleiben sichtbar", async () => {
    const privateId = await insertAccount(owner.id);
    const sharedId = await insertAccount(null);

    // Ausgabe auf privatem Konto — für Fremde unsichtbar
    await callerFor(owner).finance.createTransaction({
      type: "expense",
      accountId: privateId,
      amount: 1200,
      userId: owner.id,
      date: "2026-07-01",
      note: "privat",
    });
    // Transfer privat → gemeinsam — bleibt für Fremde sichtbar
    await callerFor(owner).finance.createTransaction({
      type: "transfer",
      accountId: privateId,
      toAccountId: sharedId,
      amount: 5000,
      userId: owner.id,
      date: "2026-07-02",
      note: "transfer",
    });

    const strangerTxs = await callerFor(stranger).finance.listTransactions();
    expect(strangerTxs.find((t) => t.note === "privat")).toBeUndefined();
    expect(strangerTxs.find((t) => t.note === "transfer")).toBeDefined();

    const ownerTxs = await callerFor(owner).finance.listTransactions();
    expect(ownerTxs.find((t) => t.note === "privat")).toBeDefined();
  });
});

describe("createTransaction / deleteTransaction (Rechte)", () => {
  it("liefert die ID der neuen Buchung zurück", async () => {
    const id = await insertAccount(owner.id);
    const result = await callerFor(owner).finance.createTransaction({
      type: "expense",
      accountId: id,
      amount: 123,
      userId: owner.id,
      date: "2026-07-03",
      note: "rueckgabe-id",
    });
    expect(result.id).toBeGreaterThan(0);
    const txRow = await getDb().query.transactions.findFirst({
      where: eq(transactions.note, "rueckgabe-id"),
    });
    expect(txRow?.id).toBe(result.id);
  });

  it("erfordert edit auf dem Konto; Viewer und Fremde werden abgelehnt", async () => {
    const id = await insertAccount(owner.id);
    await setPermission(id, viewer.id, false);
    await setPermission(id, editor.id, true);
    const base = {
      type: "expense" as const,
      accountId: id,
      amount: 100,
      userId: owner.id,
      date: "2026-07-03",
      note: "",
    };
    await callerFor(owner).finance.createTransaction(base);
    await callerFor(editor).finance.createTransaction(base);
    await expect(callerFor(viewer).finance.createTransaction(base))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerFor(stranger).finance.createTransaction(base))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Transfer erfordert mindestens view auf dem Zielkonto", async () => {
    const sharedId = await insertAccount(null);
    const foreignId = await insertAccount(stranger.id); // privat, fremd
    await expect(
      callerFor(owner).finance.createTransaction({
        type: "transfer",
        accountId: sharedId,
        toAccountId: foreignId,
        amount: 100,
        userId: owner.id,
        date: "2026-07-04",
        note: "",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deleteTransaction erfordert edit auf dem Buchungskonto", async () => {
    const id = await insertAccount(owner.id);
    await setPermission(id, viewer.id, false);
    await callerFor(owner).finance.createTransaction({
      type: "expense",
      accountId: id,
      amount: 100,
      userId: owner.id,
      date: "2026-07-05",
      note: "zum-loeschen",
    });
    const txRow = (await getDb().select().from(transactions)
      .where(eq(transactions.note, "zum-loeschen")))[0];
    await expect(callerFor(viewer).finance.deleteTransaction({ id: txRow.id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await callerFor(owner).finance.deleteTransaction({ id: txRow.id });
    expect(await getDb().query.transactions
      .findFirst({ where: eq(transactions.id, txRow.id) })).toBeUndefined();
  });
});

describe("Wiederkehrende Buchungen (Rechte)", () => {
  it("listRecurring filtert unsichtbare Konten, Mutationen erfordern edit", async () => {
    const id = await insertAccount(owner.id);
    await setPermission(id, editor.id, true);

    await expect(callerFor(stranger).finance.createRecurring({
      type: "expense",
      accountId: id,
      amount: 999,
      userId: stranger.id,
      interval: "monthly",
      nextDate: "2026-08-01",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await callerFor(owner).finance.createRecurring({
      type: "expense",
      accountId: id,
      amount: 999,
      userId: owner.id,
      interval: "monthly",
      nextDate: "2026-08-01",
    });

    const strangerList = await callerFor(stranger).finance.listRecurring();
    expect(strangerList.find((r) => r.accountId === id)).toBeUndefined();
    const ownerList = await callerFor(owner).finance.listRecurring();
    const row = ownerList.find((r) => r.accountId === id)!;
    expect(row).toBeDefined();

    await expect(callerFor(stranger).finance.toggleRecurring({ id: row.id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerFor(stranger).finance.deleteRecurring({ id: row.id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    // Edit-Berechtigter darf togglen/löschen
    await callerFor(editor).finance.toggleRecurring({ id: row.id });
    await callerFor(editor).finance.deleteRecurring({ id: row.id });
    expect(await getDb().query.recurring
      .findFirst({ where: eq(recurring.id, row.id) })).toBeUndefined();
  });
});

describe("setAccountPrivacy", () => {
  it("Gemeinschaftskonto: jedes Mitglied darf privat stellen und wird Besitzer", async () => {
    const id = await insertAccount(null);
    await callerFor(stranger).finance.setAccountPrivacy({ id, private: true });
    const acc = await getDb().query.accounts
      .findFirst({ where: eq(accounts.id, id) });
    expect(acc?.ownerId).toBe(stranger.id);
  });

  it("privat → gemeinsam: nur Besitzer oder Admin, Freigaben werden entfernt", async () => {
    const id = await insertAccount(owner.id);
    await setPermission(id, viewer.id, true);

    await expect(
      callerFor(stranger).finance.setAccountPrivacy({ id, private: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Auch ein Mitglied mit Freigabe darf nicht freigeben
    await expect(
      callerFor(viewer).finance.setAccountPrivacy({ id, private: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await callerFor(owner).finance.setAccountPrivacy({ id, private: false });
    const acc = await getDb().query.accounts
      .findFirst({ where: eq(accounts.id, id) });
    expect(acc?.ownerId).toBeNull();
    const perms = await getDb().select().from(accountPermissions)
      .where(eq(accountPermissions.accountId, id));
    expect(perms).toHaveLength(0);
  });

  it("Nicht-Besitzer darf fremdes Privatkonto nicht verändern", async () => {
    const id = await insertAccount(owner.id);
    await expect(
      callerFor(stranger).finance.setAccountPrivacy({ id, private: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setAccountPermission / listAccountPermissions", () => {
  it("nur der Besitzer darf Freigaben setzen", async () => {
    const id = await insertAccount(owner.id);
    await expect(
      callerFor(viewer).finance.setAccountPermission({
        accountId: id, userId: stranger.id, level: "view",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerFor(admin).finance.setAccountPermission({
        accountId: id, userId: stranger.id, level: "view",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Ziel-User muss existieren und darf nicht der Besitzer sein", async () => {
    const id = await insertAccount(owner.id);
    await expect(
      callerFor(owner).finance.setAccountPermission({
        accountId: id, userId: 999, level: "view",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerFor(owner).finance.setAccountPermission({
        accountId: id, userId: owner.id, level: "view",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("Upsert aktualisiert die Stufe, 'none' entfernt die Zeile", async () => {
    const id = await insertAccount(owner.id);
    const set = (level: "none" | "view" | "edit") =>
      callerFor(owner).finance.setAccountPermission({
        accountId: id, userId: viewer.id, level,
      });
    const perms = () =>
      callerFor(owner).finance.listAccountPermissions({ accountId: id });

    await set("view");
    expect(await perms()).toMatchObject([{ userId: viewer.id, canEdit: false }]);

    await set("edit");
    expect(await perms()).toMatchObject([{ userId: viewer.id, canEdit: true }]);

    await set("none");
    expect(await perms()).toHaveLength(0);
  });

  it("listAccountPermissions: Besitzer oder Admin, sonst NOT_FOUND", async () => {
    const id = await insertAccount(owner.id);
    await expect(callerFor(stranger).finance.listAccountPermissions({ accountId: id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await callerFor(admin).finance.listAccountPermissions({ accountId: id }))
      .toEqual([]);
    expect(await callerFor(owner).finance.listAccountPermissions({ accountId: id }))
      .toEqual([]);
  });
});
