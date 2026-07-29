import { eq, inArray } from "drizzle-orm";
import { goalSources, savingsGoals } from "@db/schema";
import type { Db } from "../../queries/connection";
import type { SessionUser } from "../../context";
import { requireAccountAccess } from "../accountAccess";
import { availableForAccount, commitmentOf } from "../goalProgress";

/**
 * Sync-Infos eines 3a-Kontos: Saldo (Logik wie listAccounts, via
 * availableForAccount/accountBalances aus lib/goalProgress.ts) und die in
 * Sparzielen verplanten Anteile (commitment) samt Zielnamen.
 */
export interface Pillar3Sync {
  syncedBalance: number;
  goalCommitment: number;
  goalNames: string[];
}

/**
 * Lädt die Sync-Infos für ein mit einer 3a-Position verknüpftes Konto.
 * Erfordert „view" auf dem Konto — wirft NOT_FOUND wie requireAccountAccess.
 */
export async function pillar3AccountSync(
  db: Db,
  user: SessionUser,
  accountId: number
): Promise<Pillar3Sync> {
  await requireAccountAccess(db, user, accountId, "view");
  const availability = await availableForAccount(db, accountId);
  // Zielnamen der Quellen mit wirksamer Verpflichtung auflösen
  const sources = await db
    .select()
    .from(goalSources)
    .where(eq(goalSources.accountId, accountId));
  const committedGoalIds = sources
    .filter(s => commitmentOf(s, availability.balance) > 0)
    .map(s => s.goalId);
  let goalNames: string[] = [];
  if (committedGoalIds.length > 0) {
    const goals = await db
      .select({ id: savingsGoals.id, name: savingsGoals.name })
      .from(savingsGoals)
      .where(inArray(savingsGoals.id, committedGoalIds));
    goalNames = goals.map(g => g.name);
  }
  return {
    syncedBalance: availability.balance,
    goalCommitment: availability.committedTotal,
    goalNames,
  };
}
