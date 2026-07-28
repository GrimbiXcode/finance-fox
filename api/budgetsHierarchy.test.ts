import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { accounts, budgets, transactions, users } from "@db/schema";
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

const pad2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const now = new Date();
const YEAR = now.getFullYear();
/** 1-basierter aktueller Monat; = Anzahl Monate seit Jahresanfang (Anker null) */
const MONTH = now.getMonth() + 1;
const CUR = `${YEAR}-${pad2(MONTH)}-15`; // mitten im laufenden Monat
const PREV = iso(new Date(YEAR, MONTH - 2, 15)); // Vormonat (ggf. Vorjahr)

// Kategorie-IDs (werden in den Tests befüllt)
let wohnenId: number;
let stromId: number;
let gehaltId: number;
let lebensmittelId: number;
let freizeitId: number;
let reisenId: number;
let sparenId: number;

let sharedAccId: number;
let privateAccId: number;

/** Buchung direkt einfügen (Test-Fixture) */
async function insertExpense(
  accountId: number,
  categoryId: number,
  amount: number,
  date: string
) {
  await getDb().insert(transactions).values({
    type: "expense",
    accountId,
    categoryId,
    amount,
    userId: admin.id,
    date,
    note: "",
    createdAt: new Date(),
  });
}

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
  // Gemeinschaftskonto (ownerId null) + privates Konto von admin
  await callerFor(admin).finance.createAccount({
    name: "Gemeinschaft",
    type: "checking",
    initialBalance: 0,
    private: false,
  });
  await callerFor(admin).finance.createAccount({
    name: "Privat",
    type: "checking",
    initialBalance: 0,
    private: true,
  });
  const accs = await getDb().select().from(accounts);
  sharedAccId = accs.find(a => a.name === "Gemeinschaft")!.id;
  privateAccId = accs.find(a => a.name === "Privat")!.id;
});

