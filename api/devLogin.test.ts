import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, users } from "@db/schema";
import {
  DEV_USERS,
  ensureDevHousehold,
  isEnabled,
  resolveDevUser,
} from "./lib/devLogin";
import { env } from "./lib/env";

/**
 * Der Entwicklungs-Login ist ein Auth-Bypass — die beiden Riegel sind das
 * Einzige, was ihn aus der Produktion heraushält. Sie gehören getestet.
 */

beforeAll(async () => {
  await initDb();
  ensureSchema();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** env ist ein einfaches Objekt — für den Test gezielt umschalten */
function withEnv(over: { isProduction?: boolean; devLogin?: boolean }) {
  if (over.isProduction !== undefined) {
    vi.spyOn(env, "isProduction", "get").mockReturnValue(over.isProduction);
  }
  if (over.devLogin !== undefined) {
    vi.spyOn(env, "devLogin", "get").mockReturnValue(over.devLogin);
  }
}

describe("Freischaltung des Entwicklungs-Logins", () => {
  it("bleibt aus, wenn DEV_LOGIN fehlt", () => {
    withEnv({ isProduction: false, devLogin: false });
    expect(isEnabled()).toBe(false);
  });

  it("bleibt in Produktion aus — auch mit DEV_LOGIN=1", () => {
    withEnv({ isProduction: true, devLogin: true });
    expect(isEnabled()).toBe(false);
  });

  it("greift nur, wenn beide Riegel offen sind", () => {
    withEnv({ isProduction: false, devLogin: true });
    expect(isEnabled()).toBe(true);
  });
});

describe("Dev-Haushalt", () => {
  it("legt beide Identitäten ohne Passwort-Hash an", async () => {
    const db = getDb();
    await ensureDevHousehold(db);

    for (const dev of Object.values(DEV_USERS)) {
      const row = await db.query.users.findFirst({
        where: eq(users.email, dev.email),
      });
      expect(row).toBeDefined();
      expect(row!.name).toBe(dev.name);
      expect(row!.role).toBe(dev.role);
      expect(row!.active).toBe(true);
      // Ohne Hash ist ein regulärer Login mit diesen Konten unmöglich
      expect(row!.passwordHash).toBeNull();
    }
  });

  it("ist idempotent — ein zweiter Lauf legt nichts doppelt an", async () => {
    const db = getDb();
    await ensureDevHousehold(db);
    await ensureDevHousehold(db);
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEV_USERS.admin.email));
    expect(rows).toHaveLength(1);
  });

  it("legt genau ein Gemeinschaftskonto an und danach keins mehr", async () => {
    const db = getDb();
    await ensureDevHousehold(db);
    const before = await db.select({ id: accounts.id }).from(accounts);
    await ensureDevHousehold(db);
    const after = await db.select({ id: accounts.id }).from(accounts);
    expect(after).toHaveLength(before.length);
    expect(before.length).toBeGreaterThan(0);
  });

  it("löst beide Personas auf", async () => {
    const db = getDb();
    const admin = await resolveDevUser(db, "admin");
    const member = await resolveDevUser(db, "member");
    expect(admin?.name).toBe("Dev Admin");
    expect(member?.name).toBe("Dev Mitglied");
    expect(admin?.id).not.toBe(member?.id);
  });
});
