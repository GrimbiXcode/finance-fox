import { beforeAll, describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { collectReport } from "./lib/report/data";
import { renderReportPdf } from "./lib/report/pdf";
import { renderReportXlsx } from "./lib/report/xlsx";
import { REPORT_SECTIONS, parseReportSections } from "@contracts/report";
import {
  accountOwners,
  accounts,
  categories,
  recurring,
  savingsGoals,
  transactions,
  users,
} from "@db/schema";
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

function ctxFor(user: SessionUser): TrpcContext & { user: SessionUser } {
  return {
    req: new Request("http://localhost/api/export/bericht.pdf"),
    resHeaders: new Headers(),
    user,
  };
}

const allSections = [...REPORT_SECTIONS];

/** Monatsschlüssel um n Monate zurück (YYYY-MM) */
function monthsAgo(n: number): string {
  const d = new Date();
  const shifted = new Date(d.getFullYear(), d.getMonth() - n, 15);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

let sharedId = 0;
let privateId = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [admin, member]) {
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

  // Gemeinschaftskonto (keine Besitzer) — für beide sichtbar
  sharedId = (
    await db
      .insert(accounts)
      .values({
        name: "Gemeinschaftskonto",
        type: "checking",
        initialBalance: 500000,
        createdAt: new Date(),
      })
      .returning({ id: accounts.id })
  )[0].id;

  // Privatkonto des Admin — für das Mitglied unsichtbar
  privateId = (
    await db
      .insert(accounts)
      .values({
        name: "Geheimes Privatkonto",
        type: "savings",
        initialBalance: 900000,
        createdAt: new Date(),
      })
      .returning({ id: accounts.id })
  )[0].id;
  await db
    .insert(accountOwners)
    .values({ accountId: privateId, userId: admin.id });

  const categoryId = (
    await db
      .insert(categories)
      .values({ name: "Wohnen", type: "expense", color: "#f43f5e" })
      .returning({ id: categories.id })
  )[0].id;

  // Buchungen der letzten Monate: Lohn aufs Gemeinschaftskonto, Miete raus
  for (const n of [1, 2, 3]) {
    await db.insert(transactions).values({
      type: "income",
      accountId: sharedId,
      amount: 800000,
      categoryId: null,
      userId: admin.id,
      note: "Lohn",
      date: `${monthsAgo(n)}-05`,
      createdAt: new Date(),
    });
    await db.insert(transactions).values({
      type: "expense",
      accountId: sharedId,
      amount: 250000,
      categoryId,
      userId: admin.id,
      note: "Miete",
      date: `${monthsAgo(n)}-01`,
      createdAt: new Date(),
    });
    // Nur auf dem Privatkonto des Admin — darf beim Mitglied nirgends auftauchen
    await db.insert(transactions).values({
      type: "expense",
      accountId: privateId,
      amount: 111100,
      categoryId,
      userId: admin.id,
      note: "Privat",
      date: `${monthsAgo(n)}-07`,
      createdAt: new Date(),
    });
  }

  await db.insert(recurring).values({
    type: "expense",
    accountId: sharedId,
    amount: 250000,
    categoryId,
    userId: admin.id,
    note: "Miete",
    interval: "monthly",
    nextDate: `${monthsAgo(-1)}-01`,
    active: true,
    createdAt: new Date(),
  });

  const goalId = (
    await db
      .insert(savingsGoals)
      .values({ name: "Eigenheim", targetAmount: 10000000, color: "#0ea5e9" })
      .returning({ id: savingsGoals.id })
  )[0].id;
  // Quelle auf dem privaten Konto des Admin — für das Mitglied verborgen
  await appRouter
    .createCaller(ctxFor(admin))
    .finance.addGoalSource({ goalId, accountId: privateId, mode: "full" });
});

