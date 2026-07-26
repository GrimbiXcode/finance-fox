import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  accounts, budgets, categories, recurring, savingsGoals, transactions,
} from "@db/schema";

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
    .input(z.object({ months: z.number().int().min(1).max(36).default(12) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [accs, txs, recs] = await Promise.all([
        db.select().from(accounts),
        db.select().from(transactions),
        db.select().from(recurring),
      ]);

      // Startvermögen (Anfangsbestände)
      let base = accs.reduce((s, a) => s + a.initialBalance, 0);

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
            if (r.type === "income") recInc += r.amount;
            else recExp += r.amount;
            next = advanceDate(next, r.interval);
            guard += 1;
          }
        }
        projected += recInc + avgVarIncome - recExp - avgVarExpense;
        projection.push({
          month: addMonths(currentKey, i),
          balance: projected,
          recurringIncome: recInc,
          recurringExpense: recExp,
        });
      }

      return { history, projection, avgVariableIncome: avgVarIncome, avgVariableExpense: avgVarExpense };
    }),

  /** Budget-Hochrechnung für den laufenden Monat */
  budgetForecast: authedQuery.query(async () => {
    const db = getDb();
    const [allBudgets, txs, cats] = await Promise.all([
      db.select().from(budgets),
      db.select().from(transactions),
      db.select().from(categories),
    ]);
    const today = new Date();
    const currentKey = localISO(today).slice(0, 7);
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const dayOfMonth = today.getDate();

    return allBudgets.map((b) => {
      const spent = txs
        .filter((t) => t.type === "expense" && t.categoryId === b.categoryId && monthKey(t.date) === currentKey)
        .reduce((s, t) => s + t.amount, 0);
      const projected = dayOfMonth > 0 ? Math.round((spent / dayOfMonth) * daysInMonth) : 0;
      const cat = cats.find((c) => c.id === b.categoryId);
      return {
        categoryId: b.categoryId,
        categoryName: cat?.name ?? "Unbekannt",
        color: cat?.color ?? "#94a3b8",
        budget: b.amount,
        spent,
        projected,
        willExceed: projected > b.amount,
      };
    });
  }),

  /** Sparziel-Prognose: wann ist das Ziel bei aktueller Sparrate erreicht? */
  goalForecast: authedQuery.query(async () => {
    const db = getDb();
    const [goals, txs] = await Promise.all([
      db.select().from(savingsGoals),
      db.select().from(transactions),
    ]);
    const currentKey = localISO(new Date()).slice(0, 7);

    // Durchschnittliche monatliche Sparrate (Einnahmen - Ausgaben, letzte 3 Monate)
    let surplus = 0;
    let months = 0;
    for (let i = 1; i <= 3; i += 1) {
      const k = addMonths(currentKey, -i);
      let inc = 0;
      let exp = 0;
      let has = false;
      for (const t of txs) {
        if (t.type === "transfer" || monthKey(t.date) !== k) continue;
        has = true;
        if (t.type === "income") inc += t.amount;
        else exp += t.amount;
      }
      if (has) {
        surplus += inc - exp;
        months += 1;
      }
    }
    const monthlySurplus = months > 0 ? Math.round(surplus / months) : 0;

    return goals.map((g) => {
      const remaining = Math.max(0, g.targetAmount - g.savedAmount);
      let eta: string | null = null;
      if (remaining === 0) {
        eta = "Erreicht";
      } else if (monthlySurplus > 0) {
        const monthsNeeded = Math.ceil(remaining / monthlySurplus);
        const etaDate = new Date();
        etaDate.setMonth(etaDate.getMonth() + monthsNeeded);
        eta = localISO(etaDate).slice(0, 7);
      }
      return {
        id: g.id,
        name: g.name,
        color: g.color,
        targetAmount: g.targetAmount,
        savedAmount: g.savedAmount,
        deadline: g.deadline,
        remaining,
        monthlySurplus,
        etaMonth: eta,
      };
    });
  }),
});
