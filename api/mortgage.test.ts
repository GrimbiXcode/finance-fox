import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { mortgageAmortizations, mortgageTranches, users } from "@db/schema";
import { notifyMaturities } from "./lib/mortgage/maturityNotice";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Hypotheken-Modul: CRUD, Kaskaden, Kontorechte und Historie.
 * Anders als die Vorsorge ist das Modul haushaltsweit — ein zweites
 * Mitglied muss dieselben Liegenschaften sehen.
 */

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

let sharedAccountId = 0;
let adminPrivateAccountId = 0;

/** Liegenschaft mit Standardwerten anlegen und die ID liefern */
async function newProperty(over: Record<string, unknown> = {}): Promise<number> {
  const res = await callerFor(admin).mortgage.addProperty({
    name: `Objekt ${Math.random().toString(36).slice(2, 8)}`,
    marketValue: 100_000_000,
    householdIncome: 18_000_000,
    ...over,
  });
  return res.id;
}

async function newTranche(
  propertyId: number,
  over: Record<string, unknown> = {}
): Promise<number> {
  const res = await callerFor(admin).mortgage.addTranche({
    propertyId,
    name: "Festhypothek",
    principal: 60_000_000,
    interestRateBp: 150,
    startDate: "2024-01-01",
    maturityDate: "2031-03-31",
    ...over,
  });
  return res.id;
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  await db.insert(users).values(
    [admin, member].map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      createdAt: new Date(),
    }))
  );
  await callerFor(admin).finance.createAccount({
    name: "Gemeinschaftskonto",
    type: "savings",
    initialBalance: 5_000_000,
    private: false,
  });
  await callerFor(admin).finance.createAccount({
    name: "Admin-Privat",
    type: "savings",
    initialBalance: 1_000_000,
    private: true,
  });
  const accs = await callerFor(admin).finance.listAccounts();
  sharedAccountId = accs.find(a => a.name === "Gemeinschaftskonto")!.id;
  adminPrivateAccountId = accs.find(a => a.name === "Admin-Privat")!.id;
});

