import { z } from "zod";
import { desc } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  categories,
  goalSources,
  recurring,
  transactionSplits,
  transactions,
  users,
} from "@db/schema";
import {
  listVisibleAccounts,
  touchesVisibleAccount,
} from "./lib/accountAccess";
import { computeBudgetStatuses } from "./lib/budgets";
import { localISO } from "./lib/recurringSchedule";
import { computeSettlements, memberBalances } from "@contracts/settlement";
import {
  budgetPace,
  periodElapsed,
  requiredMonthlyRate,
  shiftMonth,
} from "@contracts/planning";
import { forecastRouter } from "./forecastRouter";
import { insuranceRouter } from "./insuranceRouter";
import { mortgageRouter } from "./mortgageRouter";
import type { MortgageWarning } from "./lib/mortgage/scheduleCh";
import type { InsuranceGap } from "./lib/insurance/gaps";

/**
 * Dashboard: Aggregate statt Rohdaten.
 *
 * Bisher lud das Dashboard (wie jede Seite über `useFinanceData`) sämtliche
 * Buchungen und rechnete im Browser. `summary` liefert genau die Zahlen des
 * gewählten Monats; `attention` sammelt, was Aufmerksamkeit braucht, aus den
 * Modulen — als strukturierte Daten, die Sätze baut erst das Frontend
 * (`src/lib/attention.ts`, Muster `MortgageWarning`/`InsuranceGap`).
 *
 * Beide laufen im Service Worker genauso wie auf dem Server (keine
 * Server-Geheimnisse, kein Netzzugriff).
 */

const monthInput = z.string().regex(/^\d{4}-\d{2}$/, "Monat als YYYY-MM");

type Totals = { income: number; expense: number };

/** Hinweise, die Aufmerksamkeit brauchen (Dashboard „Was ansteht“) */
export type AttentionItem =
  | {
      kind: "budget_over" | "budget_fast";
      severity: "bad" | "warn";
      budgetId: number;
      categoryId: number;
      categoryName: string;
      period: "monthly" | "yearly";
      spent: number;
      limit: number;
      /** Betrag über dem zeitanteiligen Plan (nur budget_fast) */
      aheadOfPlan: number;
    }
  | {
      kind: "recurring_due";
      severity: "info";
      count: number;
      expense: number;
      income: number;
      firstDate: string;
      days: number;
    }
  | {
      kind: "settlement";
      severity: "info";
      fromId: number;
      toId: number;
      amount: number;
    }
  | {
      kind: "negative_cash";
      severity: "bad";
      accountId: number;
      accountName: string;
      balance: number;
    }
  | {
      kind: "goal_behind";
      severity: "warn";
      goalId: number;
      name: string;
      deadline: string;
      required: number;
      current: number;
    }
  | {
      kind: "mortgage";
      severity: "warn";
      propertyId: number;
      propertyName: string;
      warning: MortgageWarning;
    }
  | {
      kind: "mortgage_missing_recurring";
      severity: "info";
      count: number;
    }
  | {
      kind: "insurance";
      severity: "warn";
      gap: InsuranceGap;
    }
  | {
      kind: "section_failed";
      severity: "warn";
      area: string;
      message: string;
    };

/** Einrichtungs-Hinweise der Hypothek gehören ins Modul, nicht aufs Dashboard */
const MORTGAGE_SETUP_WARNINGS = new Set(["no_market_value", "no_income"]);

/** Vorlauf der Fälligkeits-Vorschau für Dauerbuchungen */
const RECURRING_DAYS = 7;

