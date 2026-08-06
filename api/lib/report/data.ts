/**
 * Datensammlung für den Berichts-Export.
 *
 * Der Bericht rechnet **nichts selbst**: Er ruft über `appRouter.createCaller`
 * exakt dieselben Endpunkte auf, aus denen sich auch die Oberfläche speist.
 * Das ist die entscheidende Eigenschaft dieses Moduls — eine Zahl, die der
 * Nutzer mit ins Bankgespräch nimmt, darf sich nicht von der Zahl auf dem
 * Bildschirm unterscheiden. Eine eigene Abfrageschicht hätte genau das
 * riskiert (und die Sichtbarkeitsregeln ein zweites Mal implementieren
 * müssen).
 *
 * Daraus folgt auch der Datenschutz: Jeder Endpunkt scopet bereits auf
 * `ctx.user` — Konten über `listVisibleAccounts`, Sparziele über
 * `computeGoalProgress`, die Vorsorge strikt auf die eigenen Zeilen.
 * Der Bericht ist damit immer die **Sicht des anfragenden Nutzers**, nie
 * die des Haushalts.
 *
 * Beträge bleiben Cent, Zinsen Basispunkte, Datumsangaben ISO — formatiert
 * wird erst beim Rendern (`format.ts`), wie bei `MortgageWarning` und
 * `InsuranceGap` auch.
 */

import { TRPCError } from "@trpc/server";
import {
  INSURANCE_BRANCH_LABELS,
  INSURANCE_STATUS_LABELS,
  type InsuranceStatus,
} from "@contracts/insurance";
import {
  MONTHS_PER_INTERVAL,
  RECURRING_INTERVAL_LABELS,
  type RecurringInterval,
} from "@contracts/types";
import type { ReportSection } from "@contracts/report";
import { appRouter } from "../../router";
import type { SessionUser, TrpcContext } from "../../context";
import { TRANCHE_KIND_LABELS, USAGE_LABELS } from "../../mortgageRouter";
import { localISO } from "../recurringSchedule";

/* --------------------------------- Eingabe -------------------------------- */

export interface ReportInput {
  sections: ReportSection[];
  /** Horizont der Nettovermögens-Prognose in Monaten */
  months: number;
}

/* -------------------------------- Ergebnis -------------------------------- */

export interface ReportAccountRow {
  name: string;
  type: string;
  bank: string;
  iban: string;
  owners: string;
  balance: number;
}

export interface ReportGoalRow {
  name: string;
  targetAmount: number | null;
  saved: number;
  percent: number | null;
  deadline: string | null;
  sources: string[];
  hasHiddenSources: boolean;
}

export interface ReportTrancheRow {
  name: string;
  kind: string;
  bank: string;
  principal: number;
  effectiveRateBp: number;
  yearlyInterest: number;
  maturityDate: string | null;
}

export interface ReportProperty {
  name: string;
  address: string;
  usage: string;
  purchasePrice: number;
  marketValue: number;
  householdIncome: number;
  totalDebt: number;
  equity: number;
  ltvBp: number | null;
  ltvHeadroom: number;
  firstMortgage: number;
  secondMortgage: number;
  avgRateBp: number;
  monthlyInterest: number;
  monthlyBurden: number;
  affordability: {
    calcInterest: number;
    maintenance: number;
    requiredAmortization: number;
    actualAmortization: number;
    totalCost: number;
    ratioBp: number | null;
    affordable: boolean | null;
  };
  tranches: ReportTrancheRow[];
  amortizations: {
    kind: string;
    amount: number;
    interval: string;
    active: boolean;
    endDate: string | null;
  }[];
}

export interface ReportPension {
  retirementDate: string;
  monthlyRetirementIncome: number;
  currentNet: number | null;
  replacementRate: number | null;
  pillar2: { capital: number; monthlyPension: number };
  pillar3: { capital: number; monthlyWithdrawal: number };
  ahv: { monthlyPension: number; estimated: boolean };
  funds: { name: string; capital: number; monthlyPension: number }[];
  series: { year: number; pillar2: number; pillar3: number; total: number }[];
}

export interface ReportPolicy {
  name: string;
  branch: string;
  insurer: string;
  status: string;
  premium: number;
  interval: string;
  premiumMonthly: number;
  premiumYearly: number;
  deductible: number | null;
  startDate: string;
  endDate: string | null;
  cancelBy: string | null;
  persons: string;
  coverages: { label: string; sumInsured: number | null; note: string }[];
}

