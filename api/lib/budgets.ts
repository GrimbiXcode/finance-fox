import { budgets, categories, transactions } from "@db/schema";
import { touchesVisibleAccount, visibleAccountIds } from "./accountAccess";
import type { Db } from "../queries/connection";
import type { SessionUser } from "../context";

type BudgetRow = typeof budgets.$inferSelect;

const pad2 = (n: number) => String(n).padStart(2, "0");

const toISO = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Zeitraum-Grenzen (inklusive, als YYYY-MM-DD) für ein Budget um `now` */
export function budgetPeriodRange(
  period: "monthly" | "yearly",
  now: Date
): { from: string; to: string } {
  const y = now.getFullYear();
  if (period === "yearly") {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  const m = pad2(now.getMonth() + 1);
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${pad2(lastDay)}` };
}

/** Aktuelle Auswertung eines Budgets (geteilt von finance- und forecastRouter) */
export interface BudgetStatus {
  budget: BudgetRow;
  /** Ausgaben im aktuellen Zeitraum (Kategorie + alle Unterkategorien) */
  spent: number;
  /** Limit inkl. Übertrag aus Vormonaten (Rollover), sonst = amount */
  effectiveLimit: number;
  /** effectiveLimit − spent (negativ = überschritten) */
  remaining: number;
  /** spent / effectiveLimit in Prozent (0, wenn kein Limit) */
  percent: number;
}

/**
 * Rollover-Rechnung (nur period = "monthly"): Das effektive Limit im
 * laufenden Monat ist das aufsummierte Monatsbudget seit dem Anker abzüglich
 * der Ausgaben in den abgelaufenen Monaten seit dem Anker (mindestens 0).
 *
 * Festlegungen (bewusst einfach gehalten):
 * - Anker = 1. Januar des laufenden Jahres bzw. der createdAt-Monat, je
 *   nachdem, was später liegt. createdAt NULL (Bestandsbudgets) → Jahresanfang.
 * - Die Ausgaben des laufenden Monats werden NICHT abgezogen — sie stecken in
 *   `spent`; so bleibt remaining = effectiveLimit − spent ohne Doppelzählung.
 */
function rolloverLimit(
  budget: BudgetRow,
  categoryIds: Set<number>,
  txs: { categoryId: number | null; date: string; amount: number }[],
  now: Date
): number {
  const yearStart = new Date(now.getFullYear(), 0, 1);
  let anchor = yearStart;
  if (budget.createdAt) {
    const createdMonthStart = new Date(
      budget.createdAt.getFullYear(),
      budget.createdAt.getMonth(),
      1
    );
    if (createdMonthStart > anchor) anchor = createdMonthStart;
  }
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (anchor > currentMonthStart) anchor = currentMonthStart;

  const months =
    (currentMonthStart.getFullYear() - anchor.getFullYear()) * 12 +
    (currentMonthStart.getMonth() - anchor.getMonth()) +
    1;

  const anchorISO = toISO(anchor);
  const periodFromISO = toISO(currentMonthStart);
  let spentBefore = 0;
  for (const t of txs) {
    if (
      t.categoryId !== null &&
      categoryIds.has(t.categoryId) &&
      t.date >= anchorISO &&
      t.date < periodFromISO
    ) {
      spentBefore += t.amount;
    }
  }
  return Math.max(0, budget.amount * months - spentBefore);
}

/**
 * Wertet alle Budgets für den aktuellen Zeitraum aus. Berücksichtigt nur
 * Buchungen auf für `user` sichtbaren Konten (Sichtbarkeitsfilter).
 */
export async function computeBudgetStatuses(
  db: Db,
  user: SessionUser,
  now = new Date()
): Promise<BudgetStatus[]> {
  const [visible, allBudgets, allCats, allTxs] = await Promise.all([
    visibleAccountIds(db, user),
    db.select().from(budgets),
    db.select().from(categories),
    db.select().from(transactions),
  ]);
  const txs = allTxs.filter(
    t => t.type === "expense" && touchesVisibleAccount(visible, t)
  );

  // Ausgaben einer Budget-Kategorie = Kategorie + alle ihre Unterkategorien
  const childrenByParent = new Map<number, number[]>();
  for (const c of allCats) {
    if (c.parentId !== null) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c.id);
      childrenByParent.set(c.parentId, list);
    }
  }

  return allBudgets.map(budget => {
    const ids = new Set([
      budget.categoryId,
      ...(childrenByParent.get(budget.categoryId) ?? []),
    ]);
    const { from, to } = budgetPeriodRange(budget.period, now);
    let spent = 0;
    for (const t of txs) {
      if (
        t.categoryId !== null &&
        ids.has(t.categoryId) &&
        t.date >= from &&
        t.date <= to
      ) {
        spent += t.amount;
      }
    }
    // Rollover nur bei Monatsbudgets relevant; Jahresbudgets haben mit dem
    // Kalenderjahr ohnehin einen eigenen Übertragungs-Zeitraum.
    const effectiveLimit =
      budget.period === "monthly" && budget.rollover
        ? rolloverLimit(budget, ids, txs, now)
        : budget.amount;
    return {
      budget,
      spent,
      effectiveLimit,
      remaining: effectiveLimit - spent,
      percent:
        effectiveLimit > 0 ? Math.round((spent / effectiveLimit) * 100) : 0,
    };
  });
}
