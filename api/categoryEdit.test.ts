import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { initDb, getDb } from "./queries/connection";
import { users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  color: "#10b981",
};

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

const caller = () => callerFor(admin);

/** Kategorie anlegen und ihre ID zurückgeben */
async function createCat(
  name: string,
  type: "income" | "expense" = "expense",
  parentId?: number
): Promise<number> {
  await caller().finance.createCategory({ name, type, color: "#f43f5e", parentId });
  const cats = await caller().finance.listCategories();
  return cats.find(c => c.name === name)!.id;
}

const getCat = async (id: number) =>
  (await caller().finance.listCategories()).find(c => c.id === id);

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

describe("updateCategory: Name und Farbe", () => {
  it("ändert Name und Farbe einer Oberkategorie und schreibt ein Audit-Log", async () => {
    const id = await createCat("Lebensmittel");
    await caller().finance.updateCategory({
      id,
      name: "Einkaufen",
      color: "#3b82f6",
    });
    const cat = await getCat(id);
    expect(cat?.name).toBe("Einkaufen");
    expect(cat?.color).toBe("#3b82f6");
    expect(cat?.parentId).toBeNull();

    const entries = await caller().finance.listAuditLog({ entity: "category" });
    const updated = entries.find(e => e.action === "category.updated");
    expect(updated?.entityId).toBe(id);
    expect(updated?.detail).toBe("Einkaufen");
  });

  it("lässt die Einordnung unverändert, wenn parentId nicht mitgegeben wird", async () => {
    const parentId = await createCat("Wohnen");
    const childId = await createCat("Nebenkosten", "expense", parentId);
    await caller().finance.updateCategory({
      id: childId,
      name: "Betriebskosten",
      color: "#123456",
    });
    const cat = await getCat(childId);
    expect(cat?.name).toBe("Betriebskosten");
    expect(cat?.parentId).toBe(parentId);
  });
});

describe("updateCategory: Validierung", () => {
  it("wirft NOT_FOUND bei unbekannter Kategorie", async () => {
    await expect(
      caller().finance.updateCategory({ id: 99999, name: "X", color: "#f43f5e" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("wirft CONFLICT bei Namens-Duplikat (case-insensitiv, andere ID)", async () => {
    const id = await createCat("Transport");
    // Umbenennen auf den eigenen Namen (andere Schreibweise) ist erlaubt
    await caller().finance.updateCategory({
      id,
      name: "TRANSPORT",
      color: "#f43f5e",
    });
    const andereId = await createCat("Mobilität");
    await expect(
      caller().finance.updateCategory({
        id: andereId,
        name: "transport",
        color: "#f43f5e",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("updateCategory: parentId-Validierung", () => {
  it("verbietet die Selbstreferenz", async () => {
    const id = await createCat("Selbstbezug");
    await expect(
      caller().finance.updateCategory({
        id,
        name: "Selbstbezug",
        color: "#f43f5e",
        parentId: id,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("verlangt denselben Typ wie die Oberkategorie", async () => {
    const einnahmeRootId = await createCat("Gehalt", "income");
    const ausgabeId = await createCat("Sonstiges");
    await expect(
      caller().finance.updateCategory({
        id: ausgabeId,
        name: "Sonstiges",
        color: "#f43f5e",
        parentId: einnahmeRootId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("verbietet eine Unterkategorie als neue Oberkategorie (kein Zyklus/tieferer Baum)", async () => {
    const rootId = await createCat("Essen");
    const childId = await createCat("Kantine", "expense", rootId);
    const andereId = await createCat("Freizeit");
    await expect(
      caller().finance.updateCategory({
        id: andereId,
        name: "Freizeit",
        color: "#f43f5e",
        parentId: childId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("wirft NOT_FOUND bei unbekannter Oberkategorie", async () => {
    const id = await createCat("Waisenkind");
    await expect(
      caller().finance.updateCategory({
        id,
        name: "Waisenkind",
        color: "#f43f5e",
        parentId: 99999,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hängt eine Kategorie unter eine neue Oberkategorie und erbt deren Farbe", async () => {
    const rootId = await createCat("Haushalt");
    await caller().finance.updateCategory({
      id: rootId,
      name: "Haushalt",
      color: "#a855f7",
    });
    const id = await createCat("Putzmittel");
    await caller().finance.updateCategory({
      id,
      name: "Putzmittel",
      color: "#f43f5e",
      parentId: rootId,
    });
    const cat = await getCat(id);
    expect(cat?.parentId).toBe(rootId);
    expect(cat?.color).toBe("#a855f7");
  });
});

describe("updateCategory: Zurück zur Oberkategorie", () => {
  it("macht eine Unterkategorie wieder zur Oberkategorie (parentId null)", async () => {
    const rootId = await createCat("Versicherungen");
    const childId = await createCat("Haftpflicht", "expense", rootId);
    await caller().finance.updateCategory({
      id: childId,
      name: "Haftpflicht",
      color: "#14b8a6",
      parentId: null,
    });
    const cat = await getCat(childId);
    expect(cat?.parentId).toBeNull();
    expect(cat?.color).toBe("#14b8a6");
  });

  it("verbietet das Verschieben einer Kategorie mit Unterkategorien (CONFLICT)", async () => {
    const rootId = await createCat("Kinder");
    await createCat("Taschengeld", "expense", rootId);
    const andereRootId = await createCat("Sparen");
    // Als Unterkategorie verschieben
    await expect(
      caller().finance.updateCategory({
        id: rootId,
        name: "Kinder",
        color: "#f43f5e",
        parentId: andereRootId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Zur Oberkategorie machen (bereits Oberkategorie = unverändert, erlaubt)
    await caller().finance.updateCategory({
      id: rootId,
      name: "Kinder",
      color: "#f43f5e",
      parentId: null,
    });
    const cat = await getCat(rootId);
    expect(cat?.parentId).toBeNull();
  });
});
