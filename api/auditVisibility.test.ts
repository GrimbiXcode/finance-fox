import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accountOwners, accounts, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = { id: 1, email: "a@example.com", name: "Anna", role: "admin", color: "#10b981" };
const ben: SessionUser = { id: 2, email: "b@example.com", name: "Ben", role: "member", color: "#6366f1" };
const cleo: SessionUser = { id: 3, email: "c@example.com", name: "Cleo", role: "member", color: "#D9692C" };

const as = (user: SessionUser) => {
  const ctx: TrpcContext = { req: new Request("http://localhost/api/trpc"), resHeaders: new Headers(), user };
  return appRouter.createCaller(ctx);
};

let shared = 0;
let privateBen = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [admin, ben, cleo]) await db.insert(users).values({ ...u, active: true, createdAt: new Date() });
  shared = (await db.insert(accounts).values({ name: "Haushalt", type: "checking", initialBalance: 0, createdAt: new Date() }).returning({ id: accounts.id }))[0].id;
  privateBen = (await db.insert(accounts).values({ name: "Privat Ben", type: "checking", initialBalance: 0, createdAt: new Date() }).returning({ id: accounts.id }))[0].id;
  await db.insert(accountOwners).values({ accountId: privateBen, userId: ben.id });

  await as(ben).finance.createTransaction({ type: "expense", accountId: privateBen, amount: 4_200, userId: ben.id, date: "2026-09-01", note: "Überraschungsgeschenk" });
  await as(ben).finance.createTransaction({ type: "expense", accountId: shared, amount: 1_000, userId: ben.id, date: "2026-09-02", note: "Brot" });
  const secret = (await as(ben).finance.listTransactions()).find(t => t.note === "Brot")!;
  await as(ben).finance.deleteTransaction({ id: secret.id });
  await as(ben).finance.createTransaction({ type: "expense", accountId: shared, amount: 1_500, userId: ben.id, date: "2026-09-03", note: "Milch" });
  await as(ben).pension.updateProfile({ birthDate: "1990-01-01", retirementAge: 65 });
});

const details = async (user: SessionUser) =>
  (await as(user).finance.listAuditLog({ limit: 200 })).map(e => `${e.action} ${e.detail}`);

describe("Aktivitäten-Log: Sichtbarkeit", () => {
  it("zeigt dem Besitzer alles Eigene", async () => {
    const own = await details(ben);
    expect(own.some(d => d.includes("Überraschungsgeschenk"))).toBe(true);
    expect(own.some(d => d.startsWith("pension."))).toBe(true);
  });

  it("verbirgt fremde Vorsorge und Buchungen auf fremden Privatkonten", async () => {
    const other = await details(cleo);
    expect(other.some(d => d.includes("Überraschungsgeschenk"))).toBe(false);
    expect(other.some(d => d.startsWith("pension."))).toBe(false);
    // Gelöschte Buchungen lassen sich keinem Konto mehr zuordnen → nur
    // Urheber und Admins (auch der Eintrag ihrer Erfassung)
    expect(other.some(d => d.includes("Brot"))).toBe(false);
    // Bestehende Buchungen auf dem Gemeinschaftskonto bleiben sichtbar
    expect(other.some(d => d.startsWith("transaction.created") && d.includes("Milch"))).toBe(true);
  });

  it("zeigt Admins Privatkonten (lesend), aber keine fremde Vorsorge", async () => {
    const adm = await details(admin);
    expect(adm.some(d => d.includes("Überraschungsgeschenk"))).toBe(true);
    expect(adm.some(d => d.startsWith("transaction.deleted"))).toBe(true);
    expect(adm.some(d => d.startsWith("pension."))).toBe(false);
  });

  it("filtert nach Person und Bereichen", async () => {
    const rows = await as(admin).finance.listAuditLog({ limit: 50, userId: ben.id, entities: ["transaction"] });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.userId === ben.id && r.entity === "transaction")).toBe(true);
  });
});
