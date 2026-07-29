import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accountOwners, accountPermissions, accounts, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  color: "#10b981",
};
const owner: SessionUser = {
  id: 2,
  email: "owner@example.com",
  name: "Besitzer",
  role: "member",
  color: "#6366f1",
};
const coowner: SessionUser = {
  id: 3,
  email: "coowner@example.com",
  name: "Zweitbesitzer",
  role: "member",
  color: "#f59e0b",
};
const viewer: SessionUser = {
  id: 4,
  email: "viewer@example.com",
  name: "Betrachter",
  role: "member",
  color: "#ef4444",
};
const stranger: SessionUser = {
  id: 5,
  email: "stranger@example.com",
  name: "Fremder",
  role: "member",
  color: "#94a3b8",
};

const ALL_USERS = [admin, owner, coowner, viewer, stranger];

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

let nameCounter = 0;

/** Konto mit Besitzerliste direkt in der DB anlegen */
async function insertAccount(ownerIds: number[]): Promise<number> {
  nameCounter += 1;
  const rows = await getDb()
    .insert(accounts)
    .values({
      name: `Konto ${nameCounter}`,
      type: "checking",
      initialBalance: 0,
      createdAt: new Date(),
    })
    .returning({ id: accounts.id });
  const id = rows[0].id;
  for (const userId of ownerIds) {
    await getDb().insert(accountOwners).values({ accountId: id, userId });
  }
  return id;
}

/** Besitzer-UserIds eines Kontos aus account_owners lesen */
async function ownerIdsOfAccount(accountId: number): Promise<number[]> {
  const rows = await getDb()
    .select()
    .from(accountOwners)
    .where(eq(accountOwners.accountId, accountId));
  return rows.map(r => r.userId).sort();
}

/** Konto im Alt-Format anlegen (owner_id-Spalte, Stand vor der Migration) */
async function insertLegacyAccount(
  name: string,
  ownerId: number | null
): Promise<number> {
  getDb().run(
    `INSERT INTO accounts (name, type, initial_balance, owner_id, created_at)
     VALUES ('${name}', 'checking', 0, ${ownerId === null ? "NULL" : ownerId}, 0)` as never
  );
  const row = await getDb().query.accounts.findFirst({
    where: eq(accounts.name, name),
  });
  return row!.id;
}

/** Alle Zeilen aus account_owners (rohe Paare für Migrations-Assertions) */
async function allOwnerRows(): Promise<
  { accountId: number; userId: number }[]
