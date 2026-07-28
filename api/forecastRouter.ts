import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  accounts, categories, goalContributions, goalSources, recurring,
  savingsGoals, transactions,
} from "@db/schema";
import {
  touchesVisibleAccount, visibleAccountIds,
} from "./lib/accountAccess";
import { computeBudgetStatuses } from "./lib/budgets";
import { sourceAmount } from "./lib/goalProgress";

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function advanceDate(dateISO: string, interval: "weekly" | "monthly" | "yearly"): string {
  const d = new Date(`${dateISO}T12:00:00`);
  if (interval === "weekly") d.setDate(d.getDate() + 7);
  else if (interval === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return localISO(d);
}

function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7);
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
      // incomePct: Skalierung der wiederkehrenden Einnahmen in Prozent
      // (100 = unverändert, 110 = +10 %).
      // excludeCategoryId: wiederkehrende Ausgaben dieser Oberkategorie
      // (inkl. ihrer Unterkategorien) entfallen im Szenario.
      incomePct: z.number().int().min(50).max(200).optional(),
      excludeCategoryId: z.number().int().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const visible = await visibleAccountIds(db, ctx.user);
      const [allAccs, allTxs, allRecs] = await Promise.all([
        db.select().from(accounts),
        db.select().from(transactions),
        db.select().from(recurring),
      ]);
      // Nur sichtbare Konten/Buchungen in die Prognose einbeziehen
      const accs = allAccs.filter((a) => visible.has(a.id));
      const txs = allTxs.filter((t) => touchesVisibleAccount(visible, t));
      // Dauer-Umbuchungen mit nur einer sichtbaren Seite wirken auf den Saldo
      // (s. Projektion unten) und dürfen daher nicht herausgefiltert werden.
      const recs = allRecs.filter((r) => visible.has(r.accountId)
        || (r.toAccountId !== null && visible.has(r.toAccountId)));

      // Wirksame Szenario-Parameter: Einnahmen-Skalierung (100 = aus) und
      // Menge der ausgeschlossenen Kategorien (Oberkategorie + Unterkategorien)
      const incomePct = input.incomePct ?? 100;
      let excludedCatIds: Set<number> | null = null;
      if (input.excludeCategoryId !== undefined) {
        const allCats = await db.select().from(categories);
        excludedCatIds = new Set([input.excludeCategoryId]);
        for (const c of allCats) {
          if (c.parentId === input.excludeCategoryId) excludedCatIds.add(c.id);
        }
      }

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
      // (Buchungen aus Dauerbuchungen werden herausgerechnet)
      const recById = new Map(recs.map((r) => [r.id, r]));
      let varIncome = 0;
      let varExpense = 0;
      let countedMonths = 0;
      for (let i = 1; i <= 3; i += 1) {
        const k = addMonths(currentKey, -i);
        let inc = 0;
        let exp = 0;
        let has = false;
        for (const t of txs) {
          if (t.type === "transfer" || monthKey(t.date) !== k) continue;
          has = true;
          if (t.recurringId && recById.has(t.recurringId)) continue; // variabel = ohne Dauerbuchungen
          if (t.type === "income") inc += t.amount;
          else exp += t.amount;
        }
        if (has) {
          varIncome += inc;
          varExpense += exp;
          countedMonths += 1;
        }
      }
      const avgVarIncome = countedMonths > 0 ? Math.round(varIncome / countedMonths) : 0;
      const avgVarExpense = countedMonths > 0 ? Math.round(varExpense / countedMonths) : 0;

      // Projektion: wiederkehrende Buchungen + variable Durchschnitte
      const projection: {
        month: string; balance: number; recurringIncome: number; recurringExpense: number;
      }[] = [];
      let projected = running;
      for (let i = 1; i <= input.months; i += 1) {
        const monthStart = `${addMonths(currentKey, i)}-01`;
        const monthEndDate = new Date(`${addMonths(currentKey, i + 1)}-01T12:00:00`);
        monthEndDate.setDate(0);
        const monthEnd = localISO(monthEndDate);

        let recInc = 0;
        let recExp = 0;
        // Netto-Saldo-Effekt von Dauer-Umbuchungen, getrennt von Einnahmen/
        // Ausgaben, damit diese Anzeigen nicht verfälscht werden
        let recTransferNet = 0;
        for (const r of recs) {
          if (!r.active) continue;
          let next = r.nextDate;
          // Auf Monatsanfang vorspulen
          let guard = 0;
          while (next < monthStart && guard < 1000) {
            next = advanceDate(next, r.interval);
            guard += 1;
          }
          while (next <= monthEnd && guard < 1000) {
            if (r.type === "income") {
              // Szenario: wiederkehrende Einnahmen prozentual skalieren
              recInc += Math.round((r.amount * incomePct) / 100);
            } else if (r.type === "expense") {
              // Szenario: Ausgaben der ausgeschlossenen Kategorie entfallen
              if (excludedCatIds === null || r.categoryId === null
                || !excludedCatIds.has(r.categoryId)) {
                recExp += r.amount;
              }
            } else {
              // Umbuchung: zwischen zwei sichtbaren Konten saldo-neutral
              // (Gesamtsicht). Ist nur eine Seite sichtbar, wirkt sie als
              // Abfluss (Quelle sichtbar) bzw. Zufluss (Ziel sichtbar) —
              // bewusst nicht in recurringIncome/Expense, da es sich nicht
              // um Einnahmen/Ausgaben handelt.
              const srcVisible = visible.has(r.accountId);
              const dstVisible = r.toAccountId !== null
                && visible.has(r.toAccountId);
              if (srcVisible && !dstVisible) recTransferNet -= r.amount;
              else if (!srcVisible && dstVisible) recTransferNet += r.amount;
            }
            next = advanceDate(next, r.interval);
            guard += 1;
          }
        }
        projected += recInc + avgVarIncome - recExp - avgVarExpense + recTransferNet;
        projection.push({
          month: addMonths(currentKey, i),
          balance: projected,
          recurringIncome: recInc,
          recurringExpense: recExp,
        });
      }

      return {
        history,
        projection,
        avgVariableIncome: avgVarIncome,
        avgVariableExpense: avgVarExpense,
        // Wirksame Szenario-Parameter — das Frontend zeigt damit an,
        // ob ein Szenario aktiv ist
        scenario: {
          incomePct,
          excludeCategoryId: input.excludeCategoryId ?? null,
        },
      };
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
   * den wiederkehrenden Buchungen fortgeschrieben (Vorgehen wie bei der
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

    // Start-Salden der sichtbaren Konten (Logik wie listAccounts)
    const balances = new Map<number, number>();
    for (const a of allAccs) {
      if (visible.has(a.id)) balances.set(a.id, a.initialBalance);
    }
    for (const t of allTxs) {
      if (t.type === "transfer") {
        if (balances.has(t.accountId)) {
          balances.set(t.accountId, balances.get(t.accountId)! - t.amount);
        }
        if (t.toAccountId !== null && balances.has(t.toAccountId)) {
          balances.set(t.toAccountId, balances.get(t.toAccountId)! + t.amount);
        }
      } else if (balances.has(t.accountId)) {
        balances.set(
          t.accountId,
          balances.get(t.accountId)! + (t.type === "income" ? t.amount : -t.amount)
        );
      }
    }

    // Dauerbuchungen: wie bei der Saldo-Prognose — eine sichtbare Seite
    // (Quelle ODER Ziel) genügt für die Berücksichtigung
    const recs = allRecs.filter(
      r =>
        r.active &&
        (visible.has(r.accountId) ||
          (r.toAccountId !== null && visible.has(r.toAccountId)))
    );
    const sourcesByGoal = new Map<number, typeof allSources>();
    for (const s of allSources) {
      const list = sourcesByGoal.get(s.goalId) ?? [];
      list.push(s);
      sourcesByGoal.set(s.goalId, list);
    }
    const contribSum = new Map<number, number>();
    for (const c of allContribs) {
      contribSum.set(c.goalId, (contribSum.get(c.goalId) ?? 0) + c.amount);
    }

    // Fortschritt eines Ziels aus einem Saldo-Stand: nur Quellen mit
    // sichtbarem Konto, Alt-Bestand (savedAmount + Beiträge) konstant
    const progressOf = (
      goalId: number,
      savedAmount: number,
      bals: Map<number, number>
    ) => {
      let total = savedAmount + (contribSum.get(goalId) ?? 0);
      for (const s of sourcesByGoal.get(goalId) ?? []) {
        if (!visible.has(s.accountId)) continue;
        total += sourceAmount(s.mode, s.value, bals.get(s.accountId) ?? 0);
      }
      return total;
    };

    const MAX_MONTHS = 120;
    const currentKey = monthKey(localISO(new Date()));
    // totals[i] = Fortschritt nach i simulierten Monaten (Index 0 = heute)
    const totalsByGoal = new Map<number, number[]>();
    for (const g of goals) {
      totalsByGoal.set(g.id, [progressOf(g.id, g.savedAmount, balances)]);
    }

    for (let i = 1; i <= MAX_MONTHS; i += 1) {
      const monthStart = `${addMonths(currentKey, i)}-01`;
      const monthEndDate = new Date(`${addMonths(currentKey, i + 1)}-01T12:00:00`);
      monthEndDate.setDate(0);
      const monthEnd = localISO(monthEndDate);
      for (const r of recs) {
        // Auf Monatsanfang vorspulen, dann alle Fälligkeiten im Monat buchen
        let next = r.nextDate;
        let guard = 0;
        while (next < monthStart && guard < 1000) {
          next = advanceDate(next, r.interval);
          guard += 1;
        }
        while (next <= monthEnd && guard < 1000) {
          if (r.type === "income") {
            if (balances.has(r.accountId)) {
              balances.set(r.accountId, balances.get(r.accountId)! + r.amount);
            }
          } else if (r.type === "expense") {
            if (balances.has(r.accountId)) {
              balances.set(r.accountId, balances.get(r.accountId)! - r.amount);
            }
          } else {
            // Umbuchung: Quelle −, Ziel + (nur soweit sichtbar/verfolgt)
            if (balances.has(r.accountId)) {
              balances.set(r.accountId, balances.get(r.accountId)! - r.amount);
            }
            if (r.toAccountId !== null && balances.has(r.toAccountId)) {
              balances.set(
                r.toAccountId,
                balances.get(r.toAccountId)! + r.amount
              );
            }
          }
          next = advanceDate(next, r.interval);
          guard += 1;
        }
      }
      for (const g of goals) {
        totalsByGoal.get(g.id)!.push(progressOf(g.id, g.savedAmount, balances));
      }
    }

    return goals.map(g => {
      const totals = totalsByGoal.get(g.id)!;
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