export interface ReportCashflow {
  months: { month: string; income: number; expense: number; net: number }[];
  totals: { income: number; expense: number; net: number };
  average: { income: number; expense: number; net: number };
  categories: { name: string; amount: number }[];
}

export interface ReportRecurringRow {
  note: string;
  type: "income" | "expense" | "transfer";
  account: string;
  category: string;
  amount: number;
  interval: string;
  monthly: number;
  nextDate: string;
  endDate: string | null;
  active: boolean;
}

export interface ReportNetWorth {
  balanceNow: number;
  netWorthNow: number | null;
  points: { month: string; balance: number; netWorth: number | null }[];
  missingRecurring: number;
}

export interface ReportData {
  generatedAt: string;
  currency: string;
  viewer: { name: string; email: string };
  sections: ReportSection[];
  months: number;
  /** Gewählte Abschnitte ohne Daten — der Bericht benennt sie, statt zu schweigen */
  empty: { section: ReportSection; reason: string }[];
  accounts?: { rows: ReportAccountRow[]; total: number };
  goals?: { rows: ReportGoalRow[]; totalSaved: number; totalTarget: number };
  mortgages?: {
    properties: ReportProperty[];
    totals: { propertyValue: number; debt: number; equity: number };
  };
  pension?: ReportPension;
  insurances?: {
    rows: ReportPolicy[];
    totals: {
      count: number;
      activeCount: number;
      premiumMonthly: number;
      premiumYearly: number;
    };
  };
  cashflow?: ReportCashflow;
  recurring?: {
    rows: ReportRecurringRow[];
    totals: { monthlyIncome: number; monthlyExpense: number };
  };
  netWorth?: ReportNetWorth;
}

/* -------------------------------- Sammeln --------------------------------- */

type Caller = ReturnType<typeof appRouter.createCaller>;

export async function collectReport(
  ctx: TrpcContext & { user: SessionUser },
  input: ReportInput
): Promise<ReportData> {
  const caller = appRouter.createCaller(ctx);
  const wanted = new Set(input.sections);
  const empty: ReportData["empty"] = [];
  const settings = await caller.finance.getAppSettings();

  const data: ReportData = {
    generatedAt: localISO(new Date()),
    currency: settings.currency,
    viewer: { name: ctx.user.name, email: ctx.user.email },
    sections: input.sections,
    months: input.months,
    empty,
  };

  const note = (section: ReportSection, reason: string) =>
    empty.push({ section, reason });

  if (wanted.has("accounts")) {
    data.accounts = await collectAccounts(caller);
    if (data.accounts.rows.length === 0) {
      data.accounts = undefined;
      note("accounts", "Keine für dich sichtbaren Konten erfasst.");
    }
  }

  if (wanted.has("goals")) {
    data.goals = await collectGoals(caller);
    if (data.goals.rows.length === 0) {
      data.goals = undefined;
      note("goals", "Keine Sparziele erfasst.");
    }
  }

  if (wanted.has("mortgages")) {
    data.mortgages = await collectMortgages(caller);
    if (data.mortgages.properties.length === 0) {
      data.mortgages = undefined;
      note("mortgages", "Keine Liegenschaft erfasst.");
    }
  }

  if (wanted.has("pension")) {
    data.pension = await collectPension(caller);
    if (!data.pension) {
      note(
        "pension",
        "Kein Vorsorgeprofil hinterlegt — die Vorsorge ist privat pro Person."
      );
    }
  }

  if (wanted.has("insurances")) {
    data.insurances = await collectInsurances(caller);
    if (data.insurances.rows.length === 0) {
      data.insurances = undefined;
      note("insurances", "Keine Policen erfasst.");
    }
  }

  if (wanted.has("cashflow")) {
    data.cashflow = await collectCashflow(caller);
    if (data.cashflow.months.every(m => m.income === 0 && m.expense === 0)) {
      data.cashflow = undefined;
      note("cashflow", "Keine Buchungen in den letzten 12 Monaten.");
    }
  }

  if (wanted.has("recurring")) {
    data.recurring = await collectRecurring(caller);
    if (data.recurring.rows.length === 0) {
      data.recurring = undefined;
      note("recurring", "Keine Dauerbuchungen erfasst.");
    }
  }

  if (wanted.has("netWorth")) {
    data.netWorth = await collectNetWorth(caller, input.months);
  }

  return data;
}

