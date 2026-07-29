import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* ---------------------------------- Auth ---------------------------------- */

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["admin", "member"] })
    .notNull()
    .default("member"),
  color: text("color").notNull().default("#10b981"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  // 2FA/TOTP (opt-in pro Benutzer, siehe api/lib/totp.ts):
  // Base32-Secret, nur gesetzt während der Einrichtung bzw. wenn aktiviert
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const authTokens = sqliteTable("auth_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  // invite/reset = 7 Tage; totp = kurzlebiger Zweitfaktor-Login-Token (5 Min.)
  purpose: text("purpose", { enum: ["invite", "reset", "totp"] }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/* --------------------------------- Finanzen -------------------------------- */

/**
 * Kontotypen (eigene Typen möglich). `accounts.type` speichert den KEY —
 * Builtin-Keys: checking/cash/savings, eigene: custom_<zufalls-id>.
 */
export const accountTypes = sqliteTable("account_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull().unique(),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
});

/** Wiederverwendbare Banknamen, referenziert über accounts.bank_id */
export const banks = sqliteTable("banks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Key aus account_types (Builtin oder Custom-Typ)
  type: text("type").notNull(),
  initialBalance: integer("initial_balance").notNull().default(0), // Cent
  // Besitzer stehen in account_owners (leer = Gemeinschaftskonto). Die alte
  // Spalte owner_id bleibt physisch in der DB bestehen (ensureSchema migriert
  // nicht rückwärts), wird aber nicht mehr gelesen.
  bankId: integer("bank_id"),
  iban: text("iban"), // normalisiert: ohne Leerzeichen, Großbuchstaben
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Besitzerliste eines Kontos (1..n Personen mit gleichen Rechten).
 * Keine Zeilen = Gemeinschaftskonto (für alle sicht-/bearbeitbar);
 * mindestens eine Zeile = privates Konto (Besitzer + account_permissions-
 * Freigaben, Admins nur lesend). Migration aus accounts.owner_id in
 * ensureSchema — die bisherigen Besitzer waren zugleich die Ersteller
 * ihrer Privatkonten.
 */
export const accountOwners = sqliteTable(
  "account_owners",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").notNull(),
    userId: integer("user_id").notNull(),
  },
  t => [
    uniqueIndex("account_owners_unique_idx").on(t.accountId, t.userId),
    index("account_owners_account_idx").on(t.accountId),
  ]
);

/** Individuelle Freigaben privater Konten für andere Haushaltsmitglieder */
export const accountPermissions = sqliteTable(
  "account_permissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").notNull(),
    userId: integer("user_id").notNull(),
    canEdit: integer("can_edit", { mode: "boolean" }).notNull().default(false),
  },
  t => [uniqueIndex("account_perm_unique_idx").on(t.accountId, t.userId)]
);

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  color: text("color").notNull(),
  // NULL = Oberkategorie, sonst Verweis auf die Oberkategorie.
  // Genau eine Hierarchieebene: Unterkategorien haben selbst keine Kinder.
  parentId: integer("parent_id"),
});

/**
 * Projekte der Kostenaufteilung (z. B. gemeinsamer Urlaub) — Buchungen ohne
 * Projekt (projectId NULL) gelten als laufender Haushalt.
 */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: ["income", "expense", "transfer"] }).notNull(),
    accountId: integer("account_id").notNull(),
    toAccountId: integer("to_account_id"),
    amount: integer("amount").notNull(), // Cent, positiv
    categoryId: integer("category_id"),
    userId: integer("user_id").notNull(), // wer hat gebucht/bezahlt
    // NULL = laufender Haushalt, sonst Verweis auf ein Projekt
    projectId: integer("project_id"),
    date: text("date").notNull(), // YYYY-MM-DD
    note: text("note").notNull().default(""),
    recurringId: integer("recurring_id"),
    // Storno: die Storno-Buchung zeigt auf das Original (NULL = kein Storno)
    stornoOfId: integer("storno_of_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [
    index("tx_date_idx").on(t.date),
    index("tx_account_idx").on(t.accountId),
  ]
);

/**
 * Gespeicherte Aufteilungsvorlagen für geteilte Ausgaben.
 * shares = JSON-Array [{ userId, weight }] mit positiven Gewichten —
 * die Verteilung auf Cent-Beträge rechnet sharesFromWeights (@contracts/splitShares).
 */
export const splitTemplates = sqliteTable("split_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  shares: text("shares").notNull(), // JSON: [{ userId, weight }]
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id").notNull(),
    userId: integer("user_id").notNull(),
    amount: integer("amount").notNull(), // Cent
  },
  t => [index("split_tx_idx").on(t.transactionId)]
);

/**
 * Änderungshistorie einer Buchung („Buchungen bearbeiten"): ein Eintrag pro
 * updateTransaction-Mutation mit echter Änderung. changes = JSON-Text
 * [{field, from, to}] — serverseitig erzeugtes Feld-Diff mit aufgelösten
 * Namen (Kategorie/Konto/Projekt/Person); comment ist optional (Default '').
 * Die Buchungsart (type) ist bewusst unveränderlich und taucht hier nie auf.
 */
