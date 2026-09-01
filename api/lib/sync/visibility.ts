import { eq } from "drizzle-orm";
import { accountOwners, pensionFunds, transactions } from "@db/schema";
import type { Db } from "../../queries/connection";
import type { SessionUser } from "../../context";
import { listVisibleAccounts, type AccessLevel } from "../accountAccess";
import type { SyncRow } from "./merge";
import type { SyncTable } from "./tables";

/**
 * Rechte beim Abgleich.
 *
 * Der Abgleich überträgt Zeilen, keine Prozeduraufrufe — die Prüfungen der
 * Router greifen hier also nicht. Deshalb bildet dieses Modul dieselben Regeln
 * ein zweites Mal ab, aber auf Zeilenebene: Was darf dieses Gerät **sehen**
 * (`pull`) und was darf es **schreiben** (`push`)?
 *
 * Grundlage bleibt `api/lib/accountAccess.ts`; die Modul-Konventionen
 * (Vorsorge privat je Benutzer, Hypotheken und Versicherungen haushaltsweit)
 * stehen in der Registry `./tables.ts`.
 */

export type Visibility = {
  user: SessionUser;
  /** Konten, die der Benutzer mindestens ansehen darf */
  accountIds: Set<number>;
  /** Konten mit Schreibrecht */
  editableAccountIds: Set<number>;
  /** Besitzer je Konto (leer = Gemeinschaftskonto) */
  ownersByAccount: Map<number, number[]>;
  /** Buchungen, die mindestens ein sichtbares Konto berühren */
  transactionIds: Set<number>;
  /** IDs der Eltern-Datensätze je Tabelle (heute: eigene Pensionskassen) */
  parentIds: Map<string, Set<number>>;
};

/** Alles einmal laden, was für die Zeilenprüfungen eines Abgleichs nötig ist */
export async function loadVisibility(
  db: Db,
  user: SessionUser
): Promise<Visibility> {
  const visible = await listVisibleAccounts(db, user);
  const accountIds = new Set(visible.map(a => a.id));
  const editableAccountIds = new Set(
    visible.filter(a => a.access === "edit").map(a => a.id)
  );

  const [ownerRows, txRows, fundRows] = await Promise.all([
    db.select().from(accountOwners),
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        toAccountId: transactions.toAccountId,
      })
      .from(transactions),
    db
      .select({ id: pensionFunds.id })
      .from(pensionFunds)
      .where(eq(pensionFunds.userId, user.id)),
  ]);

  const ownersByAccount = new Map<number, number[]>();
  for (const row of ownerRows) {
    const list = ownersByAccount.get(row.accountId);
    if (list) list.push(row.userId);
    else ownersByAccount.set(row.accountId, [row.userId]);
  }

  const transactionIds = new Set(
    txRows
      .filter(
        tx =>
          accountIds.has(tx.accountId) ||
          (tx.toAccountId !== null && accountIds.has(tx.toAccountId))
      )
      .map(tx => tx.id)
  );

  return {
    user,
    accountIds,
    editableAccountIds,
    ownersByAccount,
    transactionIds,
    parentIds: new Map([["pension_funds", new Set(fundRows.map(f => f.id))]]),
  };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return null;
}

/** Darf der Benutzer diese Zeile sehen? */
export function isRowVisible(
  table: SyncTable,
  row: SyncRow,
  vis: Visibility
): boolean {
  const scope = table.scope;
  switch (scope.kind) {
    case "household":
    case "users":
      return true;
    case "accounts": {
      const id = asNumber(row[table.pk]);
      return id !== null && vis.accountIds.has(id);
    }
    case "account": {
      const id = asNumber(row[scope.column]);
      return id !== null && vis.accountIds.has(id);
    }
    case "accountPair": {
      const a = asNumber(row[scope.column]);
      const b = asNumber(row[scope.otherColumn]);
      return (
        (a !== null && vis.accountIds.has(a)) ||
        (b !== null && vis.accountIds.has(b))
      );
    }
    case "transaction": {
      const id = asNumber(row[scope.column]);
      return id !== null && vis.transactionIds.has(id);
    }
    case "user":
      return asNumber(row[scope.column]) === vis.user.id;
    case "parent": {
      const id = asNumber(row[scope.column]);
      return id !== null && (vis.parentIds.get(scope.table)?.has(id) ?? false);
    }
  }
}

