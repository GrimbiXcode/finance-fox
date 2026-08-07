import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { pensionAhvYears, users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const anna: SessionUser = {
  id: 1,
  email: "anna@example.com",
  name: "Anna",
  role: "admin",
  color: "#10b981",
};
const bruno: SessionUser = {
  id: 2,
  email: "bruno@example.com",
  name: "Bruno",
  role: "member",
  color: "#6366f1",
};
/** Dritte Person, die niemandem zugeordnet ist */
const carla: SessionUser = {
  id: 3,
  email: "carla@example.com",
  name: "Carla",
  role: "member",
  color: "#f59e0b",
};

function callerFor(user: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

/** Jahreszeilen mit gleichem Einkommen erfassen */
async function fillYears(
  user: SessionUser,
  from: number,
  to: number,
  incomePerYear: number
) {
  const caller = callerFor(user);
  for (let year = from; year <= to; year++) {
    await caller.pension.upsertAhvYear({ year, income: incomePerYear });
  }
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [anna, bruno, carla]) {
    await db.insert(users).values({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      active: true,
      createdAt: new Date(),
    });
  }
  // Beide Ehepartner mit identischen Eckdaten, damit die Plafonierung
  // rechnerisch eindeutig ist
  await callerFor(anna).pension.updateProfile({ birthDate: "1965-03-10" });
  await callerFor(bruno).pension.updateProfile({ birthDate: "1965-07-20" });
  await callerFor(carla).pension.updateProfile({ birthDate: "1970-01-05" });
  await callerFor(anna).pension.updateAhv({
    gender: "female",
    firstIkYear: 1986,
  });
  await callerFor(bruno).pension.updateAhv({
    gender: "male",
    firstIkYear: 1986,
  });
});