export const transactionChanges = sqliteTable(
  "transaction_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id").notNull(),
    userId: integer("user_id").notNull(), // wer hat geändert
    comment: text("comment").notNull().default(""),
    changes: text("changes").notNull(), // JSON: [{ field, from, to }]
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("tx_change_tx_idx").on(t.transactionId)]
);

/** Beleg-/Foto-Anhänge einer Buchung; Dateien liegen im Attachments-Verzeichnis */
export const transactionAttachments = sqliteTable(
  "transaction_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id").notNull(),
    // Zufälliger Dateiname im Attachments-Verzeichnis (eindeutig)
    storedName: text("stored_name").notNull().unique(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("attachment_tx_idx").on(t.transactionId)]
);

/**
 * Tags/Labels: haushaltsweit, keine Konto-Bindung und keine
 * Sichtbarkeitslogik — Buchungen bleiben über die Kontorechte gefiltert.
 */
export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Zuordnung Buchung ↔ Tag (mehrere Tags pro Buchung) */
export const transactionTags = sqliteTable(
  "transaction_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  t => [
    uniqueIndex("tx_tag_unique_idx").on(t.transactionId, t.tagId),
    index("tx_tag_tag_idx").on(t.tagId),
  ]
);

export const budgets = sqliteTable("budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id").notNull().unique(),
  // Cent pro Zeitraum (Monat bzw. Jahr, je nach period)
  amount: integer("amount").notNull(),
  period: text("period", { enum: ["monthly", "yearly"] })
    .notNull()
    .default("monthly"),
  // Rollover (nur bei period "monthly"): unverbrauchtes Budget wird in den
  // Folgemonat übertragen (Auswertung in api/lib/budgets.ts)
  rollover: integer("rollover", { mode: "boolean" }).notNull().default(false),
  // Anker für den Rollover; NULL bei Bestandsbudgets (= Jahresanfang)
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
});

export const recurring = sqliteTable("recurring", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["income", "expense", "transfer"] }).notNull(),
  accountId: integer("account_id").notNull(),
  // Zielkonto bei type "transfer" (Dauerauftrag zwischen Konten)
  toAccountId: integer("to_account_id"),
  amount: integer("amount").notNull(),
  categoryId: integer("category_id"),
  userId: integer("user_id").notNull(),
  note: text("note").notNull().default(""),
  interval: text("interval", {
    enum: ["weekly", "monthly", "yearly"],
  }).notNull(),
  nextDate: text("next_date").notNull(), // YYYY-MM-DD
  // Optionales Enddatum (YYYY-MM-DD): letztes verbuchtes Vorkommen; NULL =
  // kein Ende. Abgelaufen (endDate < heute) = „archiviert" in der UI.
  endDate: text("end_date"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const savingsGoals = sqliteTable("savings_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // NULL = offenes Sparziel ohne Zielbetrag (nur angesparter Betrag)
  targetAmount: integer("target_amount"),
  savedAmount: integer("saved_amount").notNull().default(0),
  color: text("color").notNull(),
  deadline: text("deadline"), // YYYY-MM-DD
});

/**
 * Einzelne Beiträge der Haushaltsmitglieder zu einem Sparziel.
 * Gesamtfortschritt = savings_goals.saved_amount (Basis, manuell
 * anpassbar, Alt-Daten) + Summe dieser Beiträge.
 */
export const goalContributions = sqliteTable(
  "goal_contributions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id").notNull(),
    userId: integer("user_id").notNull(), // Beitragszahler
    amount: integer("amount").notNull(), // Cent, positiv
    note: text("note").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("goal_contrib_goal_idx").on(t.goalId)]
);

/**
 * Konto-Verknüpfungen eines Sparziels (Sparziele 2.0): der Fortschritt
 * ergibt sich aus den verknüpften Konten — Modus "full" (ganzer Saldo),
 * "absolute" (fixer Anteil in Cent, value > 0) oder "percent" (1–100 % des
 * Saldos, value). Fachlich gilt: max. EINE Quelle pro Konto und Ziel.
 * Auswertung zentral in api/lib/goalProgress.ts.
 */
export const goalSources = sqliteTable(
  "goal_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id").notNull(),
    accountId: integer("account_id").notNull(),
    mode: text("mode", { enum: ["full", "absolute", "percent"] }).notNull(),
    // absolute: Cent > 0; percent: 1–100; full: NULL
    value: integer("value"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("goal_sources_goal_idx").on(t.goalId)]
);

/* -------------------------------- Audit-Log -------------------------------- */

/**
 * Aktivitäts-/Audit-Log: Chronik der fachlichen Mutationen des Haushalts
 * („Wer hat was gebucht/geändert"). userId NULL = System bzw. Vorgänge vor
 * dem Login (z. B. fehlgeschlagene Anmeldung). Details enthalten niemals
 * Passwörter, Codes oder Tokens.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id"),
    // Konvention: "<entity>.<verb>", z. B. "transaction.created"
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: integer("entity_id"),
    detail: text("detail").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("audit_created_idx").on(t.createdAt)]
);

/* ------------------------------ App-Einstellungen ------------------------- */

/** Key-Value-Store für haushaltsweite Einstellungen (z. B. Währung) */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
