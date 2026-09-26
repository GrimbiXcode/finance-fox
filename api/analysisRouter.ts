import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb, type Db } from "./queries/connection";
import {
  budgets,
  categories,
  projects,
  recurring,
  transactionSplits,
  transactions,
} from "@db/schema";
import {
  listVisibleAccounts,
  touchesVisibleAccount,
} from "./lib/accountAccess";
import { computeBudgetStatuses } from "./lib/budgets";
import { localISO, occurrencesInRange } from "./lib/recurringSchedule";
import { shiftMonth } from "@contracts/planning";
import type { RecurringInterval } from "@contracts/types";
import type { SessionUser } from "./context";

/**
 * Auswertungen, die Fragen beantworten („Wofür geben wir im Winter mehr aus?“,
 * „Ist das Budget realistisch?“, „Was wird diesen Monat abgebucht?“).
 *
 * Alles rechnet über die für den Benutzer **sichtbaren** Konten — dieselbe
 * Regel wie `listTransactions`: Eine Buchung zählt, wenn ihr Quell- oder
 * Zielkonto sichtbar ist. Die Ergebnisse sind Aggregate in Cent; die
 * Darstellung (Monatsnamen, Farben, Sätze) macht das Frontend.
 */

const monthInput = z.string().regex(/^\d{4}-\d{2}$/, "Monat als YYYY-MM");

async function visibleData(db: Db, user: SessionUser) {
  const [accs, allTxs, cats] = await Promise.all([
    listVisibleAccounts(db, user),
    db.select().from(transactions),
    db.select().from(categories),
  ]);
  const visible = new Set(accs.map(a => a.id));
  return {
    accs,
    visible,
    txs: allTxs.filter(t => touchesVisibleAccount(visible, t)),
    cats,
  };
}

/** Monatsschlüssel von `end` rückwärts, älteste zuerst */
const monthRange = (end: string, count: number) =>
  Array.from({ length: count }, (_, i) => shiftMonth(end, i - count + 1));

/** Summe der Ausgaben einer Kategorie (inkl. Unterkategorien) je Monat */
function expensesByMonth(
  txs: { type: string; categoryId: number | null; date: string; amount: number }[],
  ids: Set<number>
) {
  const out = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== "expense" || t.categoryId === null || !ids.has(t.categoryId)) {
      continue;
    }
    const key = t.date.slice(0, 7);
    out.set(key, (out.get(key) ?? 0) + t.amount);
  }
  return out;
}

const withChildren = (
  cats: { id: number; parentId: number | null }[],
  id: number
) => new Set([id, ...cats.filter(c => c.parentId === id).map(c => c.id)]);