describe("Kategorien-Hierarchie", () => {
  it("legt Ober- und Unterkategorie an; Unterkategorie erbt die Farbe", async () => {
    await callerFor(admin).finance.createCategory({
      name: "Wohnen",
      type: "expense",
      color: "#3b82f6",
    });
    await callerFor(admin).finance.createCategory({
      name: "Gehalt",
      type: "income",
      color: "#10b981",
    });
    await callerFor(admin).finance.createCategory({
      name: "Lebensmittel",
      type: "expense",
      color: "#f59e0b",
    });
    await callerFor(admin).finance.createCategory({
      name: "Freizeit",
      type: "expense",
      color: "#a855f7",
    });
    await callerFor(admin).finance.createCategory({
      name: "Reisen",
      type: "expense",
      color: "#14b8a6",
    });
    await callerFor(admin).finance.createCategory({
      name: "Sparen",
      type: "expense",
      color: "#f43f5e",
    });
    const cats = await callerFor(member).finance.listCategories();
    const byName = new Map(cats.map(c => [c.name, c]));
    wohnenId = byName.get("Wohnen")!.id;
    gehaltId = byName.get("Gehalt")!.id;
    lebensmittelId = byName.get("Lebensmittel")!.id;
    freizeitId = byName.get("Freizeit")!.id;
    reisenId = byName.get("Reisen")!.id;
    sparenId = byName.get("Sparen")!.id;

    // Farbe des Requests wird ignoriert — die Oberkategorie bestimmt sie
    await callerFor(admin).finance.createCategory({
      name: "Strom",
      type: "expense",
      color: "#000000",
      parentId: wohnenId,
    });
    const after = await callerFor(member).finance.listCategories();
    const strom = after.find(c => c.name === "Strom")!;
    stromId = strom.id;
    expect(strom.parentId).toBe(wohnenId);
    expect(strom.color).toBe("#3b82f6");
  });

  it("validiert: keine zweite Ebene, Typ muss passen, Elter muss existieren", async () => {
    // Unterkategorie als Elter → abgelehnt (nur eine Hierarchieebene)
    await expect(
      callerFor(admin).finance.createCategory({
        name: "Strommix",
        type: "expense",
        color: "#000000",
        parentId: stromId,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Unterkategorien können keine weiteren Unterkategorien haben.",
    });
    // Typ der Oberkategorie ≠ Typ der neuen Kategorie
    await expect(
      callerFor(admin).finance.createCategory({
        name: "Bonus",
        type: "expense",
        color: "#000000",
        parentId: gehaltId,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Die Unterkategorie muss denselben Typ wie die Oberkategorie haben.",
    });
    // Unbekannte Oberkategorie
    await expect(
      callerFor(admin).finance.createCategory({
        name: "Nirgendwo",
        type: "expense",
        color: "#000000",
        parentId: 99999,
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Oberkategorie nicht gefunden.",
    });
  });

  it("sperrt das Löschen von Oberkategorien mit Kindern (CONFLICT mit Anzahl)", async () => {
    await expect(
      callerFor(admin).finance.deleteCategory({ id: wohnenId })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Die Kategorie hat noch 1 Unterkategorie und kann nicht gelöscht werden.",
    });

    await callerFor(admin).finance.createCategory({
      name: "Wasser",
      type: "expense",
      color: "#000000",
      parentId: wohnenId,
    });
    await expect(
      callerFor(admin).finance.deleteCategory({ id: wohnenId })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Die Kategorie hat noch 2 Unterkategorien und kann nicht gelöscht werden.",
    });
  });

  it("löscht Unterkategorien wie bisher (Buchungen → null, Budget weg)", async () => {
    const cats = await callerFor(member).finance.listCategories();
    const wasserId = cats.find(c => c.name === "Wasser")!.id;
    await callerFor(admin).finance.setBudget({
      categoryId: wasserId,
      amount: 5000,
      period: "monthly",
      rollover: false,
    });
    await insertExpense(sharedAccId, wasserId, 1234, CUR);

    await callerFor(admin).finance.deleteCategory({ id: wasserId });

    const tx = (
      await getDb()
        .select()
        .from(transactions)
        .where(eq(transactions.amount, 1234))
    )[0];
    expect(tx.categoryId).toBeNull();
    expect(
      await getDb().query.budgets.findFirst({
        where: eq(budgets.categoryId, wasserId),
      })
    ).toBeUndefined();
    // Oberkategorie ohne weitere Kinder ist wieder nicht lösbar (Strom bleibt)
    await expect(
      callerFor(admin).finance.deleteCategory({ id: wohnenId })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("Budget-Auswertung (listBudgetStatus)", () => {
  beforeAll(async () => {
    // Budgets: teils über die API (createdAt = jetzt), teils als
    // Bestandsbudget mit createdAt NULL direkt in die DB
    await callerFor(admin).finance.setBudget({
      categoryId: wohnenId,
      amount: 20000,
      period: "monthly",
      rollover: false,
    });
    await callerFor(admin).finance.setBudget({
      categoryId: lebensmittelId,
      amount: 120000,
      period: "yearly",
      rollover: false,
    });
    await callerFor(admin).finance.setBudget({
      categoryId: freizeitId,
      amount: 10000,
      period: "monthly",
      rollover: true,
    });
    await getDb().insert(budgets).values({
      categoryId: reisenId,
      amount: 10000,
      period: "monthly",
      rollover: true,
      createdAt: null,
    });
    await getDb().insert(budgets).values({
      categoryId: sparenId,
      amount: 10000,
      period: "monthly",
      rollover: true,
      createdAt: null,
    });

    // Wohnen (Rollup): Oberkategorie + Unterkategorie im laufenden Monat,
    // dazu ein Vormonat-Wert (darf im Monatsbudget nicht zählen) und eine
    // Buchung auf dem privaten Konto von admin (für member unsichtbar)
    await insertExpense(sharedAccId, wohnenId, 10000, CUR);
    await insertExpense(sharedAccId, stromId, 5000, CUR);
    await insertExpense(sharedAccId, stromId, 7000, PREV);
    await insertExpense(privateAccId, stromId, 3000, CUR);

    // Lebensmittel (Jahresbudget): Januar + laufender Monat zählen,
    // Vorjahr nicht
    await insertExpense(sharedAccId, lebensmittelId, 20000, `${YEAR}-01-15`);
    await insertExpense(sharedAccId, lebensmittelId, 30000, CUR);
    await insertExpense(
      sharedAccId,
      lebensmittelId,
      99999,
      `${YEAR - 1}-06-15`
    );

    // Freizeit (Rollover, createdAt = jetzt): Vormonat-Ausgabe darf wegen
    // Anker im aktuellen Monat nicht ins effektive Limit einfließen
    await insertExpense(sharedAccId, freizeitId, 4000, PREV);

    // Reisen (Rollover, createdAt NULL → Anker 1. Januar): Januar-Ausgabe
    // reduziert das effektive Limit
    await insertExpense(sharedAccId, reisenId, 6000, `${YEAR}-01-05`);

    // Sparen (Rollover, createdAt NULL): riesige Januar-Ausgabe → Limit
    // läuft gegen die Untergrenze 0
    await insertExpense(sharedAccId, sparenId, 500000, `${YEAR}-01-06`);
  });

  const statusOf = async (user: SessionUser, categoryId: number) => {
    const list = await callerFor(user).finance.listBudgetStatus();
    const s = list.find(x => x.budget.categoryId === categoryId);
    expect(s).toBeDefined();
    return s!;
  };

  it("rollt Ausgaben der Unterkategorien auf die Budget-Kategorie auf", async () => {
    const s = await statusOf(member, wohnenId);
    // 10000 (Wohnen) + 5000 (Strom) — Vormonat (7000) zählt nicht
    expect(s.spent).toBe(15000);
    expect(s.effectiveLimit).toBe(20000);
    expect(s.remaining).toBe(5000);
    expect(s.percent).toBe(75);
  });

  it("beachtet den Sichtbarkeitsfilter (privates Konto nur für Besitzer)", async () => {
    const sMember = await statusOf(member, wohnenId);
    const sAdmin = await statusOf(admin, wohnenId);
    expect(sMember.spent).toBe(15000);
    // admin ist Besitzer des privaten Kontos → +3000 aus Strom-Buchung
    expect(sAdmin.spent).toBe(18000);
  });

  it("wertet Jahresbudgets über das Kalenderjahr aus", async () => {
    const s = await statusOf(member, lebensmittelId);
    // 20000 (Januar) + 30000 (laufender Monat), Vorjahr (99999) nicht
    expect(s.spent).toBe(50000);
    expect(s.effectiveLimit).toBe(120000);
    expect(s.budget.period).toBe("yearly");
  });

  it("Rollover mit createdAt-Anker: Vormonate vor dem Anker zählen nicht", async () => {
    const s = await statusOf(member, freizeitId);
    // Anker = createdAt-Monat (aktueller Monat) → 1 Monat × 10000,
    // Vormonat-Ausgabe (4000) liegt vor dem Anker
    expect(s.effectiveLimit).toBe(10000);
    expect(s.spent).toBe(0);
    expect(s.remaining).toBe(10000);
  });

  it("Rollover mit createdAt NULL: Anker am Jahresanfang", async () => {
    const s = await statusOf(member, reisenId);
    // MONTH Monate × 10000 minus Januar-Ausgabe (6000), falls schon
    // mindestens ein Monat vergangen ist
    const expected = Math.max(0, 10000 * MONTH - (MONTH > 1 ? 6000 : 0));
    expect(s.effectiveLimit).toBe(expected);
    expect(s.spent).toBe(0);
    expect(s.remaining).toBe(expected);
  });

  it("Rollover ist nach unten bei 0 begrenzt", async () => {
    const s = await statusOf(member, sparenId);
    // Januar-Ausgabe (500000) übersteigt jedes aufsummierte Monatsbudget
    if (MONTH > 1) {
      expect(s.effectiveLimit).toBe(0);
      expect(s.percent).toBe(0);
      expect(s.remaining).toBe(0);
    } else {
      // Im Januar gibt es noch keine abgelaufenen Monate seit dem Anker
      expect(s.effectiveLimit).toBe(10000);
    }
  });

  it("budgetForecast nutzt dieselbe Auswertung (gleiche Werte)", async () => {
    const [statuses, forecast] = await Promise.all([
      callerFor(member).finance.listBudgetStatus(),
      callerFor(member).forecast.budgetForecast(),
    ]);
    expect(forecast).toHaveLength(statuses.length);
    for (const f of forecast) {
      const s = statuses.find(x => x.budget.categoryId === f.categoryId)!;
      expect(f.spent).toBe(s.spent);
      expect(f.budget).toBe(s.effectiveLimit);
      expect(f.period).toBe(s.budget.period);
      expect(f.willExceed).toBe(f.projected > s.effectiveLimit);
    }
  });
});

describe("setBudget (period/rollover)", () => {
  it("speichert period/rollover und behält createdAt beim Aktualisieren", async () => {
    const before = await getDb().query.budgets.findFirst({
      where: eq(budgets.categoryId, wohnenId),
    });
    expect(before).toMatchObject({ period: "monthly", rollover: false });

    await callerFor(admin).finance.setBudget({
      categoryId: wohnenId,
      amount: 25000,
      period: "yearly",
      rollover: true,
    });
    const after = await getDb().query.budgets.findFirst({
      where: eq(budgets.categoryId, wohnenId),
    });
    expect(after).toMatchObject({
      amount: 25000,
      period: "yearly",
      rollover: true,
    });
    // Anker bleibt erhalten (Update ändert createdAt nicht)
    expect(after!.createdAt?.getTime()).toBe(before!.createdAt?.getTime());

    // Zurückstellen, damit andere Tests nichts erben (Suite läuft sequenziell)
    await callerFor(admin).finance.setBudget({
      categoryId: wohnenId,
      amount: 20000,
      period: "monthly",
      rollover: false,
    });
  });
});
