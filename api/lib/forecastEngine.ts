/**
 * Prognose-Engine: schreibt Kontostände monatsweise mit den Dauerbuchungen
 * fort. Reine Funktionen — die Zeilen kommen bereits geladen herein, damit
 * die Router bei ihrem einen DB-Roundtrip bleiben (Muster wie
 * `mortgage/portfolio.ts`).
 *
 * Geteilt von `forecast.balance` (Gesamtsaldo-Kurve), `forecast.goalForecast`
 * (Sparziel-ETA), `forecast.table` (Prognose-Tabelle) und
 * `forecast.accountBalance` (Konto-Diagramm). Vorher lag dieselbe Simulation
 * zweimal inline im Router — mit abweichenden Fehlern.
 */

import {
  MONTHS_PER_INTERVAL,
  type ForecastGranularity,
  type RecurringInterval,
} from "@contracts/types";
import { localISO, occurrencesInRange } from "./recurringSchedule";

/** Monat eines Datums als `YYYY-MM` */
export function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** Monatsschlüssel um n Monate verschieben (n darf negativ sein) */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Erster Tag eines Monats als `YYYY-MM-DD` */
export function monthStartISO(key: string): string {
  return `${key}-01`;
}

/** Letzter Tag eines Monats als `YYYY-MM-DD` */
export function monthEndISO(key: string): string {
  const d = new Date(`${addMonths(key, 1)}-01T12:00:00`);
  d.setDate(0);
  return localISO(d);
}

/** Monate je Periode einer Aggregationsgröße */
export function monthsPerPeriod(granularity: ForecastGranularity): number {
  return MONTHS_PER_INTERVAL[granularity];
}

/**
 * Ausgangsstand der Simulation aus bereits geladenen Zeilen: Anfangsbestand
 * + Einnahmen − Ausgaben, Umbuchungen quell-/zielseitig — dieselbe Logik wie
 * `finance.listAccounts` und `goalProgress.accountBalances`, insbesondere
 * OHNE Datumsfilter. Damit stimmt der Startwert einer Prognose mit dem
 * Saldo überein, den die Konten-Seite zeigt.
 *
 * Enthält nur die übergebenen Konten — welche Konten hier landen, entscheidet
 * zugleich, welche die Simulation verfolgt (Sichtbarkeitsfilter des Aufrufers).
 */
export function startBalancesFromRows(
  accs: { id: number; initialBalance: number }[],
  txs: {
    type: "income" | "expense" | "transfer";
    accountId: number;
    toAccountId: number | null;
    amount: number;
  }[]
): Map<number, number> {
  const map = new Map<number, number>();
  for (const a of accs) map.set(a.id, a.initialBalance);
  for (const t of txs) {
    if (t.type === "transfer") {
      if (map.has(t.accountId)) {
        map.set(t.accountId, map.get(t.accountId)! - t.amount);
      }
      if (t.toAccountId !== null && map.has(t.toAccountId)) {
        map.set(t.toAccountId, map.get(t.toAccountId)! + t.amount);
      }
    } else if (map.has(t.accountId)) {
      map.set(
        t.accountId,
        map.get(t.accountId)! + (t.type === "income" ? t.amount : -t.amount)
      );
    }
  }
  return map;
}

/** Die Felder einer Dauerbuchung, die die Simulation braucht */
export interface ForecastRule {
  type: "income" | "expense" | "transfer";
  accountId: number;
  toAccountId: number | null;
  amount: number;
  categoryId: number | null;
  interval: RecurringInterval;
  nextDate: string;
  endDate: string | null;
  active: boolean;
}

export interface ForecastScenario {
  /** Skalierung der wiederkehrenden Einnahmen in % (100 = unverändert) */
  incomePct: number;
  /** Wiederkehrende Ausgaben dieser Kategorien entfallen; null = keine */
  excludedCategoryIds: Set<number> | null;
  /** Ø variable Einnahmen pro Monat (0 = nur Dauerbuchungen) */
  avgVariableIncome: number;
  /** Ø variable Ausgaben pro Monat (0 = nur Dauerbuchungen) */
  avgVariableExpense: number;
}

const NEUTRAL: ForecastScenario = {
  incomePct: 100,
  excludedCategoryIds: null,
  avgVariableIncome: 0,
  avgVariableExpense: 0,
};

export interface ForecastMonth {
  /** `YYYY-MM` */
  month: string;
  /** Saldo am Monatsende je verfolgtes Konto */
  balances: Map<number, number>;
  /** Wiederkehrende Einnahmen des Monats (inkl. Szenario-Skalierung) */
  recurringIncome: number;
  /** Wiederkehrende Ausgaben des Monats (ohne ausgeschlossene Kategorien) */
  recurringExpense: number;
  /**
   * Saldo-Effekt von Dauer-Umbuchungen mit nur EINER verfolgten Seite.
   * Umbuchungen zwischen zwei verfolgten Konten sind in der Gesamtsicht
   * neutral und bewusst nicht in recurringIncome/Expense enthalten — sie
   * sind keine Einnahmen/Ausgaben.
   */
  transferNet: number;
  /** Ø variable Einnahmen des Monats (0 ohne Szenario-Vorgabe) */
  variableIncome: number;
  /** Ø variable Ausgaben des Monats (0 ohne Szenario-Vorgabe) */
  variableExpense: number;
}

/** Netto-Saldoänderung eines Monats (Bewegung, nicht Bestand) */
export function monthDelta(m: ForecastMonth): number {
  return (
    m.recurringIncome +
    m.variableIncome -
    m.recurringExpense -
    m.variableExpense +
    m.transferNet
  );
}

