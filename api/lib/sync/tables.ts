/**
 * Registry aller Tabellen, die zwischen Heimserver und den lokalen Repliken
 * abgeglichen werden — inklusive der Frage, **wer welche Zeile sehen darf**.
 *
 * Diese Datei ist die einzige Stelle, an der das steht. `ensureSchema` erzeugt
 * daraus die Änderungs-Trigger, `pull` den Rechte-Filter und `push` die
 * Schreibprüfung. Eine neue Tabelle in `db/schema.ts` gehört deshalb auch
 * hierher — sonst wird sie schlicht nicht synchronisiert.
 */

/**
 * Sichtbarkeitsregel einer Tabelle. Bildet exakt die Regeln aus
 * `api/lib/accountAccess.ts` und den Modul-Konventionen ab (Vorsorge privat je
 * Benutzer, Hypotheken und Versicherungen haushaltsweit).
 */
export type SyncScope =
  /** Gehört dem Haushalt — jeder angemeldete Benutzer sieht alles */
  | { kind: "household" }
  /** Die Konten-Tabelle selbst: nur sichtbare Konten */
  | { kind: "accounts" }
  /** Zeile hängt an genau einem Konto */
  | { kind: "account"; column: string }
  /** Zeile hängt an zwei Konten (Buchung/Dauerbuchung) — eines genügt */
  | { kind: "accountPair"; column: string; otherColumn: string }
  /** Zeile hängt an einer Buchung; sichtbar, wenn die Buchung sichtbar ist */
  | { kind: "transaction"; column: string }
  /** Privat: nur Zeilen des anfragenden Benutzers */
  | { kind: "user"; column: string }
  /**
   * Privat, aber zusätzlich die Zeilen der **beidseitig bestätigten**
   * Ehepartner-Verknüpfung — und davon nur die aufgeführten Spalten.
   *
   * Die AHV-Rentenberechnung (`api/lib/pension/ahvLoad.ts`) ist die einzige
   * Stelle des Vorsorge-Moduls, die Daten einer anderen Person liest: für die
   * Einkommensteilung während der Ehejahre und die Plafonierung beider
   * Renten. Ohne diese Zeilen könnte die Replik die Rente offline nicht
   * richtig rechnen. Die beidseitige Verknüpfung ist die Einwilligung dazu —
   * sie existiert ausschließlich für diese Rechnung.
   */
  | {
      kind: "userOrPartner";
      column: string;
      /** Spalten, die von der verknüpften Person übertragen werden */
      partnerColumns: string[];
    }
  /** Privat über den Eltern-Datensatz (z. B. Abstufung einer Pensionskasse) */
  | { kind: "parent"; table: string; column: string }
  /** Benutzerliste — alle Zeilen, aber ohne Geheimnisse */
  | { kind: "users" };

export type SyncTable = {
  /** SQL-Name der Tabelle */
  name: string;
  /** SQL-Name der Primärschlüsselspalte */
  pk: string;
  /** Primärschlüssel-Typ — `app_settings` ist die einzige Tabelle mit TEXT */
  pkType: "integer" | "text";
  scope: SyncScope;
  /** Spalten, die niemals das Gerät verlassen */
  secretColumns?: string[];
  /**
   * Beim vollständigen Abgleich nur die jüngsten N Zeilen übertragen
   * (absteigend nach Primärschlüssel). Für reine Protokolltabellen, die
   * unbegrenzt wachsen.
   */
  snapshotLimit?: number;
};

const t = (
  name: string,
  scope: SyncScope,
  extra: Partial<SyncTable> = {}
): SyncTable => ({ name, pk: "id", pkType: "integer", scope, ...extra });

