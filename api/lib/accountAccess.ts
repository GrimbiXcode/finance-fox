import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { accountPermissions, accounts } from "@db/schema";
import type { Db } from "../queries/connection";
import type { SessionUser } from "../context";

/** Zugriffsstufen eines Nutzers auf ein Konto */
export type AccessLevel = "none" | "view" | "edit";

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

type AccountRow = typeof accounts.$inferSelect;
type PermissionRow = typeof accountPermissions.$inferSelect;

/**
 * Reine Regel: welche Zugriffsstufe hat `user` auf `account`?
 * - Gemeinschaftskonto (ownerId NULL): jeder eingeloggte Nutzer darf bearbeiten.
 * - Privates Konto: Besitzer darf bearbeiten; Admins (nicht Besitzer) dürfen
 *   nur ansehen (reine Verwaltungsübersicht); andere Mitglieder nur mit
 *   Freigabe-Zeile in account_permissions.
 */
export function accessLevelFor(
  account: Pick<AccountRow, "ownerId">,
  user: SessionUser,
  permission?: Pick<PermissionRow, "canEdit">,
): AccessLevel {
  if (account.ownerId === null || account.ownerId === user.id) return "edit";
  if (user.role === "admin") return "view";
  if (permission) return permission.canEdit ? "edit" : "view";
  return "none";
}

export type VisibleAccount = AccountRow & {
  access: "view" | "edit";
  isOwner: boolean;
};

/** Alle für `user` sichtbaren Konten (mindestens "view"), annotiert */
export async function listVisibleAccounts(
  db: Db,
  user: SessionUser,
): Promise<VisibleAccount[]> {
  const [accs, perms] = await Promise.all([
    db.select().from(accounts),
    db.select().from(accountPermissions)
      .where(eq(accountPermissions.userId, user.id)),
  ]);
  const permByAccount = new Map(perms.map((p) => [p.accountId, p]));
  const visible: VisibleAccount[] = [];
  for (const a of accs) {
    const access = accessLevelFor(a, user, permByAccount.get(a.id));
    if (access === "none") continue;
    visible.push({ ...a, access, isOwner: a.ownerId === user.id });
  }
  return visible;
}

/** IDs aller für `user` sichtbaren Konten (zum Filtern von Buchungen etc.) */
export async function visibleAccountIds(
  db: Db,
  user: SessionUser,
): Promise<Set<number>> {
  return new Set((await listVisibleAccounts(db, user)).map((a) => a.id));
}

/**
 * Buchung ist sichtbar, wenn Quell- ODER Zielkonto sichtbar ist —
 * Transfers zwischen sichtbarem und unsichtbarem Konto bleiben sichtbar.
 */
export function touchesVisibleAccount(
  visible: Set<number>,
  tx: { accountId: number; toAccountId: number | null },
): boolean {
  return (
    visible.has(tx.accountId) ||
    (tx.toAccountId !== null && visible.has(tx.toAccountId))
  );
}

/**
 * Lädt ein Konto und prüft die Mindest-Zugriffsstufe.
 * Wirft NOT_FOUND (nicht FORBIDDEN), damit die Existenz privater Konten
 * nicht leakt.
 */
export async function requireAccountAccess(
  db: Db,
  user: SessionUser,
  accountId: number,
  minLevel: AccessLevel,
): Promise<AccountRow> {
  const account = await db.query.accounts
    .findFirst({ where: eq(accounts.id, accountId) });
  const permission = account
    ? await db.query.accountPermissions.findFirst({
      where: and(
        eq(accountPermissions.accountId, accountId),
        eq(accountPermissions.userId, user.id),
      ),
    })
    : undefined;
  const level = account ? accessLevelFor(account, user, permission) : "none";
  if (!account || LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Konto nicht gefunden." });
  }
  return account;
}
