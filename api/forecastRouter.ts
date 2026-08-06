import { z } from "zod";
import { FORECAST_GRANULARITIES } from "@contracts/types";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  accounts, categories, goalContributions, goalSources,
  mortgageAmortizations, mortgageTranches, properties, recurring,
  savingsGoals, transactions,
} from "@db/schema";
import { mortgageDebtProjection } from "./lib/mortgage/portfolio";
import {
  requireAccountAccess, touchesVisibleAccount, visibleAccountIds,
} from "./lib/accountAccess";
import { computeBudgetStatuses } from "./lib/budgets";
import { progressFromBalances } from "./lib/goalProgress";
import { localISO } from "./lib/recurringSchedule";
import {
  addMonths, aggregatePeriods, monthDelta, monthEndISO, monthKey,
  monthsPerPeriod, simulateMonths, startBalancesFromRows,
} from "./lib/forecastEngine";

/** Szenario-Eingaben, die `balance` und `table` gleich interpretieren */
const scenarioInput = {
  // incomePct: Skalierung der wiederkehrenden Einnahmen in Prozent
  // (100 = unverändert, 110 = +10 %).
  incomePct: z.number().int().min(50).max(200).optional(),
  // excludeCategoryId: wiederkehrende Ausgaben dieser Oberkategorie
  // (inkl. ihrer Unterkategorien) entfallen im Szenario.
  excludeCategoryId: z.number().int().optional(),
};

/** Oberkategorie inkl. Unterkategorien als Menge (null = kein Ausschluss) */
async function excludedCategories(
  db: ReturnType<typeof getDb>,
  excludeCategoryId: number | undefined
): Promise<Set<number> | null> {
  if (excludeCategoryId === undefined) return null;
  const allCats = await db.select().from(categories);
  const ids = new Set([excludeCategoryId]);
  for (const c of allCats) {
    if (c.parentId === excludeCategoryId) ids.add(c.id);
  }
  return ids;
}

/**
 * Ø variable Ein-/Ausgaben pro Monat: Durchschnitt der letzten 3 Monate mit
 * Buchungen, Buchungen aus Dauerbuchungen herausgerechnet (die stecken schon
 * in der Simulation).
 */
function averageVariable(
  txs: {
    type: "income" | "expense" | "transfer";
    date: string;
    amount: number;
    recurringId: number | null;
  }[],
  recurringIds: Set<number>,
  currentKey: string
): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  let countedMonths = 0;
  for (let i = 1; i <= 3; i += 1) {
    const k = addMonths(currentKey, -i);
    let inc = 0;
    let exp = 0;
    let has = false;
    for (const t of txs) {
      if (t.type === "transfer" || monthKey(t.date) !== k) continue;
      has = true;
      // variabel = ohne Dauerbuchungen
      if (t.recurringId && recurringIds.has(t.recurringId)) continue;
      if (t.type === "income") inc += t.amount;
      else exp += t.amount;
    }
    if (has) {
      income += inc;
      expense += exp;
      countedMonths += 1;
    }
  }
  return {
    income: countedMonths > 0 ? Math.round(income / countedMonths) : 0,
    expense: countedMonths > 0 ? Math.round(expense / countedMonths) : 0,
  };
}

/**
 * Sparziel-Quellen je Ziel, gruppiert und auf sichtbare Konten reduziert —
 * einmal statt einmal pro Ziel (die Liste ist haushaltsweit).
 */
function visibleSourcesByGoal<T extends { goalId: number; accountId: number }>(
  sources: T[],
  visible: Set<number>
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const s of sources) {
    if (!visible.has(s.accountId)) continue;
    const list = map.get(s.goalId);
    if (list) list.push(s);
    else map.set(s.goalId, [s]);
  }
  return map;
}

/** Anzahl Quellen je Ziel — ungefiltert, für den Hinweis „verborgene Quellen" */
function sourceCountByGoal(sources: { goalId: number }[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const s of sources) {
    map.set(s.goalId, (map.get(s.goalId) ?? 0) + 1);
  }
  return map;
}