export const SYNC_TABLES: SyncTable[] = [
  // ── Benutzer ────────────────────────────────────────────────────────────
  t(
    "users",
    { kind: "users" },
    {
      secretColumns: ["password_hash", "totp_secret"],
    }
  ),

  // ── Konten und Struktur ─────────────────────────────────────────────────
  t("account_types", { kind: "household" }),
  t("banks", { kind: "household" }),
  t("accounts", { kind: "accounts" }),
  // Besitz und Freigaben reisen mit dem Konto mit: `accessLevelFor` muss
  // offline dieselbe Entscheidung treffen können wie der Server.
  t("account_owners", { kind: "account", column: "account_id" }),
  t("account_permissions", { kind: "account", column: "account_id" }),
  t("categories", { kind: "household" }),
  t("projects", { kind: "household" }),
  t("tags", { kind: "household" }),

  // ── Buchungen ───────────────────────────────────────────────────────────
  t("transactions", {
    kind: "accountPair",
    column: "account_id",
    otherColumn: "to_account_id",
  }),
  t("transaction_splits", { kind: "transaction", column: "transaction_id" }),
  t("transaction_changes", { kind: "transaction", column: "transaction_id" }),
  t("transaction_attachments", {
    kind: "transaction",
    column: "transaction_id",
  }),
  t("transaction_tags", { kind: "transaction", column: "transaction_id" }),
  t("split_templates", { kind: "household" }),

  // ── Budgets, Dauerbuchungen, Sparziele ──────────────────────────────────
  t("budgets", { kind: "household" }),
  t("recurring", {
    kind: "accountPair",
    column: "account_id",
    otherColumn: "to_account_id",
  }),
  t("savings_goals", { kind: "household" }),
  t("goal_contributions", { kind: "household" }),
  t("goal_sources", { kind: "account", column: "account_id" }),

  // ── Vorsorge (privat je Benutzer) ───────────────────────────────────────
  //
  // Drei Ausnahmen mit `userOrPartner`: Genau diese Tabellen liest
  // `loadAhvInput` von der beidseitig verknüpften Person. Übertragen wird
  // davon nur, was in die Rechnung eingeht — AHV-Nummer, Notizen, Zivilstand,
  // Ehejahre und die amtliche Rentenvorausberechnung bleiben im Heimnetz.
  //
  // Achtung: Nicht aufgeführte Spalten tragen in der Replik den
  // Schema-Default, nicht den echten Wert (Pensionierungsalter 65, Land
  // „CH", Zivilstand „ledig"). Sie dürfen für eine Partnerzeile deshalb
  // nirgends gelesen werden. `api/syncPension.test.ts` hält das fest, indem
  // es die Rechnung einmal mit vollständigen und einmal mit projizierten
  // Zeilen vergleicht: Wer `ahvLoad.ts` eine weitere Spalte lesen lässt,
  // sieht dort sofort, dass sie hier fehlt.
  t("pension_profiles", {
    kind: "userOrPartner",
    column: "user_id",
    partnerColumns: [
      "id",
      "user_id",
      // Für die Gegenseitigkeitsprüfung: Erst wenn beide Seiten aufeinander
      // zeigen, ist die Verknüpfung wirksam — das muss auch offline gelten.
      "partner_user_id",
      "birth_date",
      // NOT NULL ohne Default — ohne die Spalte ließe sich die Zeile auf dem
      // Gerät gar nicht anlegen.
      "created_at",
    ],
  }),
  t("pension_salaries", { kind: "user", column: "user_id" }),
  t("pension_deductions", { kind: "user", column: "user_id" }),
  t("pension_ahv", {
    kind: "userOrPartner",
    column: "user_id",
    partnerColumns: [
      "id",
      "user_id",
      "gender",
      "first_ik_year",
      // Vorbezug/Aufschub der anderen Person verändert deren Rente und damit
      // die Plafonierung.
      "withdrawal_mode",
      "withdrawal_months",
      "withdrawal_share_pct",
    ],
  }),
  t("pension_ahv_years", {
    kind: "userOrPartner",
    column: "user_id",
    partnerColumns: [
      "id",
      "user_id",
      "year",
      "income",
      "status",
      "parenting_credit",
      "care_credit",
    ],
  }),
  t("pension_funds", { kind: "user", column: "user_id" }),
  t("pension_fund_tiers", {
    kind: "parent",
    table: "pension_funds",
    column: "fund_id",
  }),
  t("pension_pillar3", { kind: "user", column: "user_id" }),
  t("pension_attachments", { kind: "user", column: "user_id" }),
  t("pension_changes", { kind: "user", column: "user_id" }),

  // ── Hypotheken (haushaltsweit) ──────────────────────────────────────────
  t("properties", { kind: "household" }),
  t("mortgage_tranches", { kind: "household" }),
  t("mortgage_amortizations", { kind: "household" }),
  t("mortgage_changes", { kind: "household" }),

  // ── Versicherungen (haushaltsweit) ──────────────────────────────────────
  t("insurance_policies", { kind: "household" }),
  t("insurance_policy_persons", { kind: "household" }),
  t("insurance_coverages", { kind: "household" }),
  t("insurance_attachments", { kind: "household" }),
  t("insurance_changes", { kind: "household" }),
  t("insurance_gap_dismissals", { kind: "household" }),

  // ── Übergreifend ────────────────────────────────────────────────────────
  // Das Aktivitäts-Log wächst unbegrenzt; offline gebraucht wird nur der
  // jüngste Ausschnitt für die Card „Aktivitäten".
  t("audit_log", { kind: "household" }, { snapshotLimit: 500 }),
  {
    name: "app_settings",
    pk: "key",
    pkType: "text",
    scope: { kind: "household" },
  },
];

/**
 * Tabellen, die bewusst **nicht** abgeglichen werden.
 * `auth_tokens` enthält Einladungs- und Reset-Geheimnisse und hat auf einem
 * Gerät nichts verloren; die `sync_*`-Tabellen sind die Buchhaltung des
 * Abgleichs selbst und je Seite verschieden.
 */
export const NEVER_SYNCED = [
  "auth_tokens",
  "sync_log",
  "sync_base",
  "sync_conflicts",
  "sync_merges",
  "sync_devices",
  "sync_guard",
  "sync_blobs",
];

const byName = new Map(SYNC_TABLES.map(table => [table.name, table]));

export function syncTable(name: string): SyncTable | undefined {
  return byName.get(name);
}

/** Spalten, die aus einer Zeile entfernt werden, bevor sie das Haus verlässt */
export function stripSecrets(
  table: SyncTable,
  row: Record<string, unknown>
): Record<string, unknown> {
  if (!table.secretColumns?.length) return row;
  const copy = { ...row };
  for (const column of table.secretColumns) delete copy[column];
  return copy;
}
