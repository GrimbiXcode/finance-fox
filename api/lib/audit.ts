import { auditLog } from "@db/schema";
import type { Db } from "../queries/connection";

/**
 * Akzeptiert sowohl den normalen Db-Handle als auch den tx-Handle aus
 * db.transaction(...) — beide bieten dasselbe insert-API, damit landet der
 * Eintrag im selben Kontext wie die fachliche Mutation.
 */
type DbLike = Pick<Db, "insert">;

/**
 * Schreibt einen Eintrag ins Aktivitäts-/Audit-Log (synchron, best effort):
 * ein Insert, das niemals Exceptions nach außen gibt — ein Fehler im Log
 * darf den fachlichen Vorgang nicht brechen.
 *
 * action-Konvention: "<entity>.<verb>", z. B. "transaction.created".
 * In Details gehören niemals Passwörter, TOTP-Codes oder Tokens.
 */
export function logAudit(
  db: DbLike,
  userId: number | null,
  action: string,
  entity: string,
  entityId?: number | null,
  detail = ""
): void {
  try {
    db.insert(auditLog)
      .values({
        userId,
        action,
        entity,
        entityId: entityId ?? null,
        detail,
        createdAt: new Date(),
      })
      .run();
  } catch (err) {
    console.error("[Finance Fox] Audit-Log-Eintrag fehlgeschlagen:", err);
  }
}

/** Betrags-Formatierung für Log-Details (Cent → dezimale Euro-Schreibweise) */
export function auditAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
