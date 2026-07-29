import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { accountOwners, accountPermissions, accounts } from "@db/schema";
import type { Db } from "../queries/connection";
import type { SessionUser } from "../context";

/** Zugriffsstufen eines Nutzers auf ein Konto */
export type AccessLevel = "none" | "view" | "edit";

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

type AccountRow = typeof accounts.$inferSelect;
type PermissionRow = typeof accountPermissions.$inferSelect;

/**
 * Reine Regel: welche Zugriffsstufe hat `user` auf ein Konto mit den
 * Besitzer-UserIds `ownerIds`?
 * - Gemeinschaftskonto (keine Besitzer): jeder eingeloggte Nutzer darf
 *   bearbeiten.
 * - Privates Konto (1..n Besitzer mit gleichen Rechten): Besitzer dürfen
 *   bearbeiten; Admins (nicht Besitzer) dürfen nur ansehen (reine
 *   Verwaltungsübersicht); andere Mitglieder nur mit Freigabe-Zeile in
 *   account_permissions.
 */
export function accessLevelFor(
  ownerIds: number[],
  user: SessionUser,
  permission?: Pick<PermissionRow, "canEdit">
): AccessLevel {
  if (ownerIds.length === 0 || ownerIds.includes(user.id)) return "edit";
  if (user.role === "admin") return "view";
  if (permission) return permission.canEdit ? "edit" : "view";
  return "none";
}

export type VisibleAccount = AccountRow & {
  access: "view" | "edit";
  isOwner: boolean;
  /** Besitzer-UserIds (leer = Gemeinschaftskonto) */
  owners: number[];
};

/** Besitzer-UserIds eines Kontos (leer = Gemeinschaftskonto) */
export async function ownerIdsOf(db: Db, accountId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: accountOwners.userId })
    .from(accountOwners)
    .where(eq(accountOwners.accountId, accountId));
  return rows.map(r => r.userId);
}

/** Alle für `user` sichtbaren Konten (mindestens "view"), annotiert */
export async function listVisibleAccounts(
  db: Db,
  user: SessionUser
): Promise<VisibleAccount[]> {
  const [accs, perms, ownerRows] = await Promise.all([
    db.select().from(accounts),
    db
      .select()
      .from(accountPermissions)
      .where(eq(accountPermissions.userId, user.id)),
    db.select().from(accountOwners),
  ]);
  const permByAccount = new Map(perms.map(p => [p.accountId, p]));
  const ownersByAccount = new Map<number, number[]>();
  for (const o of ownerRows) {
    const list = ownersByAccount.get(o.accountId);
    if (list) list.push(o.userId);
    else ownersByAccount.set(o.accountId, [o.userId]);
  }
  const visible: VisibleAccount[] = [];
  for (const a of accs) {
    const owners = ownersByAccount.get(a.id) ?? [];
    const access = accessLevelFor(owners, user, permByAccount.get(a.id));
    if (access === "none") continue;
    visible.push({ ...a, access, isOwner: owners.includes(user.id), owners });
  }
  return visible;
}

/** IDs aller für `user` sichtbaren Konten (zum Filtern von Buchungen etc.) */
export async function visibleAccountIds(
  db: Db,
  user: SessionUser
): Promise<Set<number>> {
  return new Set((await listVisibleAccounts(db, user)).map(a => a.id));
}

/**
 * Buchung ist sichtbar, wenn Quell- ODER Zielkonto sichtbar ist —
 * Transfers zwischen sichtbarem und unsichtbarem Konto bleiben sichtbar.
 */
export function touchesVisibleAccount(
  visible: Set<number>,
  tx: { accountId: number; toAccountId: number | null }
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
  minLevel: AccessLevel
): Promise<AccountRow> {
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  const [permission, owners] = account
    ? await Promise.all([
        db.query.accountPermissions.findFirst({
          where: and(
            eq(accountPermissions.accountId, accountId),
            eq(accountPermissions.userId, user.id)
          ),
        }),
        ownerIdsOf(db, accountId),
      ])
    : [undefined, []];
  const level = account ? accessLevelFor(owners, user, permission) : "none";
  if (!account || LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Konto nicht gefunden.",
    });
  }
  return account;
}