/* ------------------------------ Einzelteile ------------------------------- */

async function collectAccounts(
  caller: Caller
): Promise<NonNullable<ReportData["accounts"]>> {
  const [accounts, types, banks, users] = await Promise.all([
    caller.finance.listAccounts(),
    caller.finance.listAccountTypes(),
    caller.finance.listBanks(),
    caller.auth.listUsers(),
  ]);
  const typeName = new Map(types.map(t => [t.key, t.name]));
  const bankName = new Map(banks.map(b => [b.id, b.name]));
  const userName = new Map(users.map(u => [u.id, u.name]));

  const rows = accounts
    .map(a => ({
      name: a.name,
      type: typeName.get(a.type) ?? a.type,
      bank: a.bankId === null ? "" : (bankName.get(a.bankId) ?? ""),
      iban: a.iban ?? "",
      owners:
        a.owners.length === 0
          ? "Gemeinsam"
          : a.owners.map(id => userName.get(id) ?? `#${id}`).join(", "),
      balance: a.balance,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows, total: rows.reduce((sum, r) => sum + r.balance, 0) };
}

async function collectGoals(
  caller: Caller
): Promise<NonNullable<ReportData["goals"]>> {
  const goals = await caller.finance.listGoals();
  const rows = goals
    .map(g => ({
      name: g.name,
      targetAmount: g.targetAmount,
      saved: g.totalSaved,
      percent: g.percent,
      deadline: g.deadline,
      sources: g.sources.map(describeGoalSource),
      hasHiddenSources: g.hasHiddenSources,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    rows,
    totalSaved: rows.reduce((sum, r) => sum + r.saved, 0),
    totalTarget: rows.reduce((sum, r) => sum + (r.targetAmount ?? 0), 0),
  };
}

/** „Sparkonto — 50 % des Saldos" bzw. „Manuell (Bestand)" */
function describeGoalSource(source: {
  kind: "account" | "legacy";
  accountName?: string;
  mode?: "full" | "absolute" | "percent";
  value?: number | null;
}): string {
  if (source.kind === "legacy") return "Manuell (Bestand)";
  const name = source.accountName ?? "Konto";
  if (source.mode === "percent")
    return `${name} — ${source.value ?? 0} % des Saldos`;
  if (source.mode === "absolute") return `${name} — fester Anteil`;
  return `${name} — gesamter Saldo`;
}

async function collectMortgages(
  caller: Caller
): Promise<NonNullable<ReportData["mortgages"]>> {
  const propertyRows = await caller.mortgage.listProperties();
  const properties: ReportProperty[] = [];

  for (const p of propertyRows) {
    const [schedule, tranches, amorts] = await Promise.all([
      caller.mortgage.forecast({ propertyId: p.id, months: 120 }),
      caller.mortgage.listTranches({ propertyId: p.id }),
      caller.mortgage.listAmortizations({ propertyId: p.id }),
    ]);
    properties.push({
      name: p.name,
      address: p.address,
      usage: USAGE_LABELS[p.usage] ?? p.usage,
      purchasePrice: p.purchasePrice,
      marketValue: p.marketValue,
      householdIncome: p.householdIncome,
      totalDebt: schedule.totals.debt,
      equity: p.marketValue - schedule.totals.debt,
      ltvBp: schedule.ltv.bp,
      ltvHeadroom: schedule.ltv.headroom,
      firstMortgage: schedule.ltv.firstMortgage,
      secondMortgage: schedule.ltv.secondMortgage,
      avgRateBp: schedule.totals.avgRateBp,
      monthlyInterest: schedule.totals.monthlyInterest,
      monthlyBurden: schedule.totals.monthlyBurden,
      affordability: {
        calcInterest: schedule.affordability.calcInterest,
        maintenance: schedule.affordability.maintenance,
        requiredAmortization: schedule.affordability.requiredAmortization,
        actualAmortization: schedule.affordability.actualAmortization,
        totalCost: schedule.affordability.totalCost,
        ratioBp: schedule.affordability.ratioBp,
        affordable: schedule.affordability.affordable,
      },
      tranches: tranches.map(t => ({
        name: t.name,
        kind: TRANCHE_KIND_LABELS[t.kind] ?? t.kind,
        bank: t.bankName ?? "",
        principal: t.principal,
        effectiveRateBp: t.effectiveRateBp,
        yearlyInterest: t.yearlyInterest,
        maturityDate: t.maturityDate,
      })),
      amortizations: amorts.map(a => ({
        kind: a.kind === "direct" ? "Direkt" : "Indirekt",
        amount: a.amount,
        interval: intervalLabel(a.interval),
        active: a.active,
        endDate: a.endDate,
      })),
    });
  }

  return {
    properties,
    totals: {
      propertyValue: properties.reduce((s, p) => s + p.marketValue, 0),
      debt: properties.reduce((s, p) => s + p.totalDebt, 0),
      equity: properties.reduce((s, p) => s + p.equity, 0),
    },
  };
}

/**
 * Die Vorsorge ist privat pro Benutzer. Ohne Profil wirft `pension.forecast`
 * NOT_FOUND — das ist hier kein Fehler, sondern schlicht „nichts zu
 * berichten": Ein fehlendes Profil darf nicht den ganzen Export kippen.
 */
async function collectPension(
  caller: Caller
): Promise<ReportPension | undefined> {
  let forecast;
  try {
    forecast = await caller.pension.forecast();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") return undefined;
    throw err;
  }
  return {
    retirementDate: forecast.retirementDate,
    monthlyRetirementIncome: forecast.monthlyRetirementIncome,
    currentNet: forecast.currentNet,
    replacementRate: forecast.replacementRate,
    pillar2: forecast.pillar2,
    pillar3: forecast.pillar3,
    ahv: forecast.ahv,
    funds: forecast.funds.map(f => ({
      name: f.name,
      capital: f.capital,
      monthlyPension: f.monthlyPension,
    })),
    series: forecast.series,
  };
}

async function collectInsurances(
  caller: Caller
): Promise<NonNullable<ReportData["insurances"]>> {
  const [policies, coverages, users] = await Promise.all([
    caller.insurance.listPolicies(),
    caller.insurance.listCoverages(),
    caller.auth.listUsers(),
  ]);
  const userName = new Map(users.map(u => [u.id, u.name]));
  const byPolicy = new Map<number, typeof coverages>();
  for (const c of coverages) {
    const list = byPolicy.get(c.policyId);
    if (list) list.push(c);
    else byPolicy.set(c.policyId, [c]);
  }

  const rows: ReportPolicy[] = policies.map(p => ({
    name: p.name,
    branch: INSURANCE_BRANCH_LABELS[p.branch] ?? p.branch,
    insurer: p.insurer,
    status: INSURANCE_STATUS_LABELS[p.status as InsuranceStatus] ?? p.status,
    premium: p.premium,
    interval: intervalLabel(p.premiumInterval),
    premiumMonthly: p.premiumMonthly,
    premiumYearly: p.premiumYearly,
    deductible: p.deductible,
    startDate: p.startDate,
    endDate: p.endDate,
    cancelBy: p.notice.cancelBy,
    persons:
      p.personIds.length === 0
        ? "Haushalt"
        : p.personIds.map(id => userName.get(id) ?? `#${id}`).join(", "),
    coverages: (byPolicy.get(p.id) ?? []).map(c => ({
      label: c.label,
      sumInsured: c.sumInsured,
      note: c.notes,
    })),
  }));

  // Angebote zählen nie in die Prämiensummen (Muster: insurance.summary)
  const paying = policies.filter(p => p.status === "active");
  return {
    rows,
    totals: {
      count: rows.length,
      activeCount: paying.length,
      premiumMonthly: paying.reduce((s, p) => s + p.premiumMonthly, 0),
      premiumYearly: paying.reduce((s, p) => s + p.premiumYearly, 0),
    },
  };
}

/**
 * Einnahmen/Ausgaben der letzten zwölf abgeschlossenen bzw. laufenden Monate.
 * Umbuchungen zählen bewusst nicht mit — sie verschieben Geld, sie verdienen
 * oder verbrauchen keines. Ausgaben je Oberkategorie werden aufgerollt wie in
 * `finance.yearComparison`.
 */
async function collectCashflow(caller: Caller): Promise<ReportCashflow> {
  const [transactions, categories] = await Promise.all([
    caller.finance.listTransactions(),
    caller.finance.listCategories(),
  ]);
  const rootOf = new Map(categories.map(c => [c.id, c.parentId ?? c.id]));
  const nameOf = new Map(categories.map(c => [c.id, c.name]));

  const today = new Date();
  const keys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  const first = keys[0];
  const buckets = new Map(keys.map(k => [k, { income: 0, expense: 0 }]));
  const byCategory = new Map<number, number>();
  /** Schlüssel -1 = Ausgaben ohne Kategorie (wie in yearComparison) */
  const NO_CATEGORY = -1;

  for (const t of transactions) {
    if (t.type === "transfer") continue;
    const key = t.date.slice(0, 7);
    const bucket = buckets.get(key);
    if (!bucket || key < first) continue;
    if (t.type === "income") {
      bucket.income += t.amount;
      continue;
    }
    bucket.expense += t.amount;
    const root =
      t.categoryId === null
        ? NO_CATEGORY
        : (rootOf.get(t.categoryId) ?? t.categoryId);
    byCategory.set(root, (byCategory.get(root) ?? 0) + t.amount);
  }

  const months = keys.map(month => {
    const b = buckets.get(month)!;
    return {
      month,
      income: b.income,
      expense: b.expense,
      net: b.income - b.expense,
    };
  });
  const income = months.reduce((s, m) => s + m.income, 0);
  const expense = months.reduce((s, m) => s + m.expense, 0);

  return {
    months,
    totals: { income, expense, net: income - expense },
    average: {
      income: Math.round(income / 12),
      expense: Math.round(expense / 12),
      net: Math.round((income - expense) / 12),
    },
    categories: [...byCategory.entries()]
      .map(([id, amount]) => ({
        name:
          id === NO_CATEGORY
            ? "Ohne Kategorie"
            : (nameOf.get(id) ?? "Unbekannt"),
        amount,
      }))
      .sort((a, b) => b.amount - a.amount),
  };
}

async function collectRecurring(
  caller: Caller
): Promise<NonNullable<ReportData["recurring"]>> {
  const [rules, accounts, categories] = await Promise.all([
    caller.finance.listRecurring(),
    caller.finance.listAccounts(),
    caller.finance.listCategories(),
  ]);
  const accountName = new Map(accounts.map(a => [a.id, a.name]));
  const categoryName = new Map(categories.map(c => [c.id, c.name]));

  const rows: ReportRecurringRow[] = rules
    .map(r => ({
      note: r.note || "(ohne Notiz)",
      type: r.type,
      account:
        r.type === "transfer"
          ? `${accountName.get(r.accountId) ?? "?"} → ${accountName.get(r.toAccountId ?? -1) ?? "?"}`
          : (accountName.get(r.accountId) ?? "?"),
      category:
        r.categoryId === null ? "" : (categoryName.get(r.categoryId) ?? ""),
      amount: r.amount,
      interval: RECURRING_INTERVAL_LABELS[r.interval],
      monthly: monthlyEquivalent(r.amount, r.interval),
      nextDate: r.nextDate,
      endDate: r.endDate,
      active: r.active,
    }))
    .sort((a, b) => b.monthly - a.monthly);

  // Nur aktive, nicht abgelaufene Regeln bilden die laufende Belastung ab
  const today = localISO(new Date());
  const live = rows.filter(r => r.active && (!r.endDate || r.endDate >= today));
  return {
    rows,
    totals: {
      monthlyIncome: live
        .filter(r => r.type === "income")
        .reduce((s, r) => s + r.monthly, 0),
      monthlyExpense: live
        .filter(r => r.type === "expense")
        .reduce((s, r) => s + r.monthly, 0),
    },
  };
}

async function collectNetWorth(
  caller: Caller,
  months: number
): Promise<ReportNetWorth> {
  const balance = await caller.forecast.balance({ months });
  const balanceNow =
    balance.history.length > 0
      ? balance.history[balance.history.length - 1].balance
      : 0;
  return {
    balanceNow,
    netWorthNow: balance.netWorthNow,
    points: balance.projection.map((p, i) => ({
      month: p.month,
      balance: p.balance,
      netWorth: balance.netWorth?.[i]?.value ?? null,
    })),
    missingRecurring: balance.mortgageMissingRecurring,
  };
}

/* --------------------------------- Helfer --------------------------------- */

function intervalLabel(interval: string): string {
  return RECURRING_INTERVAL_LABELS[interval as RecurringInterval] ?? interval;
}

/** Betrag auf einen Monatswert normalisieren (wöchentlich: 52/12 Wochen) */
function monthlyEquivalent(
  amount: number,
  interval: RecurringInterval
): number {
  if (interval === "weekly") return Math.round((amount * 52) / 12);
  return Math.round(amount / MONTHS_PER_INTERVAL[interval]);
}
