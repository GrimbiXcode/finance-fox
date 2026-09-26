import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { initDb, getDb } from "./queries/connection";
import { users } from "@db/schema";
import { DEFAULT_CATEGORIES } from "@contracts/defaultCategories";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  color: "#10b981",
};

const caller = () => {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user: admin,
  };
  return appRouter.createCaller(ctx);
};

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

describe("addDefaultCategories", () => {
  it("legt die gewählten Ober- und Unterkategorien an", async () => {
    const res = await caller().finance.addDefaultCategories({
      keys: ["lohn", "wohnen"],
    });
    const wohnen = DEFAULT_CATEGORIES.find(c => c.key === "wohnen")!;
    expect(res.created).toBe(2 + wohnen.children.length);

    const cats = await caller().finance.listCategories();
    const root = cats.find(c => c.name === "Wohnen")!;
    expect(root.type).toBe("expense");
    expect(root.parentId).toBeNull();
    const children = cats.filter(c => c.parentId === root.id);
    expect(children.map(c => c.name).sort()).toEqual(
      [...wohnen.children].sort()
    );
    // Unterkategorien erben die Farbe der Oberkategorie
    expect(new Set(children.map(c => c.color))).toEqual(new Set([root.color]));
    expect(cats.find(c => c.name === "Lohn")?.type).toBe("income");
  });

  it("ist idempotent und ergänzt nur Fehlendes", async () => {
    const before = await caller().finance.listCategories();
    const again = await caller().finance.addDefaultCategories({
      keys: ["lohn", "wohnen"],
    });
    expect(again.created).toBe(0);
    expect((await caller().finance.listCategories()).length).toBe(
      before.length
    );

    // Eigene Oberkategorie gleichen Namens (andere Schreibweise) wird
    // wiederverwendet und nur um Unterkategorien ergänzt
    await caller().finance.createCategory({
      name: "lebensmittel",
      type: "expense",
      color: "#2F6FC4",
    });
    const res = await caller().finance.addDefaultCategories({
      keys: ["lebensmittel"],
    });
    const def = DEFAULT_CATEGORIES.find(c => c.key === "lebensmittel")!;
    expect(res.created).toBe(def.children.length);
    const cats = await caller().finance.listCategories();
    expect(
      cats.filter(c => c.name.toLowerCase() === "lebensmittel")
    ).toHaveLength(1);
  });

  it("lehnt unbekannte Schlüssel ab", async () => {
    await expect(
      caller().finance.addDefaultCategories({ keys: ["gibtsnicht" as "lohn"] })
    ).rejects.toThrow();
  });
});
