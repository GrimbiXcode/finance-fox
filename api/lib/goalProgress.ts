import { eq, inArray } from "drizzle-orm";
import {
  accounts,
  goalContributions,
  goalSources,
  savingsGoals,
  transactions,
} from "@db/schema";
import type { Db } from "../queries/connection";
import type { SessionUser } from "../context";
import { visibleAccountIds } from "./accountAccess";

/**
 * Zentrale Fortschrittslogik der Sparziele (Sparziele 2.0).
 * Gesamtfortschritt = Summe der Quellen-Beträge (aus den Kontoständen der
 * verknüpften Konten) + savedAmount (manuelle Basis, Alt-Bestand) + Summe
 * der Beiträge (Alt-Bestand). Wird von finance.listGoals,
 * forecast.goalForecast und den Meilenstein-Benachrichtigungen geteilt —
 * letztere rechnen ungefiltert (user null = Haushalts-Gesamtwert).
 */

type GoalRow = typeof savingsGoals.$inferSelect;
export type GoalSourceMode = "full" | "absolute" | "percent";

/** Fortschrittsbeitrag einer Quelle nach Modus (Saldo in Cent) */
export function sourceAmount(
  mode: GoalSourceMode,
  value: number | null,
  balance: number
): number {
  const base = Math.max(0, balance);
  if (mode === "full") return base;
  if (mode === "absolute") return Math.min(value ?? 0, base);
  return Math.round((base * (value ?? 0)) / 100); // percent
}

/**
 * Kontostände wie in listAccounts: Anfangsbestand + Einnahmen − Ausgaben,
 * Umbuchungen quell-/zielseitig. Liefert nur die angefragten Konten.
 */
export async function accountBalances(
  db: Db,
  accountIds: number[]
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (accountIds.length === 0) return map;
  const [accs, txs] = await Promise.all([
    db
      .select({ id: accounts.id, initialBalance: accounts.initialBalance })
      .from(accounts)
      .where(inArray(accounts.id, accountIds)),
    db
      .select({
        type: transactions.type,
        accountId: transactions.accountId,
        toAccountId: transactions.toAccountId,
        amount: transactions.amount,
      })
      .from(transactions),
  ]);
  for (const a of accs) map.set(a.id, a.initialBalance);
  for (const t of txs) {
    if (t.type === "transfer") {
      if (map.has(t.accountId))
        map.set(t.accountId, map.get(t.accountId)! - t.amount);
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

export interface GoalSourceProgress {
  kind: "account" | "legacy";
  sourceId?: number;
  accountId?: number;
  accountName?: string;
  mode?: GoalSourceMode;
  value?: number | null;
  amount: number;
}

export interface GoalProgress {
  total: number;
  sources: GoalSourceProgress[];
  hasHiddenSources: boolean;
}

/**
 * Fortschritt eines Sparziels. `user null` = ungefilterte Systemperspektive
 * (für Benachrichtigungen); sonst zählen nur Quellen, deren Konten der
 * Nutzer sehen darf — verborgene Quellen werden über hasHiddenSources
 * signalisiert, ohne Beträge oder Namen zu leaken.
 */
export async function computeGoalProgress(
  db: Db,
  user: SessionUser | null,
  goal: GoalRow
): Promise<GoalProgress> {
  const [sources, contribs, accs] = await Promise.all([
    db.select().from(goalSources).where(eq(goalSources.goalId, goal.id)),
    db
      .select({ amount: goalContributions.amount })
      .from(goalContributions)
      .where(eq(goalContributions.goalId, goal.id)),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts),
  ]);
  const visible = user ? await visibleAccountIds(db, user) : null;
  const accountName = new Map(accs.map(a => [a.id, a.name]));
  const relevant = sources.filter(s => !visible || visible.has(s.accountId));
  const balances = await accountBalances(
    db,
    relevant.map(s => s.accountId)
  );

  const out: GoalSourceProgress[] = [];
  let total = 0;
  for (const s of relevant) {
    const amount = sourceAmount(
      s.mode,
      s.value,
      balances.get(s.accountId) ?? 0
    );
    total += amount;
    out.push({
      kind: "account",
      sourceId: s.id,
      accountId: s.accountId,
      accountName: accountName.get(s.accountId) ?? "Konto",
      mode: s.mode,
      value: s.value,
      amount,
    });
  }
  // Alt-Bestand: manuelle Basis + Beiträge als schreibgeschützte Quelle
  const legacy = goal.savedAmount + contribs.reduce((s, c) => s + c.amount, 0);
  if (legacy > 0) {
    total += legacy;
    out.push({ kind: "legacy", amount: legacy });
  }
  return {
    total,
    sources: out,
    hasHiddenSources:
      visible !== null && sources.some(s => !visible.has(s.accountId)),
  };
}
