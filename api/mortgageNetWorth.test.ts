import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Regressionsnetz gegen doppelt gezähltes Vermögen.
 *
 * netWorth = sichtbare Kontosalden + Verkehrswert − Restschuld. Damit das
 * stimmt, muss jeder Hypotheken-Geldfluss GENAU EINMAL wirken:
 * - Zins            → Ausgabe, Schuld unverändert  → Vermögen sinkt
 * - direkte Amort.  → Ausgabe UND Schuld sinkt     → Vermögen unverändert
 * - indirekte Amort → Umbuchung (saldo-neutral),
 *                     Schuld bewusst unverändert   → Vermögen unverändert
 *
 * Bricht eine dieser Invarianten, springt die Reihe hier sichtbar.
 */

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

/** Erster Tag des Folgemonats — dort setzen die Übernahmen an */
function firstOfNextMonth(): string {
  const d = new Date();
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}

let girokonto = 0;
let vorsorgekonto = 0;

beforeAll(async () => {
  await initDb();
  ensureSchema();
  await getDb().insert(users).values({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    color: admin.color,
    createdAt: new Date(),
  });
  const caller = callerFor(admin);
  await caller.finance.createAccount({
    name: "Girokonto",
    type: "checking",
    initialBalance: 20_000_000,
    private: false,
  });
  await caller.finance.createAccount({
    name: "Säule 3a",
    type: "savings",
    initialBalance: 0,
    private: false,
  });
  const accs = await caller.finance.listAccounts();
  girokonto = accs.find(a => a.name === "Girokonto")!.id;
  vorsorgekonto = accs.find(a => a.name === "Säule 3a")!.id;
});

describe("Nettovermögen ohne Liegenschaft", () => {
  it("liefert null statt einer erfundenen Reihe", async () => {
    const r = await callerFor(admin).forecast.balance({ months: 12 });
    expect(r.netWorth).toBeNull();
    expect(r.netWorthNow).toBeNull();
  });
});

describe("Nettovermögen mit Liegenschaft", () => {
  let propertyId = 0;
  let trancheId = 0;

  beforeAll(async () => {
    const caller = callerFor(admin);
    const p = await caller.mortgage.addProperty({
      name: "Eigenheim",
      marketValue: 100_000_000, // 1'000'000.00
      householdIncome: 18_000_000,
    });
    propertyId = p.id;
    const t = await caller.mortgage.addTranche({
      propertyId,
      name: "Festhypothek",
      principal: 60_000_000, // 600'000.00
      interestRateBp: 150,
      startDate: "2024-01-01",
      maturityDate: "2031-03-31",
      paymentInterval: "quarterly",
    });
    trancheId = t.id;
  });

  it("rechnet Kontosalden + Verkehrswert − Schuld", async () => {
    const r = await callerFor(admin).forecast.balance({ months: 12 });
    // 200'000 (Konto) + 1'000'000 (Objekt) − 600'000 (Schuld) = 600'000
    expect(r.netWorthNow).toBe(20_000_000 + 100_000_000 - 60_000_000);
    expect(r.netWorth).not.toBeNull();
    expect(r.netWorth).toHaveLength(12);
  });

  it("meldet fehlende Dauerbuchungen, statt zu optimistisch zu rechnen", async () => {
    const r = await callerFor(admin).forecast.balance({ months: 12 });
    expect(r.mortgageMissingRecurring).toBe(1); // die Tranche
  });

  it("lässt das Vermögen durch den Zins sinken", async () => {
    const caller = callerFor(admin);
    const before = await caller.forecast.balance({ months: 12 });
    await caller.mortgage.transferInterestToRecurring({
      trancheId,
      accountId: girokonto,
    });
    const after = await caller.forecast.balance({ months: 12 });

    // Vier Quartalszinsen à 2'250 im ersten Jahr = 9'000.00
    const last = after.netWorth!.at(-1)!.value;
    const lastBefore = before.netWorth!.at(-1)!.value;
    expect(lastBefore - last).toBe(4 * 225_000);
  });
});

describe("Invariante: direkte Amortisation ist vermögensneutral", () => {
  it("senkt Kontosaldo und Schuld um denselben Betrag", async () => {
    const caller = callerFor(admin);
    const p = await caller.mortgage.addProperty({
      name: "Direkt-Objekt",
      marketValue: 50_000_000,
      householdIncome: 12_000_000,
    });
    const t = await caller.mortgage.addTranche({
      propertyId: p.id,
      name: "Direkt-Tranche",
      principal: 30_000_000,
      interestRateBp: 0, // Zins ausblenden, nur die Amortisation messen
      startDate: "2024-01-01",
      maturityDate: null,
      kind: "variable",
    });

    const before = await caller.forecast.balance({ months: 12 });

    const a = await caller.mortgage.addAmortization({
      propertyId: p.id,
      trancheId: t.id,
      kind: "direct",
      amount: 100_000,
      interval: "monthly",
      startDate: firstOfNextMonth(),
    });
    await caller.mortgage.transferAmortizationToRecurring({
      amortizationId: a.id,
      accountId: girokonto,
    });

    const after = await caller.forecast.balance({ months: 12 });

    // Der Kontosaldo sinkt …
    expect(after.projection.at(-1)!.balance).toBeLessThan(
      before.projection.at(-1)!.balance
    );
    // … das Nettovermögen bleibt exakt gleich: Bargeld wird Eigenkapital
    expect(after.netWorth!.at(-1)!.value).toBe(before.netWorth!.at(-1)!.value);
  });
});

describe("Invariante: indirekte Amortisation ist vermögensneutral", () => {
  it("verschiebt Geld aufs 3a-Konto, ohne das Vermögen zu ändern", async () => {
    const caller = callerFor(admin);
    const p = await caller.mortgage.addProperty({
      name: "Indirekt-Objekt",
      marketValue: 50_000_000,
      householdIncome: 12_000_000,
    });
    await caller.mortgage.addTranche({
      propertyId: p.id,
      name: "Indirekt-Tranche",
      principal: 30_000_000,
      interestRateBp: 0,
      startDate: "2024-01-01",
      maturityDate: null,
      kind: "variable",
    });

    const before = await caller.forecast.balance({ months: 12 });

    const a = await caller.mortgage.addAmortization({
      propertyId: p.id,
      kind: "indirect",
      amount: 100_000,
      interval: "monthly",
      accountId: vorsorgekonto,
      startDate: firstOfNextMonth(),
    });
    await caller.mortgage.transferAmortizationToRecurring({
      amortizationId: a.id,
      accountId: girokonto,
    });

    const after = await caller.forecast.balance({ months: 12 });

    // Umbuchung zwischen zwei sichtbaren Konten: der Gesamtsaldo bleibt …
    expect(after.projection.at(-1)!.balance).toBe(
      before.projection.at(-1)!.balance
    );
    // … die Schuld bleibt bewusst stehen, also auch das Vermögen
    expect(after.netWorth!.at(-1)!.value).toBe(before.netWorth!.at(-1)!.value);
  });

  it("senkt die Restschuld der Engine NICHT (Kern der Invariante)", async () => {
    const caller = callerFor(admin);
    const list = await caller.mortgage.listProperties();
    const p = list.find(x => x.name === "Indirekt-Objekt")!;
    const r = await caller.mortgage.forecast({ propertyId: p.id, months: 24 });
    expect(new Set(r.monthlyDebt)).toEqual(new Set([30_000_000]));
    expect(r.monthlyIndirect.at(-1)).toBeGreaterThan(0);
  });
});
