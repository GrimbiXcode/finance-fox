import { eq } from "drizzle-orm";
import { accountOwners, pensionFunds, transactions } from "@db/schema";
import type { Db } from "../../queries/connection";
import type { SessionUser } from "../../context";
import {
  accessLevelFor,
  listVisibleAccounts,
  type AccessLevel,
} from "../accountAccess";
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
 * Die Sichtbarkeit **während** eines Pushs nachziehen.
 *
 * Der Zustand oben ist eine Momentaufnahme von vor dem Push. Wer offline ein
 * Konto anlegt und darauf bucht, schickt beides im selben Paket — die Buchung
 * bezöge ihr Recht dann auf ein Konto, das es in der Momentaufnahme noch nicht
 * gibt, und würde als „keine Berechtigung" abgewiesen. Deshalb wird jede
 * angewandte Zeile hier eingetragen, bevor die nächste geprüft wird.
 */
export function noteApplied(
  table: SyncTable,
  row: SyncRow,
  vis: Visibility
): void {
  switch (table.name) {
    case "accounts": {
      const id = asNumber(row[table.pk]);
      if (id === null) return;
      vis.accountIds.add(id);
      // Ein frisch angelegtes Konto hat noch keine Besitzer und ist damit ein
      // Gemeinschaftskonto — dieselbe Regel wie in `accessLevelFor`.
      const owners = vis.ownersByAccount.get(id) ?? [];
      if (accessLevelFor(owners, vis.user) === "edit") {
        vis.editableAccountIds.add(id);
      }
      return;
    }
    case "account_owners": {
      const accountId = asNumber(row["account_id"]);
      const userId = asNumber(row["user_id"]);
      if (accountId === null || userId === null) return;
      const owners = vis.ownersByAccount.get(accountId) ?? [];
      if (!owners.includes(userId)) owners.push(userId);
      vis.ownersByAccount.set(accountId, owners);
      const level = accessLevelFor(owners, vis.user);
      if (level === "none") {
        vis.accountIds.delete(accountId);
        vis.editableAccountIds.delete(accountId);
      } else if (level === "edit") {
        vis.editableAccountIds.add(accountId);
      } else {
        vis.editableAccountIds.delete(accountId);
      }
      return;
    }
    case "transactions": {
      const id = asNumber(row[table.pk]);
      const a = asNumber(row["account_id"]);
      const b = asNumber(row["to_account_id"]);
      if (id === null) return;
      const visible =
        (a !== null && vis.accountIds.has(a)) ||
        (b !== null && vis.accountIds.has(b));
      if (visible) vis.transactionIds.add(id);
      else vis.transactionIds.delete(id);
      return;
    }
    case "pension_funds": {
      const id = asNumber(row[table.pk]);
      if (id === null || asNumber(row["user_id"]) !== vis.user.id) return;
      vis.parentIds.get("pension_funds")?.add(id);
      return;
    }
  }
}

/** Nach einem Löschen: Zeile aus der Sichtbarkeit nehmen */
export function noteRemoved(
  table: SyncTable,
  row: SyncRow,
  vis: Visibility
): void {
  const id = asNumber(row[table.pk]);
  if (id === null) return;
  if (table.name === "accounts") {
    vis.accountIds.delete(id);
    vis.editableAccountIds.delete(id);
  } else if (table.name === "transactions") {
    vis.transactionIds.delete(id);
  } else if (table.name === "pension_funds") {
    vis.parentIds.get("pension_funds")?.delete(id);
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
 *
 * `isInsert` markiert Zeilen, die es auf dem Server noch gar nicht gibt. Das
 * ist bei Konten der Unterschied zwischen „darfst du nicht" und „gibt es
 * noch nicht": Ein neu angelegtes Konto hat noch keine Besitzer und ist damit
 * ein Gemeinschaftskonto, das jede angemeldete Person bearbeiten darf — genau
 * wie `finance.createAccount` es zulässt. Ohne diese Unterscheidung wäre es
 * unmöglich, unterwegs ein Konto anzulegen.
 */
export function checkRowWrite(
  table: SyncTable,
  row: SyncRow,
  vis: Visibility,
  isInsert = false
): WriteDenial | null {
  const scope = table.scope;
  if (scope.kind === "accounts" && isInsert) return null;

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