> {
  const rows = await getDb()
    .select({
      accountId: accountOwners.accountId,
      userId: accountOwners.userId,
    })
    .from(accountOwners);
  return rows.sort((a, b) => a.accountId - b.accountId);
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

// Dieser Block muss vor allen anderen laufen: die Migration greift nur,
// solange account_owners noch leer ist.
describe("Migration owner_id → account_owners", () => {
  it("übernimmt Bestands-Besitzer (Migration: Konto gehört dem Ersteller)", async () => {
    const legacyPrivate = await insertLegacyAccount("Alt Privat", owner.id);
    await insertLegacyAccount("Alt Gemeinsam", null);

    ensureSchema(); // führt die Migration aus

    expect(await allOwnerRows()).toEqual([
      { accountId: legacyPrivate, userId: owner.id },
    ]);
  });

  it("ist idempotent und überspringt eine gefüllte account_owners-Tabelle", async () => {
    const before = await allOwnerRows();
    // Neues Alt-Konto mit owner_id — darf NICHT mehr migriert werden,
    // weil account_owners bereits Zeilen enthält
    await insertLegacyAccount("Alt Nachzügler", coowner.id);

    ensureSchema();
    ensureSchema();

    expect(await allOwnerRows()).toEqual(before);
  });
});

describe("Mehrere Besitzer (Rechte)", () => {
  it("beide Besitzer haben edit und isOwner, Admin nur view, Fremde nichts", async () => {
    const id = await insertAccount([owner.id, coowner.id]);

    const byId = (list: { id: number }[]) => list.find(a => a.id === id);

    const ownerAcc = byId(await callerFor(owner).finance.listAccounts());
    expect(ownerAcc).toMatchObject({
      access: "edit",
      isOwner: true,
      owners: expect.arrayContaining([owner.id, coowner.id]),
    });

    const coownerAcc = byId(await callerFor(coowner).finance.listAccounts());
    expect(coownerAcc).toMatchObject({ access: "edit", isOwner: true });

    // Admin ist kein Besitzer → nur lesend
    const adminAcc = byId(await callerFor(admin).finance.listAccounts());
    expect(adminAcc).toMatchObject({ access: "view", isOwner: false });
    await expect(
      callerFor(admin).finance.updateAccount({
        id,
        name: "x",
        type: "checking",
        initialBalance: 0,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(
      byId(await callerFor(stranger).finance.listAccounts())
    ).toBeUndefined();

    // Beide Besitzer dürfen buchen
    const base = {
      type: "expense" as const,
      accountId: id,
      amount: 100,
      date: "2026-07-06",
      note: "",
    };
    await callerFor(owner).finance.createTransaction({
      ...base,
      userId: owner.id,
    });
    await callerFor(coowner).finance.createTransaction({
      ...base,
      userId: coowner.id,
    });
  });

  it("jeder Besitzer darf Freigaben setzen und die Privacy verwalten", async () => {
    const id = await insertAccount([owner.id, coowner.id]);

    // Freigabe durch den ZWEITEN Besitzer
    await callerFor(coowner).finance.setAccountPermission({
      accountId: id,
      userId: viewer.id,
      level: "view",
    });
    const viewerAcc = (await callerFor(viewer).finance.listAccounts()).find(
      a => a.id === id
    );
    expect(viewerAcc).toMatchObject({ access: "view", isOwner: false });

    // Freigabe für einen Besitzer ist nicht zulässig
    await expect(
      callerFor(owner).finance.setAccountPermission({
        accountId: id,
        userId: coowner.id,
        level: "view",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Privacy: Nicht-Besitzer mit Freigabe darf nicht freigeben,
    // der zweite Besitzer schon
    await expect(
      callerFor(viewer).finance.setAccountPrivacy({ id, private: false })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await callerFor(coowner).finance.setAccountPrivacy({ id, private: false });
    expect(await ownerIdsOfAccount(id)).toEqual([]);
  });
});

describe("setAccountOwners", () => {
  it("ersetzt die Besitzerliste komplett (1 → n)", async () => {
    const id = await insertAccount([owner.id]);
    await callerFor(owner).finance.setAccountOwners({
      accountId: id,
      userIds: [owner.id, coowner.id],
    });
    expect(await ownerIdsOfAccount(id)).toEqual([owner.id, coowner.id]);
    const coownerAcc = (await callerFor(coowner).finance.listAccounts()).find(
      a => a.id === id
    );
    expect(coownerAcc).toMatchObject({ access: "edit", isOwner: true });
  });

  it("leere Liste wird abgelehnt", async () => {
    const id = await insertAccount([owner.id]);
    await expect(
      callerFor(owner).finance.setAccountOwners({ accountId: id, userIds: [] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Ein Konto braucht mindestens eine:n Besitzer:in.",
    });
    expect(await ownerIdsOfAccount(id)).toEqual([owner.id]);
  });

  it("unbekannte Benutzer werden abgelehnt", async () => {
    const id = await insertAccount([owner.id]);
    await expect(
      callerFor(owner).finance.setAccountOwners({
        accountId: id,
        userIds: [owner.id, 999],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await ownerIdsOfAccount(id)).toEqual([owner.id]);
  });

  it("nur Besitzer oder Admin dürfen die Liste ändern", async () => {
    const id = await insertAccount([owner.id]);
    await expect(
      callerFor(stranger).finance.setAccountOwners({
        accountId: id,
        userIds: [stranger.id],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Admin (kein Besitzer) darf
    await callerFor(admin).finance.setAccountOwners({
      accountId: id,
      userIds: [owner.id, coowner.id],
    });
    expect(await ownerIdsOfAccount(id)).toEqual([owner.id, coowner.id]);
  });

  it("Besitzer dürfen sich selbst entfernen, solange ein Besitzer bleibt", async () => {
    const id = await insertAccount([owner.id, coowner.id]);
    await callerFor(owner).finance.setAccountOwners({
      accountId: id,
      userIds: [coowner.id],
    });
    expect(await ownerIdsOfAccount(id)).toEqual([coowner.id]);
    // Der entfernte Besitzer verliert den Zugriff
    const ownerList = await callerFor(owner).finance.listAccounts();
    expect(ownerList.find(a => a.id === id)).toBeUndefined();
  });

  it("Freigaben neuer Besitzer werden entfernt", async () => {
    const id = await insertAccount([owner.id]);
    await callerFor(owner).finance.setAccountPermission({
      accountId: id,
      userId: viewer.id,
      level: "edit",
    });
    await callerFor(owner).finance.setAccountOwners({
      accountId: id,
      userIds: [owner.id, viewer.id],
    });
    const perms = await getDb()
      .select()
      .from(accountPermissions)
      .where(eq(accountPermissions.accountId, id));
    expect(perms).toHaveLength(0);
  });
});