describe("Berichtsdaten", () => {
  it("liefert nur die gewählten Abschnitte", async () => {
    const data = await collectReport(ctxFor(admin), {
      sections: ["accounts"],
      months: 12,
    });
    expect(data.accounts).toBeDefined();
    expect(data.goals).toBeUndefined();
    expect(data.cashflow).toBeUndefined();
    expect(data.sections).toEqual(["accounts"]);
  });

  it("benennt gewählte Abschnitte ohne Daten, statt sie zu verschweigen", async () => {
    const data = await collectReport(ctxFor(admin), {
      sections: ["mortgages", "pension", "insurances"],
      months: 12,
    });
    const reasons = new Map(data.empty.map(e => [e.section, e.reason]));
    expect(reasons.get("mortgages")).toContain("Liegenschaft");
    expect(reasons.get("insurances")).toContain("Policen");
    // Vorsorge ohne Profil ist kein Fehler — der Export darf nicht kippen
    expect(reasons.get("pension")).toContain("Vorsorgeprofil");
    expect(data.pension).toBeUndefined();
  });

  it("zeigt dem Mitglied das private Konto des Admin nirgends", async () => {
    const forAdmin = await collectReport(ctxFor(admin), {
      sections: allSections,
      months: 12,
    });
    const forMember = await collectReport(ctxFor(member), {
      sections: allSections,
      months: 12,
    });

    const adminNames = forAdmin.accounts!.rows.map(r => r.name);
    const memberNames = forMember.accounts!.rows.map(r => r.name);
    expect(adminNames).toContain("Geheimes Privatkonto");
    expect(memberNames).not.toContain("Geheimes Privatkonto");
    expect(forMember.accounts!.total).toBe(500000 - 3 * 250000 + 3 * 800000);

    // Auch die Buchungen des privaten Kontos bleiben draußen
    expect(forAdmin.cashflow!.totals.expense).toBe(3 * (250000 + 111100));
    expect(forMember.cashflow!.totals.expense).toBe(3 * 250000);
  });

  it("weist verborgene Sparziel-Quellen aus, statt still zu wenig zu zeigen", async () => {
    const forAdmin = await collectReport(ctxFor(admin), {
      sections: ["goals"],
      months: 12,
    });
    const forMember = await collectReport(ctxFor(member), {
      sections: ["goals"],
      months: 12,
    });
    expect(forAdmin.goals!.rows[0].hasHiddenSources).toBe(false);
    expect(forAdmin.goals!.rows[0].saved).toBeGreaterThan(0);
    expect(forMember.goals!.rows[0].hasHiddenSources).toBe(true);
    expect(forMember.goals!.rows[0].saved).toBe(0);
  });

  it("rechnet den Cashflow auf zwölf Monate und rollt Kategorien auf", async () => {
    const data = await collectReport(ctxFor(member), {
      sections: ["cashflow"],
      months: 12,
    });
    const cashflow = data.cashflow!;
    expect(cashflow.months).toHaveLength(12);
    expect(cashflow.totals.income).toBe(3 * 800000);
    expect(cashflow.totals.net).toBe(3 * 800000 - 3 * 250000);
    expect(cashflow.average.income).toBe(Math.round((3 * 800000) / 12));
    expect(cashflow.categories).toEqual([{ name: "Wohnen", amount: 750000 }]);
  });

  it("normalisiert Dauerbuchungen auf einen Monatswert", async () => {
    const data = await collectReport(ctxFor(member), {
      sections: ["recurring"],
      months: 12,
    });
    expect(data.recurring!.totals.monthlyExpense).toBe(250000);
    expect(data.recurring!.rows[0].monthly).toBe(250000);
  });
});

/**
 * Eigener Block mit eigenem Setup: Die Tests oben prüfen bewusst den leeren
 * Fall (kein Wohneigentum, kein Vorsorgeprofil), deshalb entstehen diese
 * Daten erst hier.
 */
