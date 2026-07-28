import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { initDb } from "./queries/connection";
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

beforeAll(async () => {
  await initDb();
  ensureSchema();
  // Echten Benutzer für die Login-Tests anlegen (Ersteinrichtung)
  await callerFor().auth.setup({
    name: "Admin",
    email: "admin@example.com",
    password: "geheim-123",
  });
});

describe("Audit-Log", () => {
  it("protokolliert Login-Erfolg und -Fehlschlag ohne Geheimnisse im Detail", async () => {
    await callerFor().auth.login({
      email: "admin@example.com",
      password: "geheim-123",
    });
    await expect(
      callerFor().auth.login({
        email: "admin@example.com",
        password: "falsches-passwort",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const authEntries = await callerFor(member).finance.listAuditLog({
      entity: "auth",
    });
    const success = authEntries.find(e => e.action === "auth.login");
    expect(success?.userName).toBe("Admin");
    expect(success?.detail).toBe("admin@example.com");

    const failed = authEntries.find(e => e.action === "auth.login.failed");
    expect(failed).toBeDefined();
    // Fehlschlag vor dem Login: kein Benutzer zugeordnet → „System“
    expect(failed?.userId).toBeNull();
    expect(failed?.userName).toBeNull();
    expect(failed?.detail).toContain("admin@example.com");
    // Kein Passwort o. ä. im Detail
    expect(failed?.detail).not.toContain("falsches-passwort");
    expect(failed?.detail).not.toContain("geheim-123");
  });

  it("schreibt Einträge bei fachlichen Mutationen (Konto, Buchung, Budget)", async () => {
    const caller = callerFor(admin);
    await caller.finance.createAccount({
      name: "Girokonto",
      type: "checking",
      initialBalance: 0,
      private: false,
    });
    const accounts = await caller.finance.listAccounts();
    const accountId = accounts[0].id;
    await caller.finance.createCategory({
      name: "Lebensmittel",
      type: "expense",
      color: "#10b981",
    });
    const categories = await caller.finance.listCategories();
    const categoryId = categories[0].id;
    await caller.finance.createTransaction({
      type: "expense",
      accountId,
      amount: 1234,
      categoryId,
      userId: admin.id,
      date: "2026-01-15",
      note: "Wocheneinkauf",
    });
    await caller.finance.setBudget({ categoryId, amount: 30000 });

    const entries = await caller.finance.listAuditLog();
    const actions = entries.map(e => e.action);
    expect(actions).toContain("account.created");
    expect(actions).toContain("category.created");
    expect(actions).toContain("transaction.created");
    expect(actions).toContain("budget.saved");

    const txEntry = entries.find(e => e.action === "transaction.created");
    expect(txEntry?.userName).toBe("Admin");
    expect(txEntry?.entityId).not.toBeNull();
    expect(txEntry?.detail).toContain("12,34");
    expect(txEntry?.detail).toContain("2026-01-15");
    expect(txEntry?.detail).toContain("Wocheneinkauf");

    const accountEntry = entries.find(e => e.action === "account.created");
    expect(accountEntry?.detail).toBe("Girokonto");
  });

  it("liefert neueste zuerst und respektiert das Limit", async () => {
    const all = await callerFor(member).finance.listAuditLog();
    expect(all.length).toBeGreaterThan(3);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].id).toBeGreaterThan(all[i].id);
    }
    const limited = await callerFor(member).finance.listAuditLog({ limit: 3 });
    expect(limited).toHaveLength(3);
    expect(limited[0].id).toBe(all[0].id);
  });

  it("filtert nach entity und joint den Benutzernamen", async () => {
    const accountEntries = await callerFor(member).finance.listAuditLog({
      entity: "account",
    });
    expect(accountEntries.length).toBeGreaterThan(0);
    expect(accountEntries.every(e => e.entity === "account")).toBe(true);
    // userName-Join: Eintrag mit Benutzer hat Namen, System-Eintrag (userId
    // null, z. B. Login-Fehlschlag) hat userName null
    expect(accountEntries.every(e => e.userName === "Admin")).toBe(true);
    const all = await callerFor(member).finance.listAuditLog();
    expect(all.some(e => e.userId === null && e.userName === null)).toBe(true);
  });
});
