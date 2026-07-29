import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { getDb, initDb } from "./queries/connection";
import { ensureSchema } from "./lib/migrate";
import { users } from "@db/schema";
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

let sharedAccountId = 0;
let memberPrivateAccountId = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  await db.insert(users).values(
    [admin, member].map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      createdAt: new Date(),
    }))
  );
  await callerFor(admin).finance.createAccount({
    name: "Gemeinschaftskonto",
    type: "savings",
    initialBalance: 100000,
    private: false,
  });
  await callerFor(member).finance.createAccount({
    name: "Member-Privat",
    type: "savings",
    initialBalance: 50000,
    private: true,
  });
  sharedAccountId = (await callerFor(admin).finance.listAccounts()).find(
    a => a.name === "Gemeinschaftskonto"
  )!.id;
  memberPrivateAccountId = (await callerFor(member).finance.listAccounts()).find(
    a => a.name === "Member-Privat"
  )!.id;
});

describe("Schnellerfassung-Konto (auth.setQuickAccount)", () => {
  it("ist anfangs null (automatische Kontowahl)", async () => {
    const me = await callerFor(admin).auth.me();
    expect(me?.quickAccountId).toBeNull();
  });

  it("speichert das konfigurierte Konto pro Benutzer", async () => {
    await callerFor(admin).auth.setQuickAccount({
      accountId: sharedAccountId,
    });
    const me = await callerFor(admin).auth.me();
    expect(me?.quickAccountId).toBe(sharedAccountId);
    // anderer Benutzer bleibt unberührt
    const meMember = await callerFor(member).auth.me();
    expect(meMember?.quickAccountId).toBeNull();
  });

  it("erfordert „edit“-Recht auf dem Konto", async () => {
    // Member-Privatkonto ist für den Admin nur lesend
    await expect(
      callerFor(admin).auth.setQuickAccount({
        accountId: memberPrivateAccountId,
      })
    ).rejects.toThrow();
    // ungültige Konto-ID
    await expect(
      callerFor(admin).auth.setQuickAccount({ accountId: 99999 })
    ).rejects.toThrow();
  });

  it("setzt die Konfiguration mit null zurück", async () => {
    await callerFor(admin).auth.setQuickAccount({ accountId: null });
    const me = await callerFor(admin).auth.me();
    expect(me?.quickAccountId).toBeNull();
  });
});