describe("Liegenschaften", () => {
  it("legt eine Liegenschaft an und liefert abgeleitete Kennzahlen", async () => {
    const id = await newProperty({ name: "Haus Bern", marketValue: 80_000_000 });
    await newTranche(id, { principal: 40_000_000 });

    const list = await callerFor(admin).mortgage.listProperties();
    const row = list.find(p => p.id === id)!;
    expect(row.name).toBe("Haus Bern");
    expect(row.totalDebt).toBe(40_000_000);
    expect(row.ltvBp).toBe(5000); // 400'000 / 800'000 = 50 %
    expect(row.trancheCount).toBe(1);
    // Defaults der Bank-Parameter
    expect(row.firstMortgageLimitBp).toBe(6667);
    expect(row.calcInterestRateBp).toBe(500);
  });

  it("ist haushaltsweit sichtbar — auch für andere Mitglieder", async () => {
    const id = await newProperty({ name: "Gemeinsames Haus" });
    const list = await callerFor(member).mortgage.listProperties();
    expect(list.some(p => p.id === id)).toBe(true);
  });

  it("verlangt eine Anmeldung", async () => {
    await expect(
      callerFor(undefined).mortgage.listProperties()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("ändert Werte und schreibt einen Verlaufseintrag", async () => {
    const id = await newProperty({ name: "Vorher", marketValue: 50_000_000 });
    await callerFor(admin).mortgage.updateProperty({
      id,
      name: "Nachher",
      marketValue: 60_000_000,
      comment: "Neue Schätzung",
    });

    const list = await callerFor(admin).mortgage.listProperties();
    expect(list.find(p => p.id === id)!.name).toBe("Nachher");

    const changes = await callerFor(admin).mortgage.listChanges({
      entity: "property",
    });
    const entry = changes.entries.find(
      e => e.entityId === id && e.comment === "Neue Schätzung"
    )!;
    expect(entry.userName).toBe("Admin");
    expect(entry.changes).toEqual(
      expect.arrayContaining([
        { field: "Name", from: "Vorher", to: "Nachher" },
        { field: "Verkehrswert", from: 50_000_000, to: 60_000_000 },
      ])
    );
  });

  it("schreibt ohne echte Änderung keinen Eintrag", async () => {
    const id = await newProperty({ name: "Unverändert" });
    const before = await callerFor(admin).mortgage.listChanges({});
    await callerFor(admin).mortgage.updateProperty({
      id,
      name: "Unverändert",
      comment: "nur ein Kommentar",
    });
    const after = await callerFor(admin).mortgage.listChanges({});
    expect(after.total).toBe(before.total);
  });

  it("löscht kaskadierend Tranchen und Amortisationen", async () => {
    const id = await newProperty();
    const trancheId = await newTranche(id);
    await callerFor(admin).mortgage.addAmortization({
      propertyId: id,
      trancheId,
      kind: "direct",
      amount: 500_000,
      startDate: "2026-01-01",
    });

    await callerFor(admin).mortgage.deleteProperty({ id });

    const db = getDb();
    expect(
      await db
        .select()
        .from(mortgageTranches)
        .where(eq(mortgageTranches.propertyId, id))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(mortgageAmortizations)
        .where(eq(mortgageAmortizations.propertyId, id))
    ).toHaveLength(0);
  });

  it("meldet eine unbekannte Liegenschaft als NOT_FOUND", async () => {
    await expect(
      callerFor(admin).mortgage.updateProperty({ id: 999999, name: "X" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Tranchen", () => {
  it("rechnet den effektiven Satz inklusive SARON-Marge", async () => {
    const propertyId = await newProperty();
    await newTranche(propertyId, {
      name: "SARON",
      kind: "saron",
      interestRateBp: 50,
      marginBp: 80,
      principal: 30_000_000,
      maturityDate: null,
    });

    const list = await callerFor(admin).mortgage.listTranches({ propertyId });
    const saron = list.find(t => t.name === "SARON")!;
    expect(saron.effectiveRateBp).toBe(130);
    expect(saron.yearlyInterest).toBe(390_000); // 300'000 × 1,30 %
    expect(saron.interestRecurringId).toBeNull();
  });

  it("löscht die direkten Amortisationen der Tranche mit", async () => {
    const propertyId = await newProperty();
    const trancheId = await newTranche(propertyId);
    await callerFor(admin).mortgage.addAmortization({
      propertyId,
      trancheId,
      kind: "direct",
      amount: 250_000,
      startDate: "2026-01-01",
    });

    await callerFor(admin).mortgage.deleteTranche({ id: trancheId });

    const rest = await callerFor(admin).mortgage.listAmortizations({
      propertyId,
    });
    expect(rest).toHaveLength(0);
  });

  it("weist einen leeren Namen ab", async () => {
    const propertyId = await newProperty();
    await expect(
      newTranche(propertyId, { name: "   " })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("Amortisationen", () => {
  it("verlangt bei direkter Amortisation eine Tranche", async () => {
    const propertyId = await newProperty();
    await expect(
      callerFor(admin).mortgage.addAmortization({
        propertyId,
        kind: "direct",
        amount: 100_000,
        startDate: "2026-01-01",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lehnt eine Tranche einer fremden Liegenschaft ab", async () => {
    const a = await newProperty();
    const b = await newProperty();
    const trancheOfB = await newTranche(b);
    await expect(
      callerFor(admin).mortgage.addAmortization({
        propertyId: a,
        trancheId: trancheOfB,
        kind: "direct",
        amount: 100_000,
        startDate: "2026-01-01",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("erlaubt indirekte Amortisation ohne Tranche, mit Zielkonto", async () => {
    const propertyId = await newProperty();
    const res = await callerFor(admin).mortgage.addAmortization({
      propertyId,
      kind: "indirect",
      amount: 708_800,
      accountId: sharedAccountId,
      startDate: "2026-01-01",
    });
    const list = await callerFor(admin).mortgage.listAmortizations({
      propertyId,
    });
    const row = list.find(a => a.id === res.id)!;
    expect(row.trancheId).toBeNull();
    expect(row.accountId).toBe(sharedAccountId);
  });

  it("prüft die Konto-Rechte des Zielkontos serverseitig", async () => {
    const propertyId = await newProperty();
    // Das Modul ist haushaltsweit, die Konten sind es nicht: Ein Mitglied
    // ohne Freigabe darf das Privatkonto des Admins nicht verknüpfen.
    // (NOT_FOUND statt FORBIDDEN, damit private Konten nicht leaken.)
    await expect(
      callerFor(member).mortgage.addAmortization({
        propertyId,
        kind: "indirect",
        amount: 100_000,
        accountId: adminPrivateAccountId,
        startDate: "2026-01-01",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lässt Admins auf private Konten verweisen (sie haben Leserecht)", async () => {
    const propertyId = await newProperty();
    await expect(
      callerFor(admin).mortgage.addAmortization({
        propertyId,
        kind: "indirect",
        amount: 100_000,
        accountId: adminPrivateAccountId,
        startDate: "2026-01-01",
      })
    ).resolves.toMatchObject({ id: expect.any(Number) });
  });

  it("weist ein Enddatum vor dem Beginn ab", async () => {
    const propertyId = await newProperty();
    const trancheId = await newTranche(propertyId);
    await expect(
      callerFor(admin).mortgage.addAmortization({
        propertyId,
        trancheId,
        kind: "direct",
        amount: 100_000,
        startDate: "2026-06-01",
        endDate: "2026-01-01",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("Berechnung über den Router", () => {
  it("liefert die Prognose zur Liegenschaft", async () => {
    const propertyId = await newProperty({
      name: "Prognose",
      marketValue: 100_000_000,
      householdIncome: 18_000_000,
    });
    await newTranche(propertyId, { principal: 60_000_000, interestRateBp: 150 });

    const r = await callerFor(admin).mortgage.forecast({
      propertyId,
      months: 12,
    });
    expect(r.totals.debt).toBe(60_000_000);
    expect(r.totals.yearlyInterest).toBe(900_000);
    expect(r.ltv.bp).toBe(6000);
    expect(r.monthlyDebt).toHaveLength(13);
  });

  it("wirft für eine Liegenschaft ohne Ländermodell", async () => {
    const propertyId = await newProperty({ country: "DE" });
    await expect(
      callerFor(admin).mortgage.forecast({ propertyId })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("summiert die Haushaltssicht fürs Dashboard", async () => {
    const summary = await callerFor(member).mortgage.summary();
    expect(summary.count).toBeGreaterThan(0);
    expect(summary.equity).toBe(summary.propertyValue - summary.totalDebt);
    // Noch keine Dauerbuchung übernommen → alle Posten fehlen
    expect(summary.missingRecurringCount).toBeGreaterThan(0);
  });
});

describe("Übernahme als Dauerbuchung", () => {
  it("legt den Quartalszins als wiederkehrende Ausgabe an", async () => {
    const propertyId = await newProperty();
    const trancheId = await newTranche(propertyId, {
      name: "Fest 5J",
      principal: 60_000_000,
      interestRateBp: 150,
      paymentInterval: "quarterly",
    });

    const res = await callerFor(admin).mortgage.transferInterestToRecurring({
      trancheId,
      accountId: sharedAccountId,
    });
    // 600'000 × 1,50 % = 9'000 pro Jahr → 2'250 pro Quartal
    expect(res.amount).toBe(225_000);
    expect(res.interval).toBe("quarterly");

    const recs = await callerFor(admin).finance.listRecurring();
    const rec = recs.find(r => r.id === res.id)!;
    expect(rec.type).toBe("expense");
    expect(rec.note).toBe("Hypothekarzins „Fest 5J“");
    expect(rec.interval).toBe("quarterly");

    // Der Rückverweis ist gesetzt und wird beim Lesen aufgelöst
    const tranches = await callerFor(admin).mortgage.listTranches({
      propertyId,
    });
    expect(tranches.find(t => t.id === trancheId)!.interestRecurringId).toBe(
      res.id
    );
  });

  it("lehnt einen zweiten Klick ab (Idempotenz)", async () => {
    const propertyId = await newProperty();
    const trancheId = await newTranche(propertyId);
    await callerFor(admin).mortgage.transferInterestToRecurring({
      trancheId,
      accountId: sharedAccountId,
    });
    await expect(
      callerFor(admin).mortgage.transferInterestToRecurring({
        trancheId,
        accountId: sharedAccountId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("erlaubt eine neue Übernahme, wenn die Dauerbuchung gelöscht wurde", async () => {
    const propertyId = await newProperty();
    const trancheId = await newTranche(propertyId);
    const first = await callerFor(admin).mortgage.transferInterestToRecurring({
      trancheId,
      accountId: sharedAccountId,
    });

    await callerFor(admin).finance.deleteRecurring({ id: first.id });

    // Rückverweis ist aufgeräumt …
    const tranches = await callerFor(admin).mortgage.listTranches({
      propertyId,
    });
    expect(
      tranches.find(t => t.id === trancheId)!.interestRecurringId
    ).toBeNull();

    // … und eine neue Übernahme geht wieder
    const second = await callerFor(admin).mortgage.transferInterestToRecurring({
      trancheId,
      accountId: sharedAccountId,
    });
    expect(second.id).not.toBe(first.id);
  });

  it("bucht die indirekte Amortisation als Umbuchung aufs Zielkonto", async () => {
    const propertyId = await newProperty();
    const amort = await callerFor(admin).mortgage.addAmortization({
      propertyId,
      kind: "indirect",
      amount: 708_800,
      accountId: adminPrivateAccountId,
      startDate: "2026-01-01",
    });

    const res = await callerFor(
      admin
    ).mortgage.transferAmortizationToRecurring({
      amortizationId: amort.id,
      accountId: sharedAccountId,
    });

    const recs = await callerFor(admin).finance.listRecurring();
    const rec = recs.find(r => r.id === res.id)!;
    expect(rec.type).toBe("transfer");
    expect(rec.accountId).toBe(sharedAccountId);
    expect(rec.toAccountId).toBe(adminPrivateAccountId);
    expect(rec.note).toBe("Amortisation (indirekt)");
  });

  it("bucht die direkte Amortisation als Ausgabe", async () => {
    const propertyId = await newProperty();
    const trancheId = await newTranche(propertyId, { name: "Tranche B" });
    const amort = await callerFor(admin).mortgage.addAmortization({
      propertyId,
      trancheId,
      kind: "direct",
      amount: 500_000,
      startDate: "2026-01-01",
    });

    const res = await callerFor(
      admin
    ).mortgage.transferAmortizationToRecurring({
      amortizationId: amort.id,
      accountId: sharedAccountId,
    });

    const recs = await callerFor(admin).finance.listRecurring();
    const rec = recs.find(r => r.id === res.id)!;
    expect(rec.type).toBe("expense");
    expect(rec.note).toBe("Amortisation „Tranche B“ (direkt)");
    expect(rec.toAccountId).toBeNull();
  });

  it("verlangt bei indirekter Amortisation ein Zielkonto", async () => {
    const propertyId = await newProperty();
    const amort = await callerFor(admin).mortgage.addAmortization({
      propertyId,
      kind: "indirect",
      amount: 100_000,
      startDate: "2026-01-01",
    });
    await expect(
      callerFor(admin).mortgage.transferAmortizationToRecurring({
        amortizationId: amort.id,
        accountId: sharedAccountId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lehnt identisches Quell- und Zielkonto ab", async () => {
    const propertyId = await newProperty();
    const amort = await callerFor(admin).mortgage.addAmortization({
      propertyId,
      kind: "indirect",
      amount: 100_000,
      accountId: sharedAccountId,
      startDate: "2026-01-01",
    });
    await expect(
      callerFor(admin).mortgage.transferAmortizationToRecurring({
        amortizationId: amort.id,
        accountId: sharedAccountId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("weist eine Tranche ohne Zinsbetrag ab", async () => {
    const propertyId = await newProperty();
    const trancheId = await newTranche(propertyId, {
      principal: 0,
      interestRateBp: 0,
    });
    await expect(
      callerFor(admin).mortgage.transferInterestToRecurring({
        trancheId,
        accountId: sharedAccountId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("Erinnerung an ablaufende Zinsbindungen", () => {
  it("meldet je Schwelle genau einmal", async () => {
    const propertyId = await newProperty();
    // Ablauf in 25 Tagen → nur die 30-Tage-Schwelle greift
    const soon = new Date();
    soon.setDate(soon.getDate() + 25);
    const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
    await newTranche(propertyId, { name: "Bald fällig", maturityDate: iso });

    const db = getDb();
    expect(await notifyMaturities(db)).toBeGreaterThanOrEqual(1);
    // Zweiter Lauf am selben Tag meldet nichts erneut
    expect(await notifyMaturities(db)).toBe(0);
  });

  it("schweigt bei einer Zinsbindung weit in der Zukunft", async () => {
    const propertyId = await newProperty();
    await newTranche(propertyId, {
      name: "Spät",
      maturityDate: "2039-12-31",
    });
    // Marker der vorherigen Tranche sind gesetzt → hier bleibt es bei 0
    expect(await notifyMaturities(getDb())).toBe(0);
  });
});

describe("Kaskaden im Finanz-Modul", () => {
  it("löst beim Löschen eines Kontos nur die Verknüpfung, nicht die Amortisation", async () => {
    const accRes = await callerFor(admin).finance.createAccount({
      name: "Wegwerfkonto",
      type: "savings",
      initialBalance: 0,
      private: false,
    });
    const accs = await callerFor(admin).finance.listAccounts();
    const accountId = accs.find(a => a.name === "Wegwerfkonto")!.id;
    expect(accRes).toBeTruthy();

    const propertyId = await newProperty();
    const amort = await callerFor(admin).mortgage.addAmortization({
      propertyId,
      kind: "indirect",
      amount: 100_000,
      accountId,
      startDate: "2026-01-01",
    });

    await callerFor(admin).finance.deleteAccount({
      id: accountId,
      name: "Wegwerfkonto",
    });

    const list = await callerFor(admin).mortgage.listAmortizations({
      propertyId,
    });
    const row = list.find(a => a.id === amort.id)!;
    expect(row).toBeTruthy(); // Plan bleibt bestehen
    expect(row.accountId).toBeNull(); // nur die Verknüpfung ist weg
  });

  it("sperrt das Löschen einer Bank, die eine Tranche nutzt", async () => {
    await callerFor(admin).finance.createBank({ name: "Hypobank" });
    const banks = await callerFor(admin).finance.listBanks();
    const bankId = banks.find(b => b.name === "Hypobank")!.id;

    const propertyId = await newProperty();
    await newTranche(propertyId, { bankId });

    await expect(
      callerFor(admin).finance.deleteBank({ id: bankId })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
