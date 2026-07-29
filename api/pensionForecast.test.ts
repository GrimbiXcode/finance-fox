import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { goalSources, savingsGoals, users } from "@db/schema";
import { computeChForecast } from "./lib/pension/forecastCh";
import { getPensionCalculator } from "./lib/pension";
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

/** Fixer „heute"-Zeitpunkt für deterministische Simulationen (Jan 2026) */
const NOW = new Date(2026, 0, 15);

const BASE_INPUT = {
  birthDate: "1991-01-10", // + Rentenalter 36 → Rente im Januar 2027
  retirementAge: 36, // genau 12 Simulationsmonate ab Januar 2026
  funds: [
    {
      kind: "pension_fund" as const,
      name: "PK",
      currentCapital: 120000,
      yearlySavings: 12000,
      interestRateBp: 1200,
      conversionRateBp: 680,
      insuredSalary: null,
      tiers: [],
    },
  ],
  pillar3: [
    {
      name: "Viac 3a",
      currentBalance: 240000,
      yearlyDeposit: 0,
      interestRateBp: 0,
      accountId: null,
    },
  ],
  ahv: { contributionYears: 44, expectedMonthlyPension: null },
  currentNet: 500000,
  now: NOW,
};

beforeAll(async () => {
  await initDb();
  ensureSchema();
  await getDb().insert(users).values({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: "admin",
    color: admin.color,
    createdAt: new Date(),
  });
});

describe("CH-Prognose (computeChForecast)", () => {
  it("simuliert Zinseszins, Umwandlungssatz, AHV-Schätzung und Ersatzrate", () => {
    const result = computeChForecast(BASE_INPUT);

    expect(result.retirementDate).toBe("2027-01-10");
    // Säule 2: 12 Monate à 1000 Einzahlung + 1 % Monatszins (gerundet)
    expect(result.pillar2.capital).toBe(147900);
    // Jahresrente 147900 × 6,8 % = 10057,20 → Monatsrente 838
    expect(result.pillar2.monthlyPension).toBe(838);
    // Säule 3a: ohne Einzahlung/Zins unverändert; Entnahme über 20 Jahre
    expect(result.pillar3.capital).toBe(240000);
    expect(result.pillar3.monthlyWithdrawal).toBe(1000);
    // AHV: Vollrente bei 44 Beitragsjahren (geschätzt)
    expect(result.ahv).toEqual({ monthlyPension: 302400, estimated: true });

    expect(result.monthlyRetirementIncome).toBe(304238);
    expect(result.currentNet).toBe(500000);
    expect(result.replacementRate).toBe(61);
    expect(result.warnings).toEqual([]);
  });

  it("liefert Jahrespunkte der Vermögensentwicklung (series)", () => {
    const result = computeChForecast(BASE_INPUT);
    // Startpunkt, Jahresende Dezember 2026, Rentenmonat Januar 2027
    expect(result.series).toEqual([
      { year: 2026, pillar2: 120000, pillar3: 240000, total: 360000 },
      { year: 2026, pillar2: 145446, pillar3: 240000, total: 385446 },
      { year: 2027, pillar2: 147900, pillar3: 240000, total: 387900 },
    ]);
  });

  it("verzinst Freizügigkeitskonten nur (keine Einzahlungen)", () => {
    const result = computeChForecast({
      ...BASE_INPUT,
      funds: [
        {
          kind: "vested_benefits",
          name: "FZ-Konto",
          currentCapital: 100000,
          yearlySavings: 12000, // wird ignoriert
          interestRateBp: 600, // 6 % p.a. → 0,5 %/Monat
          conversionRateBp: 680,
          insuredSalary: null,
          tiers: [],
        },
      ],
      pillar3: [],
      ahv: null,
      currentNet: null,
    });
    expect(result.pillar2.capital).toBe(106169);
    // ohne Lohnangaben keine Ersatzrate
    expect(result.replacementRate).toBeNull();
  });

  it("schätzt die AHV aus den Beitragsjahren bzw. warnt bei fehlenden Angaben", () => {
    const halbe = computeChForecast({
      ...BASE_INPUT,
      ahv: { contributionYears: 22, expectedMonthlyPension: null },
    });
    expect(halbe.ahv).toEqual({ monthlyPension: 151200, estimated: true });

    const leer = computeChForecast({ ...BASE_INPUT, ahv: null });
    expect(leer.ahv).toEqual({ monthlyPension: 0, estimated: true });
    expect(leer.warnings.some(w => w.includes("Keine AHV-Angaben"))).toBe(true);

    // hinterlegte Rente schlägt die Schätzung
    const fix = computeChForecast({
      ...BASE_INPUT,
      ahv: { contributionYears: 22, expectedMonthlyPension: 200000 },
    });
    expect(fix.ahv).toEqual({ monthlyPension: 200000, estimated: false });
  });

  it("zieht in Sparzielen verplante Anteile vom 3a-Sync-Saldo ab", () => {
    const result = computeChForecast({
      ...BASE_INPUT,
      pillar3: [
        {
          name: "Viac 3a",
          currentBalance: 999, // irrelevant bei Verknüpfung
          yearlyDeposit: 0,
          interestRateBp: 0,
          accountId: 42,
          syncedBalance: 100000,
          goalCommitment: 30000,
          goalNames: ["Eigenheim"],
        },
      ],
      ahv: null,
    });
    expect(result.pillar3.capital).toBe(70000);
    expect(
      result.warnings.some(
        w => w.includes("Eigenheim") && w.includes("Viac 3a")
      )
    ).toBe(true);
  });
});