/** Summe der Alt-Beiträge je Ziel */
function contributionsByGoal(
  contribs: { goalId: number; amount: number }[]
): Map<number, number> {
  const map = new Map<number, number>();
  for (const c of contribs) {
    map.set(c.goalId, (map.get(c.goalId) ?? 0) + c.amount);
  }
  return map;
}

/** Dauerbuchungen, die auf mindestens ein sichtbares Konto wirken */
function visibleRules<
  T extends { accountId: number; toAccountId: number | null },
>(rows: T[], visible: Set<number>): T[] {
  // Dauer-Umbuchungen mit nur einer sichtbaren Seite wirken auf den Saldo
  // und dürfen daher nicht herausgefiltert werden.
  return rows.filter(
    r =>
      visible.has(r.accountId) ||
      (r.toAccountId !== null && visible.has(r.toAccountId))
  );
}

export const forecastRouter = createRouter({
  /**
   * Kontostand-Prognose: historischer Gesamtsaldo (6 Monate zurück)
   * + Projektion (n Monate voraus) auf Basis wiederkehrender Buchungen
   * + Durchschnitt der variablen Ausgaben/Einnahmen der letzten 3 Monate.
   */
  balance: authedQuery
    .input(z.object({
      months: z.number().int().min(1).max(36).default(12),
      // Szenario-Planung (optional): wirkt NUR auf zukünftige, wiederkehrende
      // Größen — Historie, Ist-Buchungen und die variablen Durchschnitte
      // bleiben unverändert.
      ...scenarioInput,
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const visible = await visibleAccountIds(db, ctx.user);
      const [allAccs, allTxs, allRecs, propertyRows, trancheRows, amortRows] =
        await Promise.all([
          db.select().from(accounts),
          db.select().from(transactions),
          db.select().from(recurring),
          // Hypotheken sind haushaltsweit — sie werden nicht gefiltert
          db.select().from(properties),
          db.select().from(mortgageTranches),
          db.select().from(mortgageAmortizations),
        ]);
      // Nur sichtbare Konten/Buchungen in die Prognose einbeziehen
      const accs = allAccs.filter((a) => visible.has(a.id));
      const txs = allTxs.filter((t) => touchesVisibleAccount(visible, t));
      const recs = visibleRules(allRecs, visible);

      // Wirksame Szenario-Parameter: Einnahmen-Skalierung (100 = aus) und
      // Menge der ausgeschlossenen Kategorien (Oberkategorie + Unterkategorien)
      const incomePct = input.incomePct ?? 100;
      const excludedCatIds = await excludedCategories(
        db,
        input.excludeCategoryId
      );

      // Startvermögen (Anfangsbestände)
      const base = accs.reduce((s, a) => s + a.initialBalance, 0);

      // Monatliche Historie aufbauen
      const today = localISO(new Date());
      const currentKey = monthKey(today);
      const monthly = new Map<string, { income: number; expense: number }>();
      const ensure = (k: string) => {
        if (!monthly.has(k)) monthly.set(k, { income: 0, expense: 0 });
        return monthly.get(k)!;
      };
      for (const t of txs) {
        if (t.type === "transfer") continue;
        const bucket = ensure(monthKey(t.date));
        if (t.type === "income") bucket.income += t.amount;
        else bucket.expense += t.amount;
      }

      // Historie: Saldo zum Monatsende, 6 Monate zurück
      const history: { month: string; balance: number }[] = [];
      let running = base;
      const sortedKeys = [...monthly.keys()].sort();
      const startKey = addMonths(currentKey, -6);
      // Alle Monate vor startKey aufaddieren
      for (const k of sortedKeys) {
        if (k < startKey) {
          const b = monthly.get(k)!;
          running += b.income - b.expense;
        }
      }
      for (let i = -6; i <= 0; i += 1) {
        const k = addMonths(currentKey, i);
        const b = monthly.get(k);
        if (b) running += b.income - b.expense;
        history.push({ month: k, balance: running });
      }

      // Variable Anteile: Durchschnitt der letzten 3 vollständigen Monate
      const avgVar = averageVariable(
        txs,
        new Set(recs.map((r) => r.id)),
        currentKey
      );

      // Netto-Vermögen: Verkehrswert der Liegenschaften minus simulierte
      // Restschuld je Monat.
      //
      // Kein Doppelzählen, weil jeder Hypotheken-Geldfluss genau einmal
      // wirkt: Zins ist eine Ausgabe (Vermögen sinkt), direkte Amortisation
      // senkt Saldo UND Schuld (neutral), indirekte Amortisation ist eine
      // Umbuchung zwischen zwei sichtbaren Konten (saldo-neutral) und lässt
      // die Schuld in der Engine bewusst unverändert.
      const mortgage =
        propertyRows.length > 0
          ? mortgageDebtProjection(
              propertyRows,
              trancheRows,
              amortRows,
              input.months,
              new Date(),
              new Set(allRecs.map(r => r.id))
            )
          : null;

      // Projektion: wiederkehrende Buchungen + variable Durchschnitte.
      // Sie setzt bewusst auf `running` (Monatsend-Historie) auf, nicht auf
      // die Summe der Kontosalden — so bleibt der Anschlusspunkt der Kurve
      // identisch mit dem letzten Ist-Wert.
      const simulated = simulateMonths({
        startBalances: startBalancesFromRows(accs, txs),
        rules: recs,
        fromMonth: currentKey,
        months: input.months,
        scenario: {
          incomePct,
          excludedCategoryIds: excludedCatIds,
          avgVariableIncome: avgVar.income,
          avgVariableExpense: avgVar.expense,
        },
      });
      const projection: {
        month: string; balance: number; recurringIncome: number; recurringExpense: number;
      }[] = [];
      let projected = running;
      for (const m of simulated) {
        projected += monthDelta(m);
        projection.push({
          month: m.month,
          balance: projected,
          recurringIncome: m.recurringIncome,
          recurringExpense: m.recurringExpense,
        });
      }

      // Nettovermögens-Reihe parallel zur Projektion (null ohne Liegenschaft).
      // Der Verkehrswert wird bewusst konstant fortgeschrieben — eine
      // Wertentwicklung wäre geraten, nicht gerechnet.
      const netWorth = mortgage
        ? projection.map((p, i) => ({
            month: p.month,
            value: p.balance + mortgage.propertyValue - mortgage.debtByMonth[i + 1],
          }))
        : null;

      return {
        history,
        projection,
        netWorth,
        netWorthNow: mortgage
          ? running + mortgage.propertyValue - mortgage.debtByMonth[0]
          : null,
        // Posten ohne Dauerbuchung fehlen in der Projektion — das UI weist
        // darauf hin, statt ein zu optimistisches Vermögen zu zeigen
        mortgageMissingRecurring: mortgage?.missingRecurringCount ?? 0,
        avgVariableIncome: avgVar.income,
        avgVariableExpense: avgVar.expense,
        // Wirksame Szenario-Parameter — das Frontend zeigt damit an,
        // ob ein Szenario aktiv ist
        scenario: {
          incomePct,
          excludeCategoryId: input.excludeCategoryId ?? null,
        },
      };
    }),

  /**
   * Prognose-Tabelle: Kontosalden, Sparziel-Fortschritt, Ein-/Ausgaben und
   * Nettovermögen je Periode — Horizont (bis 120 Monate) und
   * Aggregationsgröße (Monat/Quartal/Halbjahr/Jahr) sind frei wählbar.
   *
   * Salden sind eine Bestandsgröße: der Wert einer Spalte ist der Stand am
   * ENDE der Periode. Ein-/Ausgaben sind Bewegungsgrößen und werden über die
   * Periode summiert.
   *
   * `includeVariable` schaltet den Ø der variablen Buchungen zu. Er wirkt
   * bewusst nur auf Gesamt- und Nettovermögens-Zeile, nicht auf einzelne
   * Konten — ein Durchschnitt über alle Buchungen ist keinem Konto zuordenbar.
   */
  table: authedQuery
    .input(z.object({
      months: z.number().int().min(1).max(120).default(60),
      granularity: z.enum(FORECAST_GRANULARITIES).default("semiannual"),
      includeVariable: z.boolean().default(false),
      ...scenarioInput,
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const visible = await visibleAccountIds(db, ctx.user);
      const [
        allAccs, allTxs, allRecs, goals, allSources, allContribs,
        propertyRows, trancheRows, amortRows,
      ] = await Promise.all([
        db.select().from(accounts),
        db.select().from(transactions),
        db.select().from(recurring),
        db.select().from(savingsGoals),
        db.select().from(goalSources),
        db.select().from(goalContributions),
        db.select().from(properties),
        db.select().from(mortgageTranches),
        db.select().from(mortgageAmortizations),
      ]);
      const accs = allAccs.filter(a => visible.has(a.id));
      const txs = allTxs.filter(t => touchesVisibleAccount(visible, t));
      const recs = visibleRules(allRecs, visible);

      const incomePct = input.incomePct ?? 100;
      const excludedCatIds = await excludedCategories(
        db,
        input.excludeCategoryId
      );
      const currentKey = monthKey(localISO(new Date()));
      const avgVar = averageVariable(
        txs,
        new Set(recs.map(r => r.id)),
        currentKey
      );

      // Horizont auf ein Vielfaches der Periodengröße aufrunden, damit keine
      // angeschnittene letzte Spalte entsteht
      const size = monthsPerPeriod(input.granularity);
      const months = Math.ceil(input.months / size) * size;

      const startBalances = startBalancesFromRows(accs, txs);
      const periods = aggregatePeriods(
        simulateMonths({
          startBalances,
          rules: recs,
          fromMonth: currentKey,
          months,
          scenario: {
            incomePct,
            excludedCategoryIds: excludedCatIds,
            avgVariableIncome: input.includeVariable ? avgVar.income : 0,
            avgVariableExpense: input.includeVariable ? avgVar.expense : 0,
          },
        }),
        size
      );

      const accountRows = accs.map(a => ({
        accountId: a.id,
        name: a.name,
        bankId: a.bankId,
        current: startBalances.get(a.id) ?? 0,
        values: periods.map(p => p.balances.get(a.id) ?? 0),
      }));

      // Gesamt = Summe der verfolgten Kontosalden. Der Ø variable Anteil
      // steckt in keinem Konto und wird kumuliert dazugerechnet;
      // `transferNet` NICHT — einseitige Umbuchungen sind in den
      // Kontosalden bereits enthalten.
      const sumOf = (balances: Map<number, number>): number => {
        let sum = 0;
        for (const v of balances.values()) sum += v;
        return sum;
      };
      const totalCurrent = sumOf(startBalances);
      const totalValues: number[] = [];
      let cumVariable = 0;
      for (const p of periods) {
        cumVariable += p.variableIncome - p.variableExpense;
        totalValues.push(sumOf(p.balances) + cumVariable);
      }

      const mortgage =
        propertyRows.length > 0
          ? mortgageDebtProjection(
              propertyRows,
              trancheRows,
              amortRows,
              months,
              new Date(),
              new Set(allRecs.map(r => r.id))
            )
          : null;
      // Verkehrswert konstant fortgeschrieben (wie in `balance`)
      const netWorth = mortgage
        ? {
            current:
              totalCurrent + mortgage.propertyValue - mortgage.debtByMonth[0],
            values: totalValues.map(
              (v, i) =>
                v +
                mortgage.propertyValue -
                mortgage.debtByMonth[(i + 1) * size]
            ),
          }
        : null;

      const contribSum = contributionsByGoal(allContribs);
      const sourcesByGoal = visibleSourcesByGoal(allSources, visible);
      const totalSources = sourceCountByGoal(allSources);
      const goalRows = goals.map(g => {
        const shown = sourcesByGoal.get(g.id) ?? [];
        // Alt-Bestand (manuelle Basis + Beiträge) bleibt über den Horizont
        // konstant — er wächst nicht aus Dauerbuchungen
        const legacy = g.savedAmount + (contribSum.get(g.id) ?? 0);
        const current = progressFromBalances(shown, legacy, startBalances);
        const values = periods.map(p =>
          progressFromBalances(shown, legacy, p.balances)
        );
        // Offene Ziele (targetAmount NULL) haben keinen Zielbetrag — sie
        // liefern den prognostizierten Stand, aber kein Erreichen
        const target = g.targetAmount;
        const reachedNow = target !== null && current >= target;
        // Erreicht das Ziel heute schon, markiert die „Heute"-Spalte das —
        // dann darf nicht zusätzlich die erste Periode markiert werden, sonst
        // liest es sich als „hier wird es erreicht".
        const firstReached =
          target === null || reachedNow
            ? -1
            : values.findIndex(v => v >= target);
        return {
          goalId: g.id,
          name: g.name,
          color: g.color,
          targetAmount: g.targetAmount,
          deadline: g.deadline,
          current,
          values,
          reachedNow,
          reachedIndex: firstReached === -1 ? null : firstReached,
          hasHiddenSources: (totalSources.get(g.id) ?? 0) > shown.length,
        };
      });

      return {
        periods: periods.map(p => ({
          startMonth: p.startMonth,
          endMonth: p.endMonth,
        })),
        accounts: accountRows,
        total: { current: totalCurrent, values: totalValues },
        flows: {
          income: periods.map(p => p.recurringIncome + p.variableIncome),
          expense: periods.map(p => p.recurringExpense + p.variableExpense),
          transferNet: periods.map(p => p.transferNet),
        },
        netWorth,
        mortgageMissingRecurring: mortgage?.missingRecurringCount ?? 0,
        goals: goalRows,
        avgVariableIncome: avgVar.income,
        avgVariableExpense: avgVar.expense,
        includeVariable: input.includeVariable,
        // Effektiver Horizont (aufgerundet) und Größe für die Anzeige
        months,
        granularity: input.granularity,
        scenario: {
          incomePct,
          excludeCategoryId: input.excludeCategoryId ?? null,
        },
      };
    }),

  /**
   * Saldo-Prognose eines einzelnen Kontos (Monatsendwerte) — Fortsetzung des
   * Saldo-Verlaufs auf der Konten-Seite. Bewusst nur Dauerbuchungen: ein Ø
   * variabler Buchungen ist keinem einzelnen Konto zuordenbar.
   */
  accountBalance: authedQuery
    .input(z.object({
      accountId: z.number().int().positive(),
      months: z.number().int().min(1).max(36).default(12),
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      // Wirft NOT_FOUND bei fehlender Sichtbarkeit (kein Leak privater Konten)
      const account = await requireAccountAccess(
        db,
        ctx.user,
        input.accountId,
        "view"
      );
      const [allTxs, allRecs] = await Promise.all([
        db.select().from(transactions),
        db.select().from(recurring),
      ]);
      const startBalances = startBalancesFromRows([account], allTxs);
      const rules = allRecs.filter(
        r => r.accountId === account.id || r.toAccountId === account.id
      );
      return simulateMonths({
        startBalances,
        rules,
        fromMonth: monthKey(localISO(new Date())),
        months: input.months,
      }).map(m => ({
        month: m.month,
        // Stichtag als Datum, damit die Punkte an den Ist-Verlauf anschließen
        date: monthEndISO(m.month),
        balance: m.balances.get(account.id) ?? 0,
      }));
    }),

  /**
   * Budget-Hochrechnung für den laufenden Zeitraum (Monat bzw. Jahr).
   * Nutzt dieselbe Auswertung wie listBudgetStatus (api/lib/budgets.ts):
   * Ausgaben inkl. Unterkategorien, effektives Limit inkl. Rollover.
   */
  budgetForecast: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [statuses, cats] = await Promise.all([
      computeBudgetStatuses(db, ctx.user),
      db.select().from(categories),
    ]);
    const today = new Date();
    // Hochrechnung linear auf das Periodenende
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const dayOfYear = Math.floor(
      (today.getTime() - startOfYear.getTime()) / 86_400_000,
    ) + 1;
    // Schaltjahr: 29. Februar existiert
    const daysInYear =
      new Date(today.getFullYear(), 1, 29).getDate() === 29 ? 366 : 365;
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const dayOfMonth = today.getDate();

    return statuses.map((s) => {
      const yearly = s.budget.period === "yearly";
      const elapsed = yearly ? dayOfYear : dayOfMonth;
      const total = yearly ? daysInYear : daysInMonth;
      const projected = elapsed > 0 ? Math.round((s.spent / elapsed) * total) : 0;
      const cat = cats.find((c) => c.id === s.budget.categoryId);
      return {
        categoryId: s.budget.categoryId,
        categoryName: cat?.name ?? "Unbekannt",
        color: cat?.color ?? "#94a3b8",
        period: s.budget.period,
        budget: s.effectiveLimit,
        spent: s.spent,
        projected,
        willExceed: projected > s.effectiveLimit,
      };
    });
  }),

  /**
   * Sparziel-Prognose (Sparziele 2.0): monatliche Simulation (max. 120
   * Monate) — die Salden der mit den Zielen verknüpften Konten werden mit
   * den wiederkehrenden Buchungen fortgeschrieben (gemeinsame Engine mit der
   * Saldo-Prognose inkl. Sichtbarkeitsfilter), die Fortschrittsformel aus
   * api/lib/goalProgress.ts je Monat angewendet. ETA = erster Monat mit
   * Fortschritt ≥ Zielbetrag (null, wenn in 120 Monaten nicht erreicht);
   * monthlyRate = durchschnittliche monatliche Fortschrittsänderung der
   * nächsten 3 simulierten Monate. Offene Ziele (targetAmount NULL) liefern
   * remaining/etaMonth = null, aber weiterhin total und monthlyRate.
   */
  goalForecast: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const visible = await visibleAccountIds(db, ctx.user);
    const [goals, allAccs, allTxs, allRecs, allSources, allContribs] =
      await Promise.all([
        db.select().from(savingsGoals),
        db.select().from(accounts),
        db.select().from(transactions),
        db.select().from(recurring),
        db.select().from(goalSources),
        db.select().from(goalContributions),
      ]);

    const accs = allAccs.filter(a => visible.has(a.id));
    const txs = allTxs.filter(t => touchesVisibleAccount(visible, t));
    const startBalances = startBalancesFromRows(accs, txs);
    const recs = visibleRules(allRecs, visible);

    const MAX_MONTHS = 120;
    const currentKey = monthKey(localISO(new Date()));
    const simulated = simulateMonths({
      startBalances,
      rules: recs,
      fromMonth: currentKey,
      months: MAX_MONTHS,
    });

    const contribSum = contributionsByGoal(allContribs);
    // Nur Quellen mit sichtbarem Konto; Alt-Bestand konstant
    const sourcesByGoal = visibleSourcesByGoal(allSources, visible);

    return goals.map(g => {
      const shown = sourcesByGoal.get(g.id) ?? [];
      const legacy = g.savedAmount + (contribSum.get(g.id) ?? 0);
      // totals[i] = Fortschritt nach i simulierten Monaten (Index 0 = heute)
      const totals = [
        progressFromBalances(shown, legacy, startBalances),
        ...simulated.map(m => progressFromBalances(shown, legacy, m.balances)),
      ];
      const total = totals[0];
      // Offene Ziele (targetAmount NULL): kein Rest/ETA, nur der Fortschritt
      const remaining =
        g.targetAmount !== null ? Math.max(0, g.targetAmount - total) : null;
      let etaMonth: string | null = null;
      if (g.targetAmount !== null && remaining! > 0) {
        for (let i = 1; i <= MAX_MONTHS; i += 1) {
          if (totals[i] >= g.targetAmount) {
            etaMonth = addMonths(currentKey, i);
            break;
          }
        }
      }
      // Durchschnittliche monatliche Fortschrittsänderung der nächsten
      // 3 simulierten Monate (für die Anzeige „+x pro Monat")
      const monthlyRate = Math.round((totals[3] - totals[0]) / 3);
      return {
        goalId: g.id,
        name: g.name,
        color: g.color,
        targetAmount: g.targetAmount,
        deadline: g.deadline,
        total,
        remaining,
        etaMonth,
        monthlyRate,
      };
    });
  }),
});
