/**
 * Vertrag zwischen App, Service Worker und Server für den Offline-Betrieb.
 *
 * Liegt in `contracts/`, weil alle drei Seiten dieselben Werte brauchen:
 * die Seite (Registrierung, Link-Aufteilung), der Service Worker (lokaler
 * Router, Sync) und der Server (zweiter tRPC-Mount, Versionsprüfung).
 */

/**
 * Version des Sync-Protokolls. Erhöhen, sobald sich Format oder Semantik von
 * `pull`/`push` ändern — der Server weist dann Clients mit älterer Version ab,
 * statt Daten falsch zusammenzuführen.
 */
export const SYNC_PROTOCOL_VERSION = 1;

/** tRPC-Endpunkt, den der Service Worker lokal beantwortet */
export const TRPC_LOCAL_PATH = "/api/trpc";

/**
 * tRPC-Endpunkt, der immer ans Netz geht (Login, Verwaltung, Sync selbst).
 * Der Server montiert denselben Handler unter beiden Pfaden.
 */
export const TRPC_LIVE_PATH = "/api/trpc/live";

/**
 * Prozeduren, die es nur im Heimnetz gibt — alles andere beantwortet die
 * lokale Replik. Kriterium: die Prozedur braucht Server-Geheimnisse
 * (Passwort-Hashes, TOTP, Session-Cookie), die Server-Datei selbst
 * (Backup/Restore), einen ausgehenden Netzzugriff (Benachrichtigungen),
 * oder sie ist zu folgenreich, um sie ohne Rückfrage offline anzustoßen.
 *
 * `auth` ist bewusst **aufgeteilt** statt komplett ausgeschlossen:
 * `auth.me`, `auth.setupStatus`, `auth.listUsers`, `auth.updateProfile` und
 * `auth.setQuickAccount` sind reine Daten auf der `users`-Tabelle und laufen
 * offline weiter — ohne sie käme die App nicht einmal am Login-Gate vorbei.
 */
export const ONLINE_ONLY_PROCEDURES: ReadonlySet<string> = new Set([
  // Anmeldung und Sitzung — brauchen das signierte Cookie vom Server
  "auth.login",
  "auth.verifyTotpLogin",
  "auth.logout",
  "auth.setup",
  // Passwörter, Einladungen, 2FA — brauchen Server-Geheimnisse
  "auth.requestReset",
  "auth.setPassword",
  "auth.tokenInfo",
  "auth.changePassword",
  "auth.setupTotp",
  "auth.enableTotp",
  "auth.disableTotp",
  // Benutzerverwaltung (Admin)
  "auth.createUser",
  "auth.deactivateUser",
  "auth.reactivateUser",
  "auth.resetUserPassword",
  // Server-Betrieb
  "finance.getNotifySettings",
  "finance.setNotifySettings",
  "finance.sendTestNotification",
  "finance.runRecurringNow",
  // Zu folgenreich für offline: würde als Massenlöschung bzw. Massenimport
  // in den nächsten Abgleich laufen
  "finance.resetFinanceData",
  "finance.importLocalFull",
  // Sparziel abschließen löst ALLE Quellen — die Replik kennt aber nur die
  // auf sichtbaren Konten; offline blieben Quellen auf fremden Privatkonten
  // hängen und hielten deren Geld verplant
  "finance.setGoalArchived",
  // Der Abgleich selbst
  "sync.claimDevice",
  "sync.pull",
  "sync.push",
  "sync.meta",
]);

/** Gehört diese tRPC-Prozedur zwingend ins Heimnetz? */
export function isOnlineOnlyProcedure(path: string): boolean {
  return ONLINE_ONLY_PROCEDURES.has(path);
}

/** Zustand des Offline-Teils, wie ihn der Service Worker meldet */
export type OfflineStatus =
  /** Kein Service Worker (unsicherer Kontext, Dev-Server, altes Gerät) */
  | "unsupported"
  /** Service Worker läuft, aber der erste vollständige Abgleich fehlt noch */
  | "bootstrapping"
  /** Lokale Replik ist aktiv */
  | "ready";

