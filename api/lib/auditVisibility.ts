import type { SessionUser } from "../context";

/**
 * Welche Einträge des Aktivitäten-Logs darf ein Mitglied sehen?
 *
 * Das Log schreibt Details mit Beträgen und Notizen („Ausgabe 89.90 am … —
 * Geschenk“, „Lohn ab 2026-01-01: 812300“). Bis Version 1.31 sah jedes
 * Mitglied alle Einträge — auch die zur **privaten** Vorsorge anderer und zu
 * Buchungen auf fremden Privatkonten. Die Regeln hier folgen denselben
 * Sichtbarkeiten wie der Rest der App:
 *
 * - Vorsorge ist strikt privat: nur eigene Einträge. Ausnahme ist die
 *   Ehepartner-Verknüpfung — sie betrifft die Rentenrechnung des Partners,
 *   und ihr Eintrag enthält keine Zahlen.
 * - Buchungen: sichtbar, wenn die Buchung ein sichtbares Konto berührt.
 *   Gelöschte Buchungen lassen sich nicht mehr zuordnen — die sehen nur
 *   Urheber und Admins (Admins sehen Privatkonten ohnehin lesend).
 * - Importe (`transaction.imported`) tragen die Konto-ID: sichtbar mit dem
 *   Konto.
 * - Konten: sichtbar mit dem Konto; gelöschte nur Urheber und Admins.
 * - Dauerbuchungen: sichtbar, wenn die Regel ein sichtbares Konto berührt;
 *   gelöschte und ältere Anlage-Einträge ohne ID nur Urheber und Admins.
 * - Sparziel-Quellen („Konto „Privat Sam“ verknüpft“): das Detail nennt den
 *   Kontonamen — sichtbar nur, wenn ein sichtbares Konto so heißt, sonst nur
 *   Urheber und Admins. Die übrigen Sparziel-Einträge sind haushaltsweit.
 * - Alles andere (Kategorien, Budgets, Hypotheken, Versicherungen,
 *   Einstellungen, Anmeldungen) ist haushaltsweit.
 */
export interface AuditRowLike {
  userId: number | null;
  action: string;
  entity: string;
  entityId: number | null;
  detail?: string;
}

export interface AuditVisibilityContext {
  user: SessionUser;
  visibleAccountIds: Set<number>;
  /** Existierende Buchungen: ID → Quell-/Zielkonto */
  transactions: Map<number, { accountId: number; toAccountId: number | null }>;
  /** IDs aller existierenden Konten (sichtbar oder nicht) */
  existingAccountIds: Set<number>;
  /** Existierende Dauerbuchungen: ID → Quell-/Zielkonto */
  recurring: Map<number, { accountId: number; toAccountId: number | null }>;
  /** Namen der sichtbaren Konten (Sparziel-Quellen stehen nur im Detail) */
  visibleAccountNames: Set<string>;
}

/** Kontoname aus „Konto „Name“ (modus)“ */
const accountNameInDetail = (detail: string | undefined) =>
  /Konto „(.*)“/.exec(detail ?? "")?.[1] ?? null;

export function isAuditRowVisible(
  row: AuditRowLike,
  ctx: AuditVisibilityContext
): boolean {
  const own = row.userId === ctx.user.id;
  const privileged = own || ctx.user.role === "admin";
  switch (row.entity) {
    case "pension":
      return own || row.action.startsWith("pension.partner.");
    case "transaction": {
      if (row.entityId === null) return privileged;
      if (row.action === "transaction.imported") {
        return ctx.visibleAccountIds.has(row.entityId) || privileged;
      }
      const tx = ctx.transactions.get(row.entityId);
      if (!tx) return privileged;
      return (
        ctx.visibleAccountIds.has(tx.accountId) ||
        (tx.toAccountId !== null && ctx.visibleAccountIds.has(tx.toAccountId))
      );
    }
    case "account": {
      if (row.entityId === null) return privileged;
      if (!ctx.existingAccountIds.has(row.entityId)) return privileged;
      return ctx.visibleAccountIds.has(row.entityId);
    }
    case "recurring": {
      const rule = row.entityId === null ? undefined : ctx.recurring.get(row.entityId);
      if (!rule) return privileged;
      return (
        ctx.visibleAccountIds.has(rule.accountId) ||
        (rule.toAccountId !== null && ctx.visibleAccountIds.has(rule.toAccountId))
      );
    }
    case "goal": {
      if (!row.action.startsWith("goal.source")) return true;
      const name = accountNameInDetail(row.detail);
      return privileged || (name !== null && ctx.visibleAccountNames.has(name));
    }
    default:
      return true;
  }
}