describe("Hypotheken, Vorsorge und Versicherungen im Bericht", () => {
  beforeAll(async () => {
    const caller = appRouter.createCaller(ctxFor(admin));
    const property = await caller.mortgage.addProperty({
      name: "Wohnhaus",
      address: "Musterstrasse 12",
      marketValue: 110_000_000,
      purchasePrice: 95_000_000,
      householdIncome: 18_000_000,
    });
    await caller.mortgage.addTranche({
      propertyId: property.id,
      name: "Festhypothek",
      principal: 60_000_000,
      interestRateBp: 150,
      startDate: "2024-01-01",
      maturityDate: "2031-03-31",
    });
    await caller.pension.updateProfile({ birthDate: "1985-04-01" });
    await caller.pension.addFund({
      name: "Pensionskasse",
      currentCapital: 12_000_000,
      yearlySavings: 1_200_000,
      interestRateBp: 150,
    });
    await caller.pension.updateAhv({ contributionYears: 40 });
    const policy = await caller.insurance.addPolicy({
      name: "Hausrat & Haftpflicht",
      branch: "hausrat",
      insurer: "Beispiel-Versicherung",
      startDate: "2024-01-01",
      premium: 36_000,
      premiumInterval: "yearly",
    });
    await caller.insurance.addCoverage({
      policyId: policy.id,
      label: "Personenschäden",
      sumInsured: null,
    });
  });

  it("übernimmt Kennzahlen der Liegenschaft aus der Engine", async () => {
    const data = await collectReport(ctxFor(admin), {
      sections: ["mortgages"],
      months: 12,
    });
    const property = data.mortgages!.properties[0];
    expect(property.name).toBe("Wohnhaus");
    expect(property.totalDebt).toBe(60_000_000);
    expect(property.equity).toBe(50_000_000);
    expect(property.ltvBp).toBe(5455); // 60 Mio / 110 Mio
    expect(property.tranches).toHaveLength(1);
    expect(property.affordability.ratioBp).not.toBeNull();
    expect(data.mortgages!.totals.propertyValue).toBe(110_000_000);
  });

  it("liefert die eigene Vorsorge, sobald ein Profil existiert", async () => {
    const data = await collectReport(ctxFor(admin), {
      sections: ["pension"],
      months: 12,
    });
    expect(data.pension!.pillar2.capital).toBeGreaterThan(12_000_000);
    expect(data.pension!.monthlyRetirementIncome).toBeGreaterThan(0);
    expect(data.pension!.funds[0].name).toBe("Pensionskasse");
    expect(data.empty).toHaveLength(0);
  });

  it("bleibt für das Mitglied ohne eigenes Profil leer", async () => {
    const data = await collectReport(ctxFor(member), {
      sections: ["pension", "mortgages"],
      months: 12,
    });
    // Vorsorge privat, Hypotheken haushaltsweit — beides gleichzeitig belegt
    expect(data.pension).toBeUndefined();
    expect(data.mortgages!.properties).toHaveLength(1);
  });

  it("nimmt Deckungen mit und behandelt NULL als unbegrenzt", async () => {
    const data = await collectReport(ctxFor(admin), {
      sections: ["insurances"],
      months: 12,
    });
    const policy = data.insurances!.rows.find(
      r => r.name === "Hausrat & Haftpflicht"
    )!;
    expect(policy.premiumYearly).toBe(36_000);
    expect(policy.persons).toBe("Haushalt");
    expect(policy.coverages).toEqual([
      { label: "Personenschäden", sumInsured: null, note: "" },
    ]);

    const pdf = renderReportPdf(data, "de-DE").toString("latin1");
    expect(pdf).toContain("unbegrenzt");
  });
});

describe("Abschnitts-Parameter", () => {
  it("verwirft Unbekanntes und hält die Katalogreihenfolge ein", () => {
    expect(parseReportSections("goals,unsinn,accounts")).toEqual([
      "accounts",
      "goals",
    ]);
    expect(parseReportSections("accounts,accounts")).toEqual(["accounts"]);
    expect(parseReportSections(null)).toEqual([]);
    expect(parseReportSections("")).toEqual([]);
  });
});

describe("Ausgabeformate", () => {
  it("erzeugt aus denselben Daten ein PDF und eine Excel-Mappe", async () => {
    // Sicht des Mitglieds: hat kein Vorsorgeprofil, der Abschnitt ist leer
    const data = await collectReport(ctxFor(member), {
      sections: allSections,
      months: 12,
    });

    const pdf = renderReportPdf(data, "de-CH").toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("(Finanz\xfcbersicht)"); // Umlaut als WinAnsi-Byte
    expect(pdf).toContain("Gemeinschaftskonto");
    // Leere Abschnitte stehen mit Begründung im Dokument, statt zu fehlen
    expect(pdf).toContain("Vorsorgeprofil");

    const xlsx = renderReportXlsx(data);
    expect(xlsx.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
    const sheet = firstSheet(xlsx);
    expect(sheet).toContain("Gemeinschaftskonto");
  });

  it("legt das Übersichtsblatt als erstes Blatt an", async () => {
    const data = await collectReport(ctxFor(admin), {
      sections: ["accounts"],
      months: 12,
    });
    const workbook = readPart(renderReportXlsx(data), "xl/workbook.xml");
    const names = [...workbook.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
    expect(names[0]).toBe("Übersicht");
    expect(names).toContain("Konten");
  });
});

/* --------------------------- ZIP-Hilfen für Tests -------------------------- */

function readPart(buffer: Buffer, name: string): string {
  const eocd = buffer.length - 22;
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryName = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf-8");
    if (entryName === name) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const extraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + extraLength;
      return inflateRawSync(
        buffer.subarray(start, start + compressedSize)
      ).toString("utf-8");
    }
    offset += 46 + nameLength;
  }
  throw new Error(`Teil ${name} fehlt in der Mappe`);
}

function firstSheet(buffer: Buffer): string {
  return readPart(buffer, "xl/worksheets/sheet2.xml");
}