/**
 * Fingerabdruck der sichtbaren Kontenmenge. Ändert sie sich (ein Konto wird
 * privat gestellt oder freigegeben), müssen die betroffenen Zeilen auf dem
 * Gerät verschwinden bzw. auftauchen — das erledigt ein vollständiger
 * Abgleich, weil die Zeilen selbst sich dabei gar nicht geändert haben und
 * folglich nicht im Änderungsprotokoll stehen.
 */
export function visibilityFingerprint(vis: Visibility): string {
  return [...vis.accountIds].sort((a, b) => a - b).join(",");
}

/** Begründung, warum eine Zeile nicht geschrieben werden darf (deutsch) */
export type WriteDenial = { reason: string };

/** Spalten, die ein Gerät an der eigenen Benutzerzeile ändern darf */
export const WRITABLE_USER_COLUMNS = ["name", "color", "quick_account_id"];

function accountLevel(vis: Visibility, accountId: number): AccessLevel {
  if (!vis.accountIds.has(accountId)) return "none";
  return vis.editableAccountIds.has(accountId) ? "edit" : "view";
}

function requireEdit(
  vis: Visibility,
  accountId: number | null
): WriteDenial | null {
  if (accountId === null) return null;
  if (accountLevel(vis, accountId) === "edit") return null;
  return {
    reason: "Für dieses Konto fehlt inzwischen das Bearbeiten-Recht.",
  };
}

/**
 * Darf der Benutzer diese Zeile schreiben? `null` heißt ja.
 *
 * Geprüft wird gegen den Zustand auf dem Server — ein Gerät kann offline
 * durchaus etwas ändern, wofür ihm inzwischen das Recht fehlt.
 */
export function checkRowWrite(
  table: SyncTable,
  row: SyncRow,
  vis: Visibility
): WriteDenial | null {
  const scope = table.scope;

  // Die haushaltsweite Währung (und alle anderen App-Einstellungen) ändern
  // nur Admins — wie in finance.setCurrency.
  if (table.name === "app_settings" && vis.user.role !== "admin") {
    return { reason: "App-Einstellungen darf nur ein Administrator ändern." };
  }
  // Besitzverhältnisse ändern nur Besitzer oder Admins — wie in
  // finance.setAccountOwners. Das Bearbeiten-Recht allein genügt nicht.
  if (table.name === "account_owners") {
    const accountId = asNumber(row["account_id"]);
    const owners =
      accountId === null ? [] : (vis.ownersByAccount.get(accountId) ?? []);
    const mayManage =
      owners.length === 0 ||
      owners.includes(vis.user.id) ||
      vis.user.role === "admin";
    if (!mayManage) {
      return { reason: "Besitzer eines Kontos ändert nur ein Besitzer." };
    }
    return null;
  }

  switch (scope.kind) {
    case "household":
      return null;
    case "users":
      return asNumber(row[table.pk]) === vis.user.id
        ? null
        : { reason: "Fremde Benutzerkonten lassen sich nicht ändern." };
    case "accounts":
      return requireEdit(vis, asNumber(row[table.pk]));
    case "account":
      return requireEdit(vis, asNumber(row[scope.column]));
    case "accountPair": {
      return (
        requireEdit(vis, asNumber(row[scope.column])) ??
        requireEdit(vis, asNumber(row[scope.otherColumn]))
      );
    }
    case "transaction": {
      const id = asNumber(row[scope.column]);
      if (id === null || !vis.transactionIds.has(id)) {
        return { reason: "Die zugehörige Buchung ist nicht mehr sichtbar." };
      }
      return null;
    }
    case "user":
      return asNumber(row[scope.column]) === vis.user.id
        ? null
        : { reason: "Fremde Vorsorgedaten lassen sich nicht ändern." };
    case "parent": {
      const id = asNumber(row[scope.column]);
      const known = vis.parentIds.get(scope.table);
      return id !== null && known?.has(id)
        ? null
        : { reason: "Der zugehörige Datensatz gehört jemand anderem." };
    }
  }
}