describe("Abstufungen der Pensionskasse (tiers)", () => {
  const TIER_FUND = {
    kind: "pension_fund" as const,
    name: "PK",
    currentCapital: 0,
    yearlySavings: 0, // wird durch die Abstufungen ersetzt
    interestRateBp: 0,
    conversionRateBp: 680,
    insuredSalary: 10000000, // 100'000 versicherter Jahreslohn
    tiers: [
      { ageFrom: 25, rateBp: 700 },
      { ageFrom: 36, rateBp: 1000 },
    ],
  };

  it("wechselt die Beitragsrate exakt im Monat des Stufenalters", () => {
    // Geboren Januar 1991 → im Januar 2026 (now) 35, ab Januar 2027 36.
    // Monate Feb–Dez 2026 (11×) Stufe 7 %, Rentenmonat Jan 2027 Stufe 10 %.
    const result = computeChForecast({
      ...BASE_INPUT,
      funds: [TIER_FUND],
      pillar3: [],
      ahv: null,
      currentNet: null,
    });
    expect(result.funds).toHaveLength(1);
    expect(result.funds[0].phases).toEqual([
      { ageFrom: 25, fromYear: 2026, rateBp: 700, yearlyContribution: 700000 },
      {
        ageFrom: 36,
        fromYear: 2027,
        rateBp: 1000,
        yearlyContribution: 1000000,
      },
    ]);
    // 11 × round(700000/12) aufsummiert + round(1000000/12), monatlich gerundet
    expect(result.funds[0].capital).toBe(724996);
    expect(result.pillar2.capital).toBe(result.funds[0].capital);

    // Vergleich: flache 7 %-Stufe ohne Sprung ergibt weniger Endkapital
    const flach = computeChForecast({
      ...BASE_INPUT,
      funds: [{ ...TIER_FUND, tiers: [{ ageFrom: 25, rateBp: 700 }] }],
      pillar3: [],
      ahv: null,
      currentNet: null,
    });
    expect(flach.funds[0].phases).toEqual([
      { ageFrom: 25, fromYear: 2026, rateBp: 700, yearlyContribution: 700000 },
    ]);
    expect(flach.pillar2.capital).toBeLessThan(result.pillar2.capital);
  });

  it("fällt ohne versicherten Lohn oder ohne Stufen auf yearlySavings zurück", () => {
    const fund = {
      kind: "pension_fund" as const,
      name: "PK",
      currentCapital: 120000,
      yearlySavings: 12000,
      interestRateBp: 1200,
      conversionRateBp: 680,
      insuredSalary: 10000000,
      tiers: [{ ageFrom: 25, rateBp: 1000 }],
    };
    const flach = computeChForecast(BASE_INPUT); // gleiche flache Werte
    const ohneLohn = computeChForecast({
      ...BASE_INPUT,
      funds: [{ ...fund, insuredSalary: null }],
    });
    const ohneTiers = computeChForecast({
      ...BASE_INPUT,
      funds: [{ ...fund, tiers: [] }],
    });
    expect(ohneLohn.pillar2).toEqual(flach.pillar2);
    expect(ohneTiers.pillar2).toEqual(flach.pillar2);
    expect(ohneLohn.funds[0].phases).toEqual([]);
    expect(ohneTiers.funds[0].phases).toEqual([]);
  });

  it("schlüsselt Endkapital und Monatsrente pro Kasse auf (funds)", () => {
    const result = computeChForecast({
      ...BASE_INPUT,
      funds: [
        { ...BASE_INPUT.funds[0], name: "PK A" },
        {
          kind: "vested_benefits" as const,
          name: "FZ",
          currentCapital: 50000,
          yearlySavings: 0,
          interestRateBp: 600,
          conversionRateBp: 680,
          insuredSalary: null,
          tiers: [],
        },
      ],
    });
    expect(result.funds).toHaveLength(2);
    const [pk, fz] = result.funds;
    expect(pk.name).toBe("PK A");
    expect(pk.capital).toBe(147900); // wie im Basistest
    // Summe der Einzelkapitale = Säule-2-Gesamtkapital
    expect(pk.capital + fz.capital).toBe(result.pillar2.capital);
    // Monatsrente pro Kasse: Kapital × Umwandlungssatz / 12
    expect(pk.monthlyPension).toBe(838);
    expect(fz.monthlyPension).toBe(Math.round((fz.capital * 680) / 10000 / 12));
    expect(pk.phases).toEqual([]);
    expect(fz.phases).toEqual([]);
  });

  it("liefert Jahres-Snapshots pro Kasse, deckungsgleich mit series (fundSeries)", () => {
    const result = computeChForecast(BASE_INPUT);
    expect(result.fundSeries).toHaveLength(1);
    expect(result.fundSeries[0].name).toBe("PK");
    expect(result.fundSeries[0].points).toEqual(
      result.series.map(s => ({ year: s.year, capital: s.pillar2 }))
    );
  });
});