export const dashboardRouter = createRouter({
  /** Kennzahlen eines Monats inklusive Vergleich zu Vormonat und Vorjahr */
  summary: authedQuery
    .input(
      z.object({
        month: monthInput,
        /**
         * Heutiges Datum des Geräts (YYYY-MM-DD). Der Server läuft oft in
         * UTC — am Monatsende entschiede sonst seine Uhr, welcher Monat
         * „der laufende“ ist.
         */
        today: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [accs, allTxs, cats, userRows, splitRows] = await Promise.all([
        listVisibleAccounts(db, ctx.user),
        db
          .select()
          .from(transactions)
          .orderBy(desc(transactions.date), desc(transactions.id)),
        db.select().from(categories),
        db.select({ id: users.id }).from(users),
        db.select().from(transactionSplits),
      ]);
      const visible = new Set(accs.map(a => a.id));
      const txs = allTxs.filter(t => touchesVisibleAccount(visible, t));
      const today = input.today ?? localISO(new Date());
      const currentMonth = today.slice(0, 7);
      const month = input.month;
      const isCurrent = month >= currentMonth;

      const totalsOf = (key: string): Totals => {
        const totals = { income: 0, expense: 0 };
        for (const t of txs) {
          if (!t.date.startsWith(key)) continue;
          if (t.type === "income") totals.income += t.amount;
          else if (t.type === "expense") totals.expense += t.amount;
        }
        return totals;
      };

      /** Summe der sichtbaren Konten bis einschließlich `until` */
      const balanceUntil = (until: string | null) => {
        let total = accs.reduce((s, a) => s + a.initialBalance, 0);
        for (const t of txs) {
          if (until !== null && t.date > until) continue;
          if (t.type === "transfer") {
            if (visible.has(t.accountId)) total -= t.amount;
            if (t.toAccountId !== null && visible.has(t.toAccountId)) {
              total += t.amount;
            }
          } else if (visible.has(t.accountId)) {
            total += t.type === "income" ? t.amount : -t.amount;
          }
        }
        return total;
      };
      const monthEnd = (key: string) => `${key}-31`;

      const prevMonth = shiftMonth(month, -1);
      const prevYearMonth = shiftMonth(month, -12);

      // Ausgaben nach Oberkategorie (-1 = ohne Kategorie)
      const rootOf = new Map(cats.map(c => [c.id, c.parentId ?? c.id]));
      const byRoot = new Map<number, number>();
      for (const t of txs) {
        if (t.type !== "expense" || !t.date.startsWith(month)) continue;
        const root =
          t.categoryId === null
            ? -1
            : (rootOf.get(t.categoryId) ?? t.categoryId);
        byRoot.set(root, (byRoot.get(root) ?? 0) + t.amount);
      }
      const catById = new Map(cats.map(c => [c.id, c]));
      const categoryBreakdown = [...byRoot.entries()]
        .map(([id, amount]) => ({
          categoryId: id,
          name: id === -1 ? "Ohne Kategorie" : (catById.get(id)?.name ?? "?"),
          color: id === -1 ? null : (catById.get(id)?.color ?? null),
          amount,
        }))
        .sort((a, b) => b.amount - a.amount);

      const splitsByTx = new Map<
        number,
        { userId: number; amount: number }[]
      >();
      for (const s of splitRows) {
        const list = splitsByTx.get(s.transactionId) ?? [];
        list.push({ userId: s.userId, amount: s.amount });
        splitsByTx.set(s.transactionId, list);
      }
      const shared = txs
        .filter(t => splitsByTx.has(t.id))
        .map(t => ({ ...t, splits: splitsByTx.get(t.id)! }));
      const balances = memberBalances(
        shared,
        userRows.map(u => u.id)
      );

      const recentSource = isCurrent
        ? txs
        : txs.filter(t => t.date.startsWith(month));
      const recent = recentSource.slice(0, 8).map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        date: t.date,
        note: t.note,
        categoryId: t.categoryId,
        userId: t.userId,
        shared: splitsByTx.has(t.id),
      }));

      return {
        month,
        isCurrent,
        accountCount: accs.length,
        totals: {
          current: totalsOf(month),
          previous: totalsOf(prevMonth),
          previousYear: totalsOf(prevYearMonth),
        },
        balance: {
          // Laufender Monat: alles, auch vordatierte Buchungen (wie die
          // Kontenseite); vergangene Monate: Stand am Monatsende
          current: isCurrent
            ? balanceUntil(null)
            : balanceUntil(monthEnd(month)),
          previous: balanceUntil(monthEnd(prevMonth)),
          previousYear: balanceUntil(monthEnd(prevYearMonth)),
        },
        cashflow: Array.from({ length: 6 }, (_, i) =>
          shiftMonth(month, i - 5)
        ).map(key => ({ month: key, ...totalsOf(key) })),
        categories: categoryBreakdown,
        recent,
        memberBalances: [...balances.entries()].map(([userId, amount]) => ({
          userId,
          amount,
        })),
      };
    }),

  /** Was Aufmerksamkeit braucht — sortiert nach Schwere */
  attention: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const now = new Date();
    const today = localISO(now);
    const items: AttentionItem[] = [];
    /**
     * Ein Modul, das scheitert (z. B. eine Liegenschaft mit unbekanntem
     * Land), darf nicht die ganze Liste kippen — sonst stünde auf dem
     * Dashboard fälschlich „Alles im grünen Bereich“. Der Fehler wird als
     * eigener Hinweis gemeldet.
     */
    const section = async (area: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (err) {
        items.push({
          kind: "section_failed",
          severity: "warn",
          area,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const [accs, allTxs, recurringRows, cats, userRows, splitRows] =
      await Promise.all([
        listVisibleAccounts(db, ctx.user),
        db.select().from(transactions),
        db.select().from(recurring),
        db.select().from(categories),
        db.select({ id: users.id }).from(users),
        db.select().from(transactionSplits),
      ]);
    const visible = new Set(accs.map(a => a.id));
    const txs = allTxs.filter(t => touchesVisibleAccount(visible, t));

    // Budgets: überschritten oder zu schnell unterwegs
    const catName = new Map(cats.map(c => [c.id, c.name]));
    for (const s of await computeBudgetStatuses(db, ctx.user, now)) {
      const period = s.budget.period === "yearly" ? "yearly" : "monthly";
      const elapsed = periodElapsed(period, today);
      const pace = budgetPace(s.spent, s.effectiveLimit, elapsed);
      if (pace === "ok") continue;
      items.push({
        kind: pace === "over" ? "budget_over" : "budget_fast",
        severity: pace === "over" ? "bad" : "warn",
        budgetId: s.budget.id,
        categoryId: s.budget.categoryId,
        categoryName: catName.get(s.budget.categoryId) ?? "?",
        period,
        spent: s.spent,
        limit: s.effectiveLimit,
        aheadOfPlan: Math.max(
          0,
          s.spent - Math.round(s.effectiveLimit * elapsed)
        ),
      });
    }

    // Bargeld im Minus: fast immer eine vergessene Abhebung
    for (const a of accs) {
      if (a.type !== "cash") continue;
      let balance = a.initialBalance;
      for (const t of txs) {
        if (t.type === "transfer") {
          if (t.accountId === a.id) balance -= t.amount;
          if (t.toAccountId === a.id) balance += t.amount;
        } else if (t.accountId === a.id) {
          balance += t.type === "income" ? t.amount : -t.amount;
        }
      }
      if (balance < 0) {
        items.push({
          kind: "negative_cash",
          severity: "bad",
          accountId: a.id,
          accountName: a.name,
          balance,
        });
      }
    }

    // Dauerbuchungen der nächsten Tage
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + RECURRING_DAYS);
    const horizonIso = localISO(horizon);
    // nextDate bleibt nach dem letzten Lauf auf dem ersten Termin hinter dem
    // Enddatum stehen — solche Regeln verbucht der Cron-Job nie mehr
    const due = recurringRows.filter(
      r =>
        r.active &&
        (r.endDate === null || r.nextDate <= r.endDate) &&
        r.nextDate <= horizonIso &&
        touchesVisibleAccount(visible, r)
    );
    if (due.length > 0) {
      items.push({
        kind: "recurring_due",
        severity: "info",
        count: due.length,
        expense: due
          .filter(r => r.type === "expense")
          .reduce((s, r) => s + r.amount, 0),
        income: due
          .filter(r => r.type === "income")
          .reduce((s, r) => s + r.amount, 0),
        firstDate: due.map(r => r.nextDate).sort()[0],
        days: RECURRING_DAYS,
      });
    }

    // Offene Ausgleichszahlungen aus geteilten Ausgaben
    const splitsByTx = new Map<number, { userId: number; amount: number }[]>();
    for (const s of splitRows) {
      const list = splitsByTx.get(s.transactionId) ?? [];
      list.push({ userId: s.userId, amount: s.amount });
      splitsByTx.set(s.transactionId, list);
    }
    const shared = txs
      .filter(t => splitsByTx.has(t.id))
      .map(t => ({ ...t, splits: splitsByTx.get(t.id)! }));
    for (const s of computeSettlements(
      shared,
      userRows.map(u => u.id)
    )) {
      if (s.amount < 100) continue; // Kleinstbeträge unter 1.00 nicht melden
      items.push({ kind: "settlement", severity: "info", ...s });
    }

    // Sparziele mit Stichtag, die mit den Dauerbuchungen nicht reichen.
    // Ziele mit Quellen auf Konten, die ich nicht sehe, auslassen — deren
    // Stand wäre zu niedrig und die „nötige Rate“ damit falsch.
    await section("Sparziele", async () => {
      const sources = await db.select().from(goalSources);
      const hidden = new Set(
        sources.filter(s => !visible.has(s.accountId)).map(s => s.goalId)
      );
      const forecast = forecastRouter.createCaller(ctx);
      for (const g of await forecast.goalForecast()) {
        if (hidden.has(g.goalId)) continue;
        if (!g.deadline || g.targetAmount === null || !g.remaining) continue;
        if (g.etaMonth && g.etaMonth <= g.deadline.slice(0, 7)) continue;
        const required = requiredMonthlyRate(g.remaining, g.deadline, today);
        if (required === null) continue;
        items.push({
          kind: "goal_behind",
          severity: "warn",
          goalId: g.goalId,
          name: g.name,
          deadline: g.deadline,
          required,
          current: Math.max(0, g.monthlyRate),
        });
      }
    });

    // Hypotheken: fachliche Hinweise (ohne Einrichtungs-Hinweise)
    await section("Hypotheken", async () => {
      const mortgage = mortgageRouter.createCaller(ctx);
      for (const p of await mortgage.listProperties()) {
        const schedule = await mortgage.forecast({
          propertyId: p.id,
          months: 12,
        });
        for (const w of schedule.warnings) {
          if (MORTGAGE_SETUP_WARNINGS.has(w.kind)) continue;
          items.push({
            kind: "mortgage",
            severity: "warn",
            propertyId: p.id,
            propertyName: p.name,
            warning: w,
          });
        }
      }
      const mortgageSummary = await mortgage.summary();
      if (mortgageSummary.missingRecurringCount > 0) {
        items.push({
          kind: "mortgage_missing_recurring",
          severity: "info",
          count: mortgageSummary.missingRecurringCount,
        });
      }
    });

    // Versicherungen: nur dringende, nicht ausgeblendete Hinweise
    await section("Versicherungen", async () => {
      const insurance = insuranceRouter.createCaller(ctx);
      for (const gap of (await insurance.gapAnalysis()).gaps) {
        if (gap.severity !== "warn") continue;
        items.push({ kind: "insurance", severity: "warn", gap });
      }
    });

    const rank = { bad: 0, warn: 1, info: 2 } as const;
    return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }),
});