describe("Beitragsdauer: Jahreszeilen", () => {
  it("legt Jahre an, ändert sie und hält ein Jahr nur einmal", async () => {
    const caller = callerFor(carla);
    await caller.pension.upsertAhvYear({ year: 2000, income: 5_000_000 });
    await caller.pension.upsertAhvYear({ year: 2000, income: 6_000_000 });
    const rows = await caller.pension.listAhvYears();
    const year2000 = rows.filter(r => r.year === 2000);
    expect(year2000).toHaveLength(1);
    expect(year2000[0].income).toBe(6_000_000);
  });

  it("löscht ein Jahr und meldet Unbekanntes als NOT_FOUND", async () => {
    const caller = callerFor(carla);
    await caller.pension.upsertAhvYear({ year: 1999, income: 100 });
    await caller.pension.deleteAhvYear({ year: 1999 });
    expect(
      (await caller.pension.listAhvYears()).some(r => r.year === 1999)
    ).toBe(false);
    await expect(
      caller.pension.deleteAhvYear({ year: 1975 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hält die Jahre zweier Personen strikt getrennt", async () => {
    await callerFor(anna).pension.upsertAhvYear({
      year: 1995,
      income: 9_999_900,
    });
    const brunoRows = await callerFor(bruno).pension.listAhvYears();
    expect(brunoRows.some(r => r.year === 1995 && r.income === 9_999_900)).toBe(
      false
    );
    // Gegenprobe direkt auf der Tabelle: die Zeile gehört Anna
    const db = getDb();
    const stored = await db
      .select()
      .from(pensionAhvYears)
      .where(eq(pensionAhvYears.income, 9_999_900));
    expect(stored).toHaveLength(1);
    expect(stored[0].userId).toBe(anna.id);
  });

  it("schreibt Anlegen und Ändern in die Modul-Historie", async () => {
    const caller = callerFor(carla);
    await caller.pension.upsertAhvYear({ year: 2010, income: 4_000_000 });
    await caller.pension.upsertAhvYear({ year: 2010, income: 4_500_000 });
    const { entries } = await caller.pension.listChanges({ entity: "ahv" });
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // Die jüngste Änderung ist das geänderte Einkommen des Jahres 2010
    expect(entries[0].changes.some(c => c.field === "Erwerbseinkommen")).toBe(
      true
    );
  });
});

describe("Rentenberechnung über den Router", () => {
  it("verlangt ein Vorsorgeprofil", async () => {
    const db = getDb();
    await db.insert(users).values({
      id: 9,
      email: "ohne@example.com",
      name: "Ohne Profil",
      role: "member",
      color: "#888888",
      active: true,
      createdAt: new Date(),
    });
    await expect(
      callerFor({ ...carla, id: 9, name: "Ohne Profil" }).pension.ahvDetail()
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("liefert die Aufschlüsselung und die Bezugsvarianten", async () => {
    await fillYears(carla, 1991, 2034, 8_000_000);
    const caller = callerFor(carla);
    const detail = await caller.pension.ahvDetail();
    expect(detail.duration.scale).toBe(44);
    expect(detail.income.relevantIncome).toBeGreaterThan(0);
    expect(detail.monthlyPension).toBeGreaterThan(0);

    const variants = await caller.pension.ahvVariants();
    expect(variants.length).toBeGreaterThan(3);
    expect(variants.find(v => v.key === "reference")!.monthlyPension).toBe(
      detail.monthlyPension
    );
  });

  it("nimmt einen Was-wäre-wenn-Vorbezug entgegen, ohne ihn zu speichern", async () => {
    const caller = callerFor(carla);
    const normal = await caller.pension.ahvDetail();
    const early = await caller.pension.ahvDetail({
      withdrawalMode: "early",
      withdrawalMonths: 12,
      withdrawalSharePct: 100,
    });
    expect(early.monthlyPension).toBeLessThan(normal.monthlyPension);
    expect(early.withdrawalAdjustmentBp).toBe(-680);
    // Der gespeicherte Plan bleibt unverändert
    expect((await caller.pension.ahvDetail()).monthlyPension).toBe(
      normal.monthlyPension
    );
  });
});

describe("Ehepartner-Verknüpfung", () => {
  it("bleibt einseitig gesetzt wirkungslos", async () => {
    await fillYears(anna, 1986, 2029, 9_000_000);
    await fillYears(bruno, 1986, 2029, 9_000_000);

    // Anna verweist auf Bruno — Bruno hat noch nicht zurückverwiesen
    await callerFor(anna).pension.setPartner({ partnerUserId: bruno.id });
    const annaDetail = await callerFor(anna).pension.ahvDetail();
    expect(annaDetail.partnerLinked).toBe(false);
    expect(annaDetail.partnerPending).toBe(true);
    // Keine Plafonierung, obwohl beide zusammen darüber lägen
    expect(annaDetail.warnings.some(w => w.kind === "cappedByCouple")).toBe(
      false
    );
    expect(annaDetail.monthlyPension).toBe(annaDetail.adjustedPensionMonthly);

    // Und Bruno sieht davon ohnehin nichts
    const brunoDetail = await callerFor(bruno).pension.ahvDetail();
    expect(brunoDetail.partnerLinked).toBe(false);
    expect(brunoDetail.partnerPending).toBe(false);
  });

  it("plafoniert erst, wenn beide Seiten verknüpft sind", async () => {
    await callerFor(bruno).pension.setPartner({ partnerUserId: anna.id });

    const annaDetail = await callerFor(anna).pension.ahvDetail();
    const brunoDetail = await callerFor(bruno).pension.ahvDetail();
    expect(annaDetail.partnerLinked).toBe(true);
    expect(brunoDetail.partnerLinked).toBe(true);

    // Zusammen höchstens 150 % der Maximalrente (CHF 3'780)
    expect(
      annaDetail.monthlyPension + brunoDetail.monthlyPension
    ).toBeLessThanOrEqual(378_000);
    expect(annaDetail.warnings).toContainEqual(
      expect.objectContaining({ kind: "cappedByCouple" })
    );
  });

  it("löst die Verknüpfung und rechnet wieder ohne Plafonierung", async () => {
    await callerFor(bruno).pension.setPartner({ partnerUserId: null });
    const annaDetail = await callerFor(anna).pension.ahvDetail();
    expect(annaDetail.partnerLinked).toBe(false);
    expect(annaDetail.monthlyPension).toBe(annaDetail.adjustedPensionMonthly);
  });

  it("lehnt Selbstverknüpfung und unbekannte Personen ab", async () => {
    await expect(
      callerFor(anna).pension.setPartner({ partnerUserId: anna.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerFor(anna).pension.setPartner({ partnerUserId: 4242 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hält Verknüpfen und Lösen im Audit-Log fest", async () => {
    const entries = await callerFor(anna).finance.listAuditLog({
      entity: "pension",
    });
    const actions = entries.map(e => e.action);
    expect(actions).toContain("pension.partner.linked");
    expect(actions).toContain("pension.partner.unlinked");
  });
});

describe("AHV in der Gesamtprognose", () => {
  it("bevorzugt die amtliche Vorausberechnung vor der eigenen Rechnung", async () => {
    const caller = callerFor(carla);
    const computed = (await caller.pension.forecast()).ahv;
    expect(computed.estimated).toBe(true);

    await caller.pension.updateAhv({ expectedMonthlyPension: 210_000 });
    const official = (await caller.pension.forecast()).ahv;
    expect(official).toEqual({ monthlyPension: 210_000, estimated: false });

    // Zurücksetzen: wieder aus den Jahreszeilen gerechnet
    await caller.pension.updateAhv({ expectedMonthlyPension: null });
    expect((await caller.pension.forecast()).ahv).toEqual(computed);
  });
});