/** Nachrichten der Seite an den Service Worker */
export type PageToWorkerMessage =
  /** Angemeldeter Benutzer, damit der lokale Router eine Identität hat */
  | { type: "ff:identity"; user: OfflineIdentity | null }
  /** Abgleich anstoßen (App-Start, Fokus, nach einer Mutation, Intervall) */
  | { type: "ff:sync"; reason: SyncReason }
  /** Statusabfrage — beantwortet mit `ff:status` */
  | { type: "ff:status?" }
  /** Wartenden Service Worker sofort aktivieren (Update-Fluss) */
  | { type: "ff:skip-waiting" }
  /** Build-Kennung des Workers erfragen — beantwortet mit `ff:version` */
  | { type: "ff:version?" }
  /** Speicher-Budget für Beleg-Dateien setzen (0 = keine Belege vorhalten) */
  | { type: "ff:blob-budget"; bytes: number }
  /** Lokale Daten verwerfen (Notbremse in den Einstellungen) */
  | { type: "ff:reset" };

/** Nachrichten des Service Workers an die Seite */
export type WorkerToPageMessage =
  /** Aktueller Zustand des Offline-Teils */
  | { type: "ff:status"; status: SyncStatus }
  /** Der Abgleich hat lokale Daten verändert — Queries neu laden */
  | { type: "ff:data-changed" }
  /**
   * Build-Kennung des antwortenden Workers (`__FF_BUILD_ID__`). Die Seite
   * erkennt daran, ob ein frisch installierter Worker wirklich eine neue
   * Version ist — der Browser allein ist dafür kein verlässlicher Zeuge
   * (siehe `src/lib/serviceWorker.ts`).
   */
  | { type: "ff:version"; buildId: string };

/** Identität, mit der der lokale Router arbeitet (Spiegel von SessionUser) */
export type OfflineIdentity = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  color: string;
};

/** Auslöser eines Abgleichs — nur fürs Protokoll interessant */
export type SyncReason = "start" | "focus" | "mutation" | "interval" | "manual";

/** Zustand des Abgleichs, wie ihn die Kopfzeile anzeigt */
export type SyncStatus = {
  offline: OfflineStatus;
  /** Ist der Heimserver gerade erreichbar? */
  reachable: boolean;
  /** Läuft gerade ein Abgleich? */
  syncing: boolean;
  /** Zeitpunkt des letzten erfolgreichen Abgleichs */
  lastSyncAt: number | null;
  /** Lokale Änderungen, die noch auf den Server warten */
  pending: number;
  /** Offene Konflikte, die der Benutzer entscheiden muss */
  conflicts: number;
  /** Letzter Fehler in Klartext (deutsch), sonst null */
  error: string | null;
  /** Belegte und erlaubte Größe der Anhang-Dateien auf diesem Gerät */
  storage: { files: number; bytes: number; budget: number };
};

/* ────────────────────────── Abgleich: Datenformen ────────────────────────── */

/** Eine Datenbankzeile, wie SQLite sie liefert: Spaltenname → Wert */
export type SyncRowPayload = Record<string, unknown>;

export type SyncOp = "insert" | "update" | "delete";

/** Eine lokale Änderung auf dem Weg zum Server */
export type SyncChange = {
  entity: string;
  rowId: string;
  op: SyncOp;
  /** Der lokale Stand; null beim Löschen */
  row: SyncRowPayload | null;
  /** Der Stand, den das Gerät beim letzten Abgleich vom Server bekam */
  base: SyncRowPayload | null;
};

/** Art eines Konflikts, wie ihn die Oberfläche erklärt */
export type SyncConflictKind =
  "fields" | "deleted-remote" | "deleted-local" | "forbidden";

export type SyncConflict = {
  entity: string;
  rowId: string;
  kind: SyncConflictKind;
  /** Betroffene Spalten (nur bei `fields`) */
  fields: string[];
  base: SyncRowPayload | null;
  mine: SyncRowPayload | null;
  theirs: SyncRowPayload | null;
  /** Klartext-Begründung, heute nur bei `forbidden` gefüllt */
  detail: string;
};

/** Was aus einer einzelnen gepushten Änderung geworden ist */
export type SyncPushOutcome = {
  entity: string;
  rowId: string;
  status: "applied" | "merged" | "conflict" | "skipped";
  /** Der Stand, der jetzt auf dem Server steht (bei „merged" der Mischstand) */
  row?: SyncRowPayload | null;
  /** Automatisch zusammengeführte Felder — für das Merge-Protokoll */
  mergedMine?: string[];
  mergedTheirs?: string[];
  conflict?: SyncConflict;
};
