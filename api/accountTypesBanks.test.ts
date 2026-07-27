import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, accountTypes, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1, email: "admin@example.com", name: "Admin", role: "admin", color: "#10b981",
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
  await getDb().insert(users).values({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    color: admin.color,
    active: true,
    createdAt: new Date(),
  });
});

describe("ensureSchema (Builtin-Kontotypen)", () => {
  it("seedet checking/cash/savings — idempotent, ohne Überschreiben", async () => {
    // Zweiter Aufruf wie bei jedem Serverstart
    ensureSchema();
    const types = await getDb().select().from(accountTypes);
    expect(types).toHaveLength(3);
    const byKey = new Map(types.map(t => [t.key, t]));
    expect(byKey.get("checking")).toMatchObject({ name: "Girokonto", builtin: true });
    expect(byKey.get("cash")).toMatchObject({ name: "Bargeld", builtin: true });
    expect(byKey.get("savings")).toMatchObject({ name: "Sparkonto", builtin: true });
  });
});

describe("listAccountTypes / createAccountType", () => {
  it("listet Builtin zuerst, dann eigene Typen nach Name", async () => {
    const list = await callerFor(admin).finance.listAccountTypes();
    expect(list.slice(0, 3).every(t => t.builtin)).toBe(true);
  });

  it("legt einen eigenen Typ mit custom_-Key an", async () => {
    const created = await callerFor(admin).finance.createAccountType({
      name: " Säule 3a ",
    });
    expect(created).toMatchObject({ name: "Säule 3a", builtin: false });
    expect(created.key).toMatch(/^custom_[0-9a-f]{8}$/);
  });

  it("lehnt doppelte Namen ab (case-insensitiv)", async () => {
    await expect(
      callerFor(admin).finance.createAccountType({ name: "säule 3A" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Ein Kontotyp mit diesem Namen existiert bereits.",
    });
    // Auch Konflikt mit Builtin-Namen
    await expect(
      callerFor(admin).finance.createAccountType({ name: "GIROKONTO" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("deleteAccountType", () => {
  it("Builtin-Typen können nicht gelöscht werden", async () => {
    const types = await callerFor(admin).finance.listAccountTypes();
    const checking = types.find(t => t.key === "checking")!;
    await expect(
      callerFor(admin).finance.deleteAccountType({ id: checking.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Standard-Kontotypen können nicht gelöscht werden.",
    });
  });

  it("Typ in Verwendung → CONFLICT mit Anzahl; nach Freigabe löschbar", async () => {
    const created = await callerFor(admin).finance.createAccountType({
      name: "Anlagekonto",
    });
    await callerFor(admin).finance.createAccount({
      name: "Depot",
      type: created.key,
      initialBalance: 0,
      private: false,
    });
    await expect(
      callerFor(admin).finance.deleteAccountType({ id: created.id }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Der Kontotyp wird noch von 1 Konto verwendet.",
    });

    // Konto auf anderen Typ umstellen, dann klappt das Löschen
    const acc = (await getDb().select().from(accounts)
      .where(eq(accounts.type, created.key)))[0];
    await callerFor(admin).finance.updateAccount({
      id: acc.id,
      name: acc.name,
      type: "savings",
      initialBalance: acc.initialBalance,
    });
    await callerFor(admin).finance.deleteAccountType({ id: created.id });
    expect(await getDb().query.accountTypes
      .findFirst({ where: eq(accountTypes.id, created.id) })).toBeUndefined();
  });
});

describe("Banken (CRUD)", () => {
  it("anlegen, auflisten (nach Name sortiert), Konflikt bei Dublette", async () => {
    const zkb = await callerFor(admin).finance.createBank({ name: "ZKB" });
    expect(zkb).toMatchObject({ name: "ZKB" });
    await callerFor(admin).finance.createBank({ name: "Postfinance" });
    const list = await callerFor(admin).finance.listBanks();
    expect(list.map(b => b.name)).toEqual(["Postfinance", "ZKB"]);
    await expect(
      callerFor(admin).finance.createBank({ name: "zkb" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Eine Bank mit diesem Namen existiert bereits.",
    });
  });

  it("Bank in Verwendung → CONFLICT mit Anzahl; freie Bank löschbar", async () => {
    const bank = await callerFor(admin).finance.createBank({ name: "Migros Bank" });
    await callerFor(admin).finance.createAccount({
      name: "Haushaltskonto",
      type: "checking",
      initialBalance: 0,
      bankId: bank.id,
      private: false,
    });
    await expect(callerFor(admin).finance.deleteBank({ id: bank.id }))
      .rejects.toMatchObject({
        code: "CONFLICT",
        message: "Die Bank wird noch von 1 Konto verwendet.",
      });

    const frei = await callerFor(admin).finance.createBank({ name: "Freie Bank" });
    await callerFor(admin).finance.deleteBank({ id: frei.id });
    expect(await callerFor(admin).finance.listBanks())
      .toHaveLength(3);
  });

  it("unbekannte Bank bei createAccount → BAD_REQUEST", async () => {
    await expect(
      callerFor(admin).finance.createAccount({
        name: "Fehlerkonto",
        type: "checking",
        initialBalance: 0,
        bankId: 999,
        private: false,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Unbekannte Bank." });
  });
});

describe("Konto mit Typ/Bank/IBAN", () => {
  it("Custom-Typ, Bank und IBAN werden gespeichert und mitgeliefert", async () => {
    const type = await callerFor(admin).finance.createAccountType({
      name: "Vorsorge",
    });
    const bank = await callerFor(admin).finance.createBank({ name: "VZ" });
    await callerFor(admin).finance.createAccount({
      name: "Vorsorgekonto",
      type: type.key,
      initialBalance: 500,
      bankId: bank.id,
      iban: "CH93 0076 2011 6238 5295 7",
      private: false,
    });
    const list = await callerFor(admin).finance.listAccounts();
    const acc = list.find(a => a.name === "Vorsorgekonto")!;
    // IBAN normalisiert: ohne Leerzeichen, Großbuchstaben
    expect(acc).toMatchObject({
      type: type.key,
      bankId: bank.id,
      iban: "CH9300762011623852957",
    });
  });

  it("ungültige IBAN → BAD_REQUEST; leere IBAN → null", async () => {
    await expect(
      callerFor(admin).finance.createAccount({
        name: "IBAN-Fehler",
        type: "checking",
        initialBalance: 0,
        iban: "CH93 0076",
        private: false,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Ungültige IBAN." });

    await callerFor(admin).finance.createAccount({
      name: "Ohne IBAN",
      type: "checking",
      initialBalance: 0,
      iban: "",
      private: false,
    });
    const list = await callerFor(admin).finance.listAccounts();
    expect(list.find(a => a.name === "Ohne IBAN")).toMatchObject({
      iban: null, bankId: null,
    });
  });

  it("unbekannter Kontotyp → BAD_REQUEST", async () => {
    await expect(
      callerFor(admin).finance.createAccount({
        name: "Typ-Fehler",
        type: "custom_gibtsnicht",
        initialBalance: 0,
        private: false,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Unbekannter Kontotyp.",
    });
  });

  it("updateAccount ändert Bank/IBAN und kann sie zurücksetzen", async () => {
    const bank = await callerFor(admin).finance.createBank({ name: "Raiffeisen" });
    await callerFor(admin).finance.createAccount({
      name: "Wechselkonto",
      type: "checking",
      initialBalance: 0,
      private: false,
    });
    const acc = (await callerFor(admin).finance.listAccounts())
      .find(a => a.name === "Wechselkonto")!;

    await callerFor(admin).finance.updateAccount({
      id: acc.id,
      name: acc.name,
      type: acc.type,
      initialBalance: acc.initialBalance,
      bankId: bank.id,
      iban: "de91 1000 0000 0123 4567 89",
    });
    let updated = (await callerFor(admin).finance.listAccounts())
      .find(a => a.id === acc.id)!;
    expect(updated).toMatchObject({
      bankId: bank.id,
      iban: "DE91100000000123456789",
    });

    await callerFor(admin).finance.updateAccount({
      id: acc.id,
      name: acc.name,
      type: acc.type,
      initialBalance: acc.initialBalance,
      bankId: null,
      iban: "",
    });
    updated = (await callerFor(admin).finance.listAccounts())
      .find(a => a.id === acc.id)!;
    expect(updated).toMatchObject({ bankId: null, iban: null });
  });
});
