import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { initDb } from "./queries/connection";
import { users } from "@db/schema";
import { getDb } from "./queries/connection";
import { sharesFromWeights } from "@contracts/splitShares";
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
  const accs = await callerFor(admin).finance.listAccounts();
  accountId = accs[0].id;
});

describe("Projekte", () => {
  let urlaubId: number;

  it("legt Projekte an und listet sie", async () => {
    const created = await callerFor(admin).finance.createProject({
      name: "Urlaub 2026",
      color: "#3b82f6",
    });
    urlaubId = created.id;
    const list = await callerFor(member).finance.listProjects();
    expect(list.map(p => p.name)).toContain("Urlaub 2026");
  });

  it("lehnt doppelte Projektnamen ab (CONFLICT)", async () => {
    await expect(
      callerFor(admin).finance.createProject({
        name: "urlaub 2026",
        color: "#f59e0b",
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Ein Projekt mit diesem Namen existiert bereits.",
    });
  });

  it("nimmt projectId bei createTransaction an und liefert sie in listTransactions", async () => {
    const { id } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 10000,
      userId: admin.id,
      projectId: urlaubId,
      date: "2026-06-01",
      note: "Hotel",
    });
    const txs = await callerFor(member).finance.listTransactions();
    const tx = txs.find(t => t.id === id);
    expect(tx?.projectId).toBe(urlaubId);
    // Buchungen ohne Projekt bleiben Haushaltsbuchungen (projectId null)
    const { id: homeId } = await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId,
      amount: 5000,
      userId: member.id,
      date: "2026-06-02",
      note: "Wocheneinkauf",
    });
    const home = (await callerFor(admin).finance.listTransactions()).find(
      t => t.id === homeId
    );
    expect(home?.projectId).toBeNull();
  });

  it("validiert projectId bei createTransaction (BAD_REQUEST)", async () => {
    await expect(
      callerFor(admin).finance.createTransaction({
        type: "expense",
        accountId,
        amount: 1000,
        userId: admin.id,
        projectId: 99999,
        date: "2026-06-01",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Das angegebene Projekt existiert nicht.",
    });
  });

  it("sperrt das Löschen referenzierter Projekte (CONFLICT mit Anzahl)", async () => {
    await expect(
      callerFor(admin).finance.deleteProject({ id: urlaubId })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Das Projekt wird noch von 1 Buchung verwendet und kann nicht gelöscht werden.",
    });
  });

  it("löscht ungenutzte Projekte", async () => {
    const created = await callerFor(admin).finance.createProject({
      name: "Renovierung",
      color: "#14b8a6",
    });
    await callerFor(admin).finance.deleteProject({ id: created.id });
    const list = await callerFor(admin).finance.listProjects();
    expect(list.map(p => p.name)).not.toContain("Renovierung");
  });
});

describe("Aufteilungsvorlagen", () => {
  let templateId: number;

  it("legt Vorlagen an und listet sie mit geparsten shares", async () => {
    const created = await callerFor(admin).finance.createSplitTemplate({
      name: "60/40 Admin",
      shares: [
        { userId: admin.id, weight: 60 },
        { userId: member.id, weight: 40 },
      ],
    });
    templateId = created.id;
    const list = await callerFor(member).finance.listSplitTemplates();
    const tpl = list.find(t => t.id === templateId);
    expect(tpl?.shares).toEqual([
      { userId: admin.id, weight: 60 },
      { userId: member.id, weight: 40 },
    ]);
  });

  it("validiert: leere shares werden abgelehnt", async () => {
    await expect(
      callerFor(admin).finance.createSplitTemplate({
        name: "Leer",
        shares: [],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validiert: unbekannte userId wird abgelehnt", async () => {
    await expect(
      callerFor(admin).finance.createSplitTemplate({
        name: "Unbekannt",
        shares: [{ userId: 99999, weight: 1 }],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Die Vorlage enthält einen unbekannten Benutzer.",
    });
  });

  it("validiert: Gewichte müssen positiv sein", async () => {
    await expect(
      callerFor(admin).finance.createSplitTemplate({
        name: "Null",
        shares: [{ userId: admin.id, weight: 0 }],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lehnt doppelte Vorlagennamen ab (CONFLICT)", async () => {
    await expect(
      callerFor(admin).finance.createSplitTemplate({
        name: "60/40 admin",
        shares: [{ userId: admin.id, weight: 1 }],
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Eine Vorlage mit diesem Namen existiert bereits.",
    });
  });

  it("löscht Vorlagen", async () => {
    await callerFor(admin).finance.deleteSplitTemplate({ id: templateId });
    const list = await callerFor(admin).finance.listSplitTemplates();
    expect(list.find(t => t.id === templateId)).toBeUndefined();
    await expect(
      callerFor(admin).finance.deleteSplitTemplate({ id: templateId })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Vorlage nicht gefunden.",
    });
  });
});

describe("sharesFromWeights (Gewichts-Mathematik)", () => {
  it("verteilt 60/40 exakt", () => {
    expect(
      sharesFromWeights(10000, [
        { userId: 1, weight: 60 },
        { userId: 2, weight: 40 },
      ])
    ).toEqual([
      { userId: 1, amount: 6000 },
      { userId: 2, amount: 4000 },
    ]);
  });

  it("legt die Restdifferenz auf den ersten Anteil", () => {
    // 100 / 3 → 33.33…; gerundet 3× 33 = 99, Rest 1 Cent auf den Ersten
    const shares = sharesFromWeights(100, [
      { userId: 1, weight: 1 },
      { userId: 2, weight: 1 },
      { userId: 3, weight: 1 },
    ]);
    expect(shares).toEqual([
      { userId: 1, amount: 34 },
      { userId: 2, amount: 33 },
      { userId: 3, amount: 33 },
    ]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(100);
  });

  it("verteilt beliebige Gewichte prozentual", () => {
    const shares = sharesFromWeights(12345, [
      { userId: 1, weight: 70 },
      { userId: 2, weight: 30 },
    ]);
    // 12345 × 0,7 = 8641,5 → 8642; 12345 × 0,3 = 3703,5 → 3704;
    // Summe 12346 → Restdifferenz −1 auf dem ersten Anteil
    expect(shares).toEqual([
      { userId: 1, amount: 8641 },
      { userId: 2, amount: 3704 },
    ]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(12345);
  });

  it("liefert ein leeres Ergebnis bei leeren oder Null-Gewichten", () => {
    expect(sharesFromWeights(1000, [])).toEqual([]);
    expect(sharesFromWeights(1000, [{ userId: 1, weight: 0 }])).toEqual([]);
  });
});
