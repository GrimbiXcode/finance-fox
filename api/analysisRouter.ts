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
  tags,
  transactionSplits,
  transactionTags,
  transactions,
  users,
} from "@db/schema";
import {
  listVisibleAccounts,
  touchesVisibleAccount,
} from "./lib/accountAccess";
import { computeBudgetStatuses } from "./lib/budgets";
import { localISO, occurrencesInRange } from "./lib/recurringSchedule";
import { shiftMonth } from "@contracts/planning";
import { withoutReversals } from "@contracts/flows";
import { isSettlementShape } from "@contracts/settlement";
import { MONTHS_PER_INTERVAL, type RecurringInterval } from "@contracts/types";
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

/** „Meine Sicht“ (H6): optional nur Buchungen einer Person */
const personInput = z.number().int().positive().optional();
const onlyPerson = <T extends { userId: number }>(list: T[], userId: number | undefined) =>
  userId === undefined ? list : list.filter(t => t.userId === userId);

async function visibleData(db: Db, user: SessionUser) {
  const [accs, allTxs, cats] = await Promise.all([
    listVisibleAccounts(db, user),
    db.select().from(transactions),
    db.select().from(categories),
  ]);
  const visible = new Set(accs.map(a => a.id));
  const txs = allTxs.filter(t => touchesVisibleAccount(visible, t));
  return {
    accs,
    visible,
    /** Alle sichtbaren Buchungen — für Salden */
    txs,
    /** Ohne stornierte Buchungen und ihre Gegenbuchungen — für Summen */
    flows: withoutReversals(txs),
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

/** Betrag einer Dauerbuchung auf einen Monat umgerechnet (wöchentlich × 52/12) */
const monthlyOf = (amount: number, interval: RecurringInterval) =>
  interval === "weekly"
    ? Math.round((amount * 52) / 12)
    : Math.round(amount / MONTHS_PER_INTERVAL[interval]);

/** Tage zwischen zwei ISO-Daten (inklusive beider Enden) */
const daySpan = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000
  ) + 1;
const shiftDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const BREAKDOWN_DIMENSIONS = ["category", "person", "account", "tag", "project", "note"] as const;
/** Notizen gruppieren: Groß-/Kleinschreibung und Leerzeichen egal (F7) */
const normalizeNote = (note: string) => note.trim().replace(/\s+/g, " ").toLowerCase();
/** Top-Empfänger: mehr Zeilen ergäben nur einen langen Schwanz von Einzelbuchungen */
const NOTE_ROW_LIMIT = 50;

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
        userId: personInput,
      })
    )
    .query(async ({ ctx, input }) => {
      const data = await visibleData(getDb(), ctx.user);
      const txs = onlyPerson(data.flows, input.userId);
      const { cats } = data;
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
        userId: personInput,
      })
    )
    .query(async ({ ctx, input }) => {
      const txs = onlyPerson((await visibleData(getDb(), ctx.user)).flows, input.userId);
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
      const { flows: txs, cats } = await visibleData(db, ctx.user);
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
    const [{ flows: txs, cats }, statuses] = await Promise.all([
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
      const { flows: txs, cats } = await visibleData(getDb(), ctx.user);
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
      // Nur warnen, wenn ein Konto durch die Termine ins Minus kippt — ein
      // schon negatives Konto (Kreditkarte, Kontokorrent) ist kein neuer Befund
      const start = new Map(balance);
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
          .filter(([id, low]) => low.amount < 0 && (start.get(id) ?? 0) >= 0)
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
      const [{ flows: txs, cats }, splitRows] = await Promise.all([
        visibleData(db, ctx.user),
        db.select().from(transactionSplits),
      ]);
      const splitsByTx = new Map<number, { userId: number; amount: number }[]>();
      for (const s of splitRows) {
        const list = splitsByTx.get(s.transactionId) ?? [];
        list.push({ userId: s.userId, amount: s.amount });
        splitsByTx.set(s.transactionId, list);
      }
      const inProject = txs.filter(
        t => t.projectId === project.id && t.type === "expense"
      );
      // Verbuchte Ausgleiche gehören zum Projekt, sind aber keine Kosten —
      // sonst zählte der Urlaub die Rückzahlung ein zweites Mal
      const isSettled = (t: (typeof inProject)[number]) =>
        isSettlementShape({ ...t, splits: splitsByTx.get(t.id) ?? [] });
      const own = inProject.filter(t => !isSettled(t));
      const settled = inProject.filter(isSettled);
      const persons = new Map<number, { paid: number; share: number; settled: number }>();
      const person = (id: number) => {
        const p = persons.get(id) ?? { paid: 0, share: 0, settled: 0 };
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
      // Ausgleich: wer zahlt, hat danach weniger offen; wer empfängt,
      // bekommt entsprechend weniger (Vorzeichen wie in memberBalances)
      for (const t of settled) {
        person(t.userId).settled += t.amount;
        for (const sp of splitsByTx.get(t.id) ?? []) person(sp.userId).settled -= sp.amount;
      }
      const dates = own.map(t => t.date).sort();
      const catById = new Map(cats.map(c => [c.id, c]));
      return {
        project: { id: project.id, name: project.name, color: project.color },
        total: own.reduce((s, t) => s + t.amount, 0),
        count: own.length,
        settledTotal: settled.reduce((s, t) => s + t.amount, 0),
        settledCount: settled.length,
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
  /**
   * Fixkosten-Quote: Wie viel der Ausgaben ist durch Dauerbuchungen fest
   * gebunden, wo schwankt der Rest? Aktive Dauerbuchungen (nicht pausiert,
   * nicht abgelaufen) auf den Monat umgerechnet; Durchschnitte über die
   * letzten sechs abgeschlossenen Monate.
   */
  fixedCosts: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [{ visible, flows, cats }, rules] = await Promise.all([
      visibleData(db, ctx.user),
      db.select().from(recurring),
    ]);
    const today = localISO(new Date());
    const months = monthRange(shiftMonth(today.slice(0, 7), -1), 6);
    const first = months[0];
    const last = months[months.length - 1];
    const active = rules.filter(
      r =>
        r.active &&
        (r.endDate === null || r.endDate >= today) &&
        touchesVisibleAccount(visible, r)
    );
    const fixedOf = (type: "income" | "expense") =>
      active
        .filter(r => r.type === type)
        .map(r => ({
          recurringId: r.id,
          note: r.note,
          categoryId: r.categoryId,
          monthly: monthlyOf(r.amount, r.interval as RecurringInterval),
        }))
        .sort((a, b) => b.monthly - a.monthly);
    const fixedExpenses = fixedOf("expense");
    const fixedExpense = fixedExpenses.reduce((s, r) => s + r.monthly, 0);
    const fixedIncome = fixedOf("income").reduce((s, r) => s + r.monthly, 0);

    let income = 0;
    let expense = 0;
    const rootOf = new Map(cats.map(c => [c.id, c.parentId ?? c.id]));
    // Variable Ausgaben (nicht aus Dauerbuchungen) je Oberkategorie und Monat
    const variable = new Map<number, number[]>();
    const index = new Map(months.map((m, i) => [m, i]));
    for (const t of flows) {
      const key = t.date.slice(0, 7);
      if (key < first || key > last) continue;
      if (t.type === "income") income += t.amount;
      if (t.type !== "expense") continue;
      expense += t.amount;
      if (t.recurringId !== null) continue;
      const root = t.categoryId === null ? -1 : (rootOf.get(t.categoryId) ?? t.categoryId);
      const row = variable.get(root) ?? months.map(() => 0);
      row[index.get(key)!] += t.amount;
      variable.set(root, row);
    }
    // Nur Monate mit Buchungen zählen — ein Haushalt, der erst seit zwei
    // Monaten bucht, hätte sonst ein Drittel zu kleine Durchschnitte (und
    // „100 % fix“)
    const activeKeys = new Set(
      flows
        .filter(t => t.type !== "transfer" && t.date.slice(0, 7) >= first && t.date.slice(0, 7) <= last)
        .map(t => t.date.slice(0, 7))
    );
    const activeMonths = activeKeys.size || 1;
    const averageIncome = Math.round(income / activeMonths);
    const averageExpense = Math.round(expense / activeMonths);
    const activeIndex = months.map((m, i) => (activeKeys.has(m) ? i : -1)).filter(i => i >= 0);
    const catById = new Map(cats.map(c => [c.id, c]));
    return {
      from: first,
      to: last,
      fixedExpense,
      fixedIncome,
      averageIncome,
      averageExpense,
      /** Anteil der Fixkosten an den Ø-Einnahmen bzw. Ø-Ausgaben (Prozent) */
      shareOfIncome: averageIncome > 0 ? Math.round((fixedExpense / averageIncome) * 100) : null,
      shareOfExpense: averageExpense > 0 ? Math.round((fixedExpense / averageExpense) * 100) : null,
      top: fixedExpenses.slice(0, 6),
      fixedCount: fixedExpenses.length,
      variable: [...variable.entries()]
        .map(([categoryId, all]) => ({ categoryId, values: activeIndex.map(i => all[i]) }))
        .map(({ categoryId, values }) => ({
          categoryId,
          name: categoryId === -1 ? "Ohne Kategorie" : (catById.get(categoryId)?.name ?? "?"),
          color: categoryId === -1 ? null : (catById.get(categoryId)?.color ?? null),
          min: Math.min(...values),
          max: Math.max(...values),
          average: Math.round(values.reduce((s, v) => s + v, 0) / values.length),
        }))
        .filter(v => v.max > 0)
        .sort((a, b) => b.max - b.min - (a.max - a.min))
        .slice(0, 6),
    };
  }),

  /**
   * Summen nach einer frei wählbaren Dimension (Kategorie, Person, Konto,
   * Tag, Projekt) für einen Zeitraum — plus derselbe Wert im gleich langen
   * Zeitraum davor. Ohne `from`/`to` über alle Buchungen, dann ohne
   * Vergleich. Person = wer bezahlt hat (`userId`); eine Buchung mit
   * mehreren Tags zählt bei jedem Tag.
   */
  breakdown: authedQuery
    .input(
      z.object({
        dimension: z.enum(BREAKDOWN_DIMENSIONS),
        type: z.enum(["expense", "income"]).default("expense"),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        /** Vergleich: gleich langer Zeitraum direkt davor oder dieselben Tage ein Jahr früher */
        compare: z.enum(["previous", "yearAgo"]).default("previous"),
        userId: personInput,
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [{ accs, flows, cats }, tagRows, tagLinks, projectRows, userRows] =
        await Promise.all([
          visibleData(db, ctx.user),
          db.select().from(tags),
          db.select().from(transactionTags),
          db.select().from(projects),
          db.select({ id: users.id, name: users.name, color: users.color }).from(users),
        ]);
      const range = input.from && input.to ? { from: input.from, to: input.to } : null;
      // Dieselben Tage ein Jahr früher; ein Zeitraum bis zum 28.02. reicht
      // im Schaltjahr davor bis zum 29.02.
      const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const yearAgo = (iso: string, end: boolean) => {
        const y = Number(iso.slice(0, 4)) - 1;
        const md = iso.slice(5);
        if (md === "02-29") return `${y}-02-28`;
        if (end && md === "02-28" && isLeap(y)) return `${y}-02-29`;
        return `${y}-${md}`;
      };
      // Länger als ein Jahr: der Vorjahreszeitraum überlappte den eigenen —
      // dann gleich lang davor
      const compare =
        range && input.compare === "yearAgo" && daySpan(range.from, range.to) > 366
          ? "previous"
          : input.compare;
      const previous = range
        ? compare === "yearAgo"
          ? { from: yearAgo(range.from, false), to: yearAgo(range.to, true) }
          : (() => {
              const len = daySpan(range.from, range.to);
              return { from: shiftDays(range.from, -len), to: shiftDays(range.from, -1) };
            })()
        : null;
      const tagsOf = new Map<number, number[]>();
      for (const l of tagLinks) {
        tagsOf.set(l.transactionId, [...(tagsOf.get(l.transactionId) ?? []), l.tagId]);
      }
      const rootOf = new Map(cats.map(c => [c.id, c.parentId ?? c.id]));
      // Notizen bekommen laufende Nummern als Schlüssel; angezeigt wird die
      // häufigste Schreibweise
      const noteIds = new Map<string, number>();
      const noteSpellings = new Map<number, Map<string, number>>();
      const noteKey = (note: string) => {
        const norm = normalizeNote(note);
        if (!norm) return -1;
        let id = noteIds.get(norm);
        if (id === undefined) {
          id = noteIds.size + 1;
          noteIds.set(norm, id);
        }
        const spellings = noteSpellings.get(id) ?? new Map<string, number>();
        const shown = note.trim().replace(/\s+/g, " ");
        spellings.set(shown, (spellings.get(shown) ?? 0) + 1);
        noteSpellings.set(id, spellings);
        return id;
      };
      const keysOf = (t: (typeof flows)[number]): number[] => {
        switch (input.dimension) {
          case "note":
            return [noteKey(t.note)];
          case "category":
            return [t.categoryId === null ? -1 : (rootOf.get(t.categoryId) ?? t.categoryId)];
          case "person":
            return [t.userId];
          case "account":
            return [t.accountId];
          case "tag": {
            const list = tagsOf.get(t.id);
            return list && list.length > 0 ? list : [-1];
          }
          case "project":
            return [t.projectId ?? -1];
        }
      };
      const sums = new Map<number, { amount: number; count: number; previous: number }>();
      const entry = (key: number) => {
        const e = sums.get(key) ?? { amount: 0, count: 0, previous: 0 };
        sums.set(key, e);
        return e;
      };
      let total = 0;
      let previousTotal = 0;
      for (const t of onlyPerson(flows, input.userId)) {
        if (t.type !== input.type) continue;
        const inRange = !range || (t.date >= range.from && t.date <= range.to);
        const inPrevious = previous !== null && t.date >= previous.from && t.date <= previous.to;
        if (!inRange && !inPrevious) continue;
        if (inRange) total += t.amount;
        else previousTotal += t.amount;
        for (const key of keysOf(t)) {
          const e = entry(key);
          if (inRange) {
            e.amount += t.amount;
            e.count += 1;
          } else {
            e.previous += t.amount;
          }
        }
      }
      const catById = new Map(cats.map(c => [c.id, c]));
      const accById = new Map(accs.map(a => [a.id, a]));
      const labelOf = (key: number): { name: string; color: string | null } => {
        const none = { category: "Ohne Kategorie", tag: "Ohne Tag", project: "Ohne Projekt", note: "Ohne Notiz" } as Record<string, string>;
        if (key === -1) return { name: none[input.dimension] ?? "—", color: null };
        switch (input.dimension) {
          case "note": {
            const spellings = [...(noteSpellings.get(key)?.entries() ?? [])];
            spellings.sort((a, b) => b[1] - a[1]);
            return { name: spellings[0]?.[0] ?? "?", color: null };
          }
          case "category":
            return { name: catById.get(key)?.name ?? "?", color: catById.get(key)?.color ?? null };
          case "person": {
            const u = userRows.find(x => x.id === key);
            return { name: u?.name ?? "?", color: u?.color ?? null };
          }
          case "account":
            return { name: accById.get(key)?.name ?? "?", color: null };
          case "tag": {
            const tag = tagRows.find(x => x.id === key);
            return { name: tag?.name ?? "?", color: tag?.color ?? null };
          }
          case "project": {
            const p = projectRows.find(x => x.id === key);
            return { name: p?.name ?? "?", color: p?.color ?? null };
          }
        }
      };
      return {
        range,
        previousRange: previous,
        total,
        previousTotal,
        rows: [...sums.entries()]
          .map(([key, e]) => ({ key, ...labelOf(key), ...e }))
          .filter(r => r.amount > 0 || r.previous > 0)
          .sort((a, b) => b.amount - a.amount || b.previous - a.previous)
          .slice(0, input.dimension === "note" ? NOTE_ROW_LIMIT : undefined),
      };
    }),
});