/**
 * Monatliche Simulation: Index 0 des Ergebnisses ist der erste Monat NACH
 * `fromMonth`, Index n−1 der letzte. `startBalances` ist der Stand heute und
 * bleibt unberührt (es wird auf einer Kopie gerechnet).
 *
 * Verfolgt werden nur Konten, die in `startBalances` stehen — Buchungen auf
 * andere Konten wirken nur über `transferNet` auf die Gesamtsicht. Die Ø
 * variablen Beträge sind bewusst keinem Konto zugeordnet: sie sind ein
 * Durchschnitt über alle Buchungen, keine Bewegung eines bestimmten Kontos.
 */
export function simulateMonths(input: {
  startBalances: Map<number, number>;
  rules: ForecastRule[];
  fromMonth: string;
  months: number;
  scenario?: Partial<ForecastScenario>;
}): ForecastMonth[] {
  const scenario = { ...NEUTRAL, ...input.scenario };
  const balances = new Map(input.startBalances);
  const out: ForecastMonth[] = [];
  if (input.months <= 0) return out;

  const firstKey = addMonths(input.fromMonth, 1);
  const lastKey = addMonths(input.fromMonth, input.months);
  const horizonStart = monthStartISO(firstKey);
  const horizonEnd = monthEndISO(lastKey);

  // Je Regel EIN Durchlauf über den ganzen Horizont, Termine in Monats-
  // Buckets. Die früheren Kopien starteten pro Monat neu bei nextDate —
  // O(Monate²) und bei langen Horizonten still gekappt.
  const byMonth = new Map<string, ForecastRule[]>();
  for (const r of input.rules) {
    if (!r.active) continue;
    for (const date of occurrencesInRange(r, horizonStart, horizonEnd)) {
      const key = monthKey(date);
      const list = byMonth.get(key);
      if (list) list.push(r);
      else byMonth.set(key, [r]);
    }
  }

  for (let i = 1; i <= input.months; i += 1) {
    const key = addMonths(input.fromMonth, i);
    let recurringIncome = 0;
    let recurringExpense = 0;
    let transferNet = 0;

    for (const r of byMonth.get(key) ?? []) {
      if (r.type === "income") {
        // Szenario: wiederkehrende Einnahmen prozentual skalieren
        const amount = Math.round((r.amount * scenario.incomePct) / 100);
        recurringIncome += amount;
        if (balances.has(r.accountId)) {
          balances.set(r.accountId, balances.get(r.accountId)! + amount);
        }
      } else if (r.type === "expense") {
        // Szenario: Ausgaben der ausgeschlossenen Kategorie entfallen
        const excluded =
          scenario.excludedCategoryIds !== null &&
          r.categoryId !== null &&
          scenario.excludedCategoryIds.has(r.categoryId);
        if (excluded) continue;
        recurringExpense += r.amount;
        if (balances.has(r.accountId)) {
          balances.set(r.accountId, balances.get(r.accountId)! - r.amount);
        }
      } else {
        // Umbuchung: Quelle −, Ziel + (nur soweit verfolgt)
        const srcTracked = balances.has(r.accountId);
        const dstTracked =
          r.toAccountId !== null && balances.has(r.toAccountId);
        if (srcTracked) {
          balances.set(r.accountId, balances.get(r.accountId)! - r.amount);
        }
        if (dstTracked) {
          balances.set(
            r.toAccountId!,
            balances.get(r.toAccountId!)! + r.amount
          );
        }
        if (srcTracked && !dstTracked) transferNet -= r.amount;
        else if (!srcTracked && dstTracked) transferNet += r.amount;
      }
    }

    out.push({
      month: key,
      balances: new Map(balances),
      recurringIncome,
      recurringExpense,
      transferNet,
      variableIncome: scenario.avgVariableIncome,
      variableExpense: scenario.avgVariableExpense,
    });
  }
  return out;
}

export interface ForecastPeriod {
  /** Erster Monat der Periode (`YYYY-MM`) */
  startMonth: string;
  /** Letzter Monat der Periode — Stichtag der Salden (`YYYY-MM`) */
  endMonth: string;
  /** Saldo am Periodenende je verfolgtes Konto */
  balances: Map<number, number>;
  /** Summen über die Periode */
  recurringIncome: number;
  recurringExpense: number;
  transferNet: number;
  variableIncome: number;
  variableExpense: number;
}

/**
 * Monate zu Perioden zusammenfassen. Salden sind eine Bestandsgröße — der
 * letzte Monat der Periode gewinnt, es wird NICHT summiert. Flüsse sind eine
 * Bewegungsgröße und werden addiert.
 *
 * Eine angeschnittene letzte Periode entsteht nicht, solange die Anzahl
 * Monate ein Vielfaches von `size` ist (dafür rundet der Router auf).
 */
export function aggregatePeriods(
  months: ForecastMonth[],
  size: number
): ForecastPeriod[] {
  const out: ForecastPeriod[] = [];
  // Ohne Untergrenze würde die Schleife bei size <= 0 nie enden — und der
  // Server ist single-threaded (sql.js), ein Hänger blockiert alles.
  if (size < 1) return out;
  for (let start = 0; start < months.length; start += size) {
    const chunk = months.slice(start, start + size);
    const last = chunk[chunk.length - 1];
    out.push({
      startMonth: chunk[0].month,
      endMonth: last.month,
      balances: last.balances,
      recurringIncome: chunk.reduce((s, m) => s + m.recurringIncome, 0),
      recurringExpense: chunk.reduce((s, m) => s + m.recurringExpense, 0),
      transferNet: chunk.reduce((s, m) => s + m.transferNet, 0),
      variableIncome: chunk.reduce((s, m) => s + m.variableIncome, 0),
      variableExpense: chunk.reduce((s, m) => s + m.variableExpense, 0),
    });
  }
  return out;
}