export const analysisRouter = createRouter({
  /**
   * Kategorie × Monat: je Kategorie (Ober- und Unterkategorien) die Summe pro
   * Monat — zeigt Saisonalität und Ausreißer. `categoryId` -1 = ohne
   * Kategorie. Oberkategorien enthalten ihre Unterkategorien.
   */
  categoryMatrix: authedQuery
    .input(
      z.object({
        months: z.number().int().min(3).max(36).default(12),
        endMonth: monthInput.optional(),
        type: z.enum(["expense", "income"]).default("expense"),
      })
    )
    .query(async ({ ctx, input }) => {
      const { txs, cats } = await visibleData(getDb(), ctx.user);
      const end = input.endMonth ?? localISO(new Date()).slice(0, 7);
      const months = monthRange(end, input.months);
      const index = new Map(months.map((m, i) => [m, i]));
      const byCat = new Map<number, number[]>();
      const add = (id: number, i: number, amount: number) => {
        const row = byCat.get(id) ?? months.map(() => 0);
        row[i] += amount;
        byCat.set(id, row);
      };
      const parentOf = new Map(cats.map(c => [c.id, c.parentId]));
      for (const t of txs) {
        if (t.type !== input.type) continue;
        const i = index.get(t.date.slice(0, 7));
        if (i === undefined) continue;
        if (t.categoryId === null) {
          add(-1, i, t.amount);
          continue;
        }
        add(t.categoryId, i, t.amount);
        const parent = parentOf.get(t.categoryId);
        if (parent !== null && parent !== undefined) add(parent, i, t.amount);
      }
      const rows = cats
        .filter(c => c.type === input.type && byCat.has(c.id))
        .map(c => ({
          categoryId: c.id,
          parentId: c.parentId,
          name: c.name,
          color: c.color,
          values: byCat.get(c.id)!,
        }));
      if (byCat.has(-1)) {
        rows.push({
          categoryId: -1,
          parentId: null,
          name: "Ohne Kategorie",
          color: "#94a3b8",
          values: byCat.get(-1)!,
        });
      }
      const summarize = (values: number[]) => {
        const total = values.reduce((s, v) => s + v, 0);
        return { total, average: Math.round(total / values.length) };
      };
      const totals = months.map((_, i) =>
        rows
          .filter(r => r.parentId === null)
          .reduce((s, r) => s + r.values[i], 0)
      );
      return {
        months,
        rows: rows
          .map(r => ({ ...r, ...summarize(r.values) }))
          .sort((a, b) => b.total - a.total),
        totals,
        ...summarize(totals),
      };
    }),

  /** Einnahmen, Ausgaben und Sparquote je Monat (Verlauf) */
  monthlyTrend: authedQuery
    .input(
      z.object({
        months: z.number().int().min(3).max(36).default(12),
        endMonth: monthInput.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { txs } = await visibleData(getDb(), ctx.user);
      const end = input.endMonth ?? localISO(new Date()).slice(0, 7);
      const months = monthRange(end, input.months);
      const rows = months.map(month => {
        let income = 0;
        let expense = 0;
        for (const t of txs) {
          if (!t.date.startsWith(month)) continue;
          if (t.type === "income") income += t.amount;
          else if (t.type === "expense") expense += t.amount;
        }
        const saved = income - expense;
        return {
          month,
          income,
          expense,
          saved,
          /** Sparquote in Prozent (null ohne Einnahmen) */
          rate: income > 0 ? Math.round((saved / income) * 100) : null,
        };
      });
      const withIncome = rows.filter(r => r.income > 0);
      const avg = (pick: (r: (typeof rows)[number]) => number) =>
        rows.length ? Math.round(rows.reduce((s, r) => s + pick(r), 0) / rows.length) : 0;
      const totalIncome = rows.reduce((s, r) => s + r.income, 0);
      const totalSaved = rows.reduce((s, r) => s + r.saved, 0);
      const byRate = [...withIncome].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
      return {
        rows,
        averageIncome: avg(r => r.income),
        averageExpense: avg(r => r.expense),
        averageRate: totalIncome > 0 ? Math.round((totalSaved / totalIncome) * 100) : null,
        best: byRate[0]?.month ?? null,
        worst: byRate[byRate.length - 1]?.month ?? null,
      };
    }),

  /**
   * Verlauf und Aufschlüsselung eines Budgets: Ausgaben der letzten Perioden
   * gegen das Limit (eingehalten?), Durchschnitt und die Verteilung der
   * laufenden Periode auf Unterkategorien.
   */
  budgetDetail: authedQuery
    .input(
      z.object({
        budgetId: z.number().int().positive(),
        periods: z.number().int().min(2).max(24).default(6),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const budget = await db.query.budgets.findFirst({
        where: eq(budgets.id, input.budgetId),
      });
      if (!budget) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Budget nicht gefunden." });
      }
      const { txs, cats } = await visibleData(db, ctx.user);
      const ids = withChildren(cats, budget.categoryId);
      const today = localISO(new Date());
      const yearly = budget.period === "yearly";
      // Perioden rückwärts, laufende zuletzt
      const periods = Array.from({ length: input.periods }, (_, i) => {
        const back = input.periods - 1 - i;
        if (yearly) {
          const y = Number(today.slice(0, 4)) - back;
          return { key: String(y), from: `${y}-01-01`, to: `${y}-12-31` };
        }
        const m = shiftMonth(today.slice(0, 7), -back);
        return { key: m, from: `${m}-01`, to: `${m}-31` };
      });
      const spentIn = (from: string, to: string) =>
        txs
          .filter(
            t =>
              t.type === "expense" &&
              t.categoryId !== null &&
              ids.has(t.categoryId) &&
              t.date >= from &&
              t.date <= to
          )
          .reduce((s, t) => s + t.amount, 0);
      const history = periods.map(p => ({
        ...p,
        spent: spentIn(p.from, p.to),
        limit: budget.amount,
        current: p === periods[periods.length - 1],
      }));
      // Abgeschlossene Perioden mit Buchungen — leere Monate vor dem ersten
      // Eintrag verfälschten Treffer-Quote und Durchschnitt
      const firstTx = txs
        .filter(t => t.type === "expense" && t.categoryId !== null && ids.has(t.categoryId))
        .reduce<string | null>((min, t) => (min === null || t.date < min ? t.date : min), null);
      const closed = history.filter(h => !h.current && firstTx !== null && h.to >= firstTx);
      const current = history[history.length - 1];
      const breakdown = new Map<number, number>();
      for (const t of txs) {
        if (
          t.type !== "expense" ||
          t.categoryId === null ||
          !ids.has(t.categoryId) ||
          t.date < current.from ||
          t.date > current.to
        ) {
          continue;
        }
        breakdown.set(t.categoryId, (breakdown.get(t.categoryId) ?? 0) + t.amount);
      }
      const catById = new Map(cats.map(c => [c.id, c]));
      return {
        budget: { id: budget.id, categoryId: budget.categoryId, period: budget.period, amount: budget.amount },
        history,
        closedCount: closed.length,
        keptCount: closed.filter(h => h.spent <= h.limit).length,
        average: closed.length
          ? Math.round(closed.reduce((s, h) => s + h.spent, 0) / closed.length)
          : null,
        breakdown: [...breakdown.entries()]
          .map(([categoryId, amount]) => ({
            categoryId,
            name: catById.get(categoryId)?.name ?? "?",
            color: catById.get(categoryId)?.color ?? null,
            amount,
          }))
          .sort((a, b) => b.amount - a.amount),
        from: current.from,
        to: current.to,
      };
    }),

  /**
   * Welcher Anteil der Ausgaben des laufenden Monats steckt in keinem Budget?
   * Monatsbudgets und Jahresbudgets decken ihre Kategorie gleichermaßen ab.
   */
  budgetCoverage: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [{ txs, cats }, statuses] = await Promise.all([
      visibleData(db, ctx.user),
      computeBudgetStatuses(db, ctx.user),
    ]);
    const month = localISO(new Date()).slice(0, 7);
    const covered = new Set<number>();
    for (const s of statuses) {
      for (const id of withChildren(cats, s.budget.categoryId)) covered.add(id);
    }
    const rootOf = new Map(cats.map(c => [c.id, c.parentId ?? c.id]));
    let total = 0;
    let uncovered = 0;
    const byRoot = new Map<number, number>();
    for (const t of txs) {
      if (t.type !== "expense" || !t.date.startsWith(month)) continue;
      total += t.amount;
      if (t.categoryId !== null && covered.has(t.categoryId)) continue;
      uncovered += t.amount;
      const root = t.categoryId === null ? -1 : (rootOf.get(t.categoryId) ?? t.categoryId);
      byRoot.set(root, (byRoot.get(root) ?? 0) + t.amount);
    }
    const catById = new Map(cats.map(c => [c.id, c]));
    return {
      month,
      total,
      uncovered,
      top: [...byRoot.entries()]
        .map(([categoryId, amount]) => ({
          categoryId,
          name: categoryId === -1 ? "Ohne Kategorie" : (catById.get(categoryId)?.name ?? "?"),
          amount,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    };
  }),

  /**
   * Monatliche Ausgaben einer Kategorie (inkl. Unterkategorien) der letzten
   * abgeschlossenen Monate — Grundlage für einen realistischen Budgetvorschlag.
   */
  categoryStats: authedQuery
    .input(z.object({ categoryId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { txs, cats } = await visibleData(getDb(), ctx.user);
      const ids = withChildren(cats, input.categoryId);
      const lastClosed = shiftMonth(localISO(new Date()).slice(0, 7), -1);
      const byMonth = expensesByMonth(txs, ids);
      const values = monthRange(lastClosed, 6).map(m => byMonth.get(m) ?? 0);
      const avg = (list: number[]) =>
        Math.round(list.reduce((s, v) => s + v, 0) / list.length);
      return {
        average3: avg(values.slice(3)),
        average6: avg(values),
        max: Math.max(...values),
        months: values,
      };
    }),

  /**
   * Fälligkeiten der Dauerbuchungen in den nächsten Tagen (aufgelöst in
   * einzelne Termine) und Konten, deren Saldo dabei unter null fiele.
   */
  upcoming: authedQuery
    .input(z.object({ days: z.number().int().min(1).max(92).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [{ accs, visible, txs }, rules] = await Promise.all([
        visibleData(db, ctx.user),
        db.select().from(recurring),
      ]);
      const today = localISO(new Date());
      const end = new Date();
      end.setDate(end.getDate() + input.days);
      const endIso = localISO(end);
      const occurrences = rules
        .filter(r => r.active && touchesVisibleAccount(visible, r))
        .flatMap(r =>
          occurrencesInRange(
            {
              interval: r.interval as RecurringInterval,
              nextDate: r.nextDate,
              endDate: r.endDate,
            },
            today,
            endIso
          ).map(date => ({
            date,
            recurringId: r.id,
            type: r.type,
            amount: r.amount,
            note: r.note,
            accountId: r.accountId,
            toAccountId: r.toAccountId,
            categoryId: r.categoryId,
          }))
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.recurringId - b.recurringId);

      // Saldoverlauf je Konto über die Termine (heutiger Saldo als Start)
      const balance = new Map<number, number>();
      for (const a of accs) balance.set(a.id, a.initialBalance);
      for (const t of txs) {
        if (t.type === "transfer") {
          if (balance.has(t.accountId)) balance.set(t.accountId, balance.get(t.accountId)! - t.amount);
          if (t.toAccountId !== null && balance.has(t.toAccountId)) {
            balance.set(t.toAccountId, balance.get(t.toAccountId)! + t.amount);
          }
        } else if (balance.has(t.accountId)) {
          balance.set(t.accountId, balance.get(t.accountId)! + (t.type === "income" ? t.amount : -t.amount));
        }
      }
      const lowest = new Map<number, { amount: number; date: string }>();
      const apply = (accountId: number, delta: number, date: string) => {
        if (!balance.has(accountId)) return;
        const next = balance.get(accountId)! + delta;
        balance.set(accountId, next);
        const low = lowest.get(accountId);
        if (!low || next < low.amount) lowest.set(accountId, { amount: next, date });
      };
      for (const o of occurrences) {
        if (o.type === "income") apply(o.accountId, o.amount, o.date);
        else if (o.type === "expense") apply(o.accountId, -o.amount, o.date);
        else {
          apply(o.accountId, -o.amount, o.date);
          if (o.toAccountId !== null) apply(o.toAccountId, o.amount, o.date);
        }
      }
      const names = new Map(accs.map(a => [a.id, a.name]));
      return {
        from: today,
        to: endIso,
        occurrences,
        expense: occurrences.filter(o => o.type === "expense").reduce((s, o) => s + o.amount, 0),
        income: occurrences.filter(o => o.type === "income").reduce((s, o) => s + o.amount, 0),
        warnings: [...lowest.entries()]
          .filter(([, low]) => low.amount < 0)
          .map(([accountId, low]) => ({
            accountId,
            accountName: names.get(accountId) ?? "?",
            lowest: low.amount,
            date: low.date,
          })),
      };
    }),

  /**
   * Zusammenfassung eines Projekts der Kostenaufteilung: Gesamtkosten,
   * Zeitraum, je Person bezahlt und getragen, Verteilung auf Kategorien.
   */
  projectSummary: authedQuery
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
      });
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Projekt nicht gefunden." });
      }
      const [{ txs, cats }, splitRows] = await Promise.all([
        visibleData(db, ctx.user),
        db.select().from(transactionSplits),
      ]);
      const own = txs.filter(t => t.projectId === project.id && t.type === "expense");
      const splitsByTx = new Map<number, { userId: number; amount: number }[]>();
      for (const s of splitRows) {
        const list = splitsByTx.get(s.transactionId) ?? [];
        list.push({ userId: s.userId, amount: s.amount });
        splitsByTx.set(s.transactionId, list);
      }
      const persons = new Map<number, { paid: number; share: number }>();
      const person = (id: number) => {
        const p = persons.get(id) ?? { paid: 0, share: 0 };
        persons.set(id, p);
        return p;
      };
      const rootOf = new Map(cats.map(c => [c.id, c.parentId ?? c.id]));
      const byCategory = new Map<number, number>();
      for (const t of own) {
        person(t.userId).paid += t.amount;
        const splits = splitsByTx.get(t.id);
        // Ohne Aufteilung trägt der Zahler die Ausgabe selbst
        if (splits && splits.length > 0) {
          for (const s of splits) person(s.userId).share += s.amount;
        } else {
          person(t.userId).share += t.amount;
        }
        const root = t.categoryId === null ? -1 : (rootOf.get(t.categoryId) ?? t.categoryId);
        byCategory.set(root, (byCategory.get(root) ?? 0) + t.amount);
      }
      const dates = own.map(t => t.date).sort();
      const catById = new Map(cats.map(c => [c.id, c]));
      return {
        project: { id: project.id, name: project.name, color: project.color },
        total: own.reduce((s, t) => s + t.amount, 0),
        count: own.length,
        from: dates[0] ?? null,
        to: dates[dates.length - 1] ?? null,
        persons: [...persons.entries()].map(([userId, p]) => ({ userId, ...p })),
        categories: [...byCategory.entries()]
          .map(([categoryId, amount]) => ({
            categoryId,
            name: categoryId === -1 ? "Ohne Kategorie" : (catById.get(categoryId)?.name ?? "?"),
            color: categoryId === -1 ? null : (catById.get(categoryId)?.color ?? null),
            amount,
          }))
          .sort((a, b) => b.amount - a.amount),
      };
    }),
});