describe("Prognose-Factory (getPensionCalculator)", () => {
  it("liefert den CH-Rechner und wirft bei unbekanntem Land", () => {
    expect(getPensionCalculator("CH").forecast).toBeTypeOf("function");
    expect(() => getPensionCalculator("DE")).toThrow(
      "Für das Land „DE“ ist keine Vorsorge-Prognose verfügbar."
    );
  });
});

describe("forecast-Endpunkt", () => {
  it("wirft NOT_FOUND ohne Vorsorgeprofil", async () => {
    await expect(callerFor(admin).pension.forecast()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rechnet mit den hinterlegten Daten inkl. 3a-Konto-Sync", async () => {
    const caller = callerFor(admin);
    await caller.pension.updateProfile({ birthDate: "1991-01-10" }); // Alter 65
    await caller.pension.addFund({
      name: "PK",
      currentCapital: 120000,
      yearlySavings: 12000,
      interestRateBp: 1200,
    });
    await caller.pension.updateAhv({ contributionYears: 44 });
    // verknüpftes 3a-Konto: Konto mit 100'000, davon 30'000 im Sparziel verplant
    await caller.finance.createAccount({
      name: "3a-Konto",
      type: "savings",
      initialBalance: 100000,
      private: false,
    });
    const accs = await caller.finance.listAccounts();
    const accountId = accs.find(a => a.name === "3a-Konto")!.id;
    const [goal] = await getDb()
      .insert(savingsGoals)
      .values({ name: "Auto", targetAmount: 500000, color: "#0ea5e9" })
      .returning({ id: savingsGoals.id });
    await getDb().insert(goalSources).values({
      goalId: goal.id,
      accountId,
      mode: "absolute",
      value: 30000,
      createdAt: new Date(),
    });
    await caller.pension.addPillar3({
      name: "Viac 3a",
      yearlyDeposit: 0,
      accountId,
    });

    const result = await caller.pension.forecast();
    expect(result.ahv).toEqual({ monthlyPension: 302400, estimated: true });
    expect(result.pillar2.capital).toBeGreaterThan(120000);
    // 3a-Start = 100000 − 30000 verplant
    expect(result.pillar3.capital).toBeGreaterThanOrEqual(70000);
    const p3Start = result.series[0].pillar3;
    expect(p3Start).toBe(70000);
    expect(
      result.warnings.some(w => w.includes("Auto") && w.includes("Viac 3a"))
    ).toBe(true);
    // ohne Lohn keine Ersatzrate
    expect(result.replacementRate).toBeNull();
  });

  it("berechnet die Ersatzrate aus dem aktuellen Netto", async () => {
    const caller = callerFor(admin);
    await caller.pension.addSalary({
      validFrom: "2020-01",
      grossMonthly: 500000,
    });
    const result = await caller.pension.forecast();
    expect(result.currentNet).toBe(500000);
    expect(result.replacementRate).toBe(
      Math.round((result.monthlyRetirementIncome / 500000) * 100)
    );
    expect(result.replacementRate).toBeGreaterThan(0);
  });

  it("rechnet mit hypothetischem Rentenalter (Override)", async () => {
    const caller = callerFor(admin);
    const basis = await caller.pension.forecast();
    // Frühere Pensionierung → kürzere Ansparphase, spätere → längere
    const frueher = await caller.pension.forecast({ retirementAge: 60 });
    const spaeter = await caller.pension.forecast({ retirementAge: 70 });
    expect(frueher.retirementDate < basis.retirementDate).toBe(true);
    expect(spaeter.retirementDate > basis.retirementDate).toBe(true);
    expect(frueher.pillar2.capital).toBeLessThan(basis.pillar2.capital);
    expect(spaeter.pillar2.capital).toBeGreaterThan(basis.pillar2.capital);
    // ungültige Werte lehnt die Validierung ab
    await expect(
      caller.pension.forecast({ retirementAge: 40 })
    ).rejects.toThrow();
  });

  it("meldet ein Land ohne Prognose-Engine als BAD_REQUEST", async () => {
    const caller = callerFor(admin);
    await caller.pension.updateProfile({ country: "DE" });
    await expect(caller.pension.forecast()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Für das Land „DE“ ist keine Vorsorge-Prognose verfügbar.",
    });
    await caller.pension.updateProfile({ country: "CH" });
  });
});
