import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
// Bewusst relativ statt über @contracts/* — drizzle-kit liest diese Datei
// direkt und löst die tsconfig-Aliase nicht zuverlässig auf.
import { RECURRING_INTERVALS } from "../contracts/types";

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
  // Konfiguriertes Konto der Schnellerfassung (NULL = automatisch: erstes
  // Konto mit „edit"-Recht) — siehe QuickAddDialog
  quickAccountId: integer("quick_account_id"),
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
  // Werte aus RECURRING_INTERVALS (@contracts/types) — die Spalte hat in
  // SQLite bewusst keine CHECK-Constraint, das Enum wirkt rein typseitig.
  interval: text("interval", {
    enum: RECURRING_INTERVALS,
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

/* --------------------------------- Vorsorge -------------------------------- */

/**
 * Modul „Vorsorge" (Schweizer 3-Säulen-Prinzip): alle Tabellen sind strikt
 * privat pro Benutzer (userId-Scope in jedem Endpunkt) — es gibt bewusst
 * keine Haushalts-Sichtbarkeit. Das country-Feld (Default "CH") und die
 * austauschbare Prognose-Engine (api/lib/pension/) halten das Modul für
 * spätere Länder offen.
 */

/** Vorsorge-Profil (1:1 pro Benutzer): Geburtsdatum + Rentenalter */
export const pensionProfiles = sqliteTable("pension_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique(),
  // Ländercode für die Prognose-Engine (derzeit nur "CH" implementiert)
  country: text("country").notNull().default("CH"),
  birthDate: text("birth_date").notNull(), // YYYY-MM-DD
  retirementAge: integer("retirement_age").notNull().default(65),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Lohn-Timeline: „Fix" = ein Eintrag, variabel = monatliche Einträge.
 * Der gültige Lohn eines Monats ist der letzte Eintrag mit valid_from ≤ Monat.
 */
export const pensionSalaries = sqliteTable(
  "pension_salaries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    validFrom: text("valid_from").notNull(), // YYYY-MM
    grossMonthly: integer("gross_monthly").notNull(), // Cent
    note: text("note").notNull().default(""),
  },
  t => [
    uniqueIndex("pension_salaries_user_month_idx").on(t.userId, t.validFrom),
  ]
);

/**
 * Lohnabzüge (AHV/IV/EO, ALV, PK-Anteil etc.) für die Netto-Berechnung.
 * salaryId NULL = globaler Abzug (gilt für alle Löhne), gesetzt = Abzug nur
 * für diesen Lohneintrag (wird beim Löschen des Lohns kaskadiert).
 */
export const pensionDeductions = sqliteTable(
  "pension_deductions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    salaryId: integer("salary_id"),
    name: text("name").notNull(),
    mode: text("mode", { enum: ["percent", "absolute"] }).notNull(),
    // percent: Basispunkte (530 = 5,30 %); absolute: Cent
    value: integer("value").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("pension_deductions_salary_idx").on(t.salaryId)]
);

/** Säule 1 (AHV, 1:1 pro Benutzer) — AHV-Nummer ist sensibel und optional */
export const pensionAhv = sqliteTable("pension_ahv", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique(),
  ahvNumber: text("ahv_number"),
  contributionYears: integer("contribution_years"),
  expectedMonthlyPension: integer("expected_monthly_pension"), // Cent
  notes: text("notes").notNull().default(""),
});

/** Säule 2: Pensionskassen und Freizügigkeitskonten (n pro Benutzer) */
export const pensionFunds = sqliteTable("pension_funds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["pension_fund", "vested_benefits"] })
    .notNull()
    .default("pension_fund"),
  currentCapital: integer("current_capital").notNull().default(0), // Cent
  yearlySavings: integer("yearly_savings").notNull().default(0), // Cent
  interestRateBp: integer("interest_rate_bp").notNull().default(0), // Basispunkte p.a.
  // Umwandlungssatz in Basispunkten (680 = 6,8 %)
  conversionRateBp: integer("conversion_rate_bp").notNull().default(680),
  notes: text("notes").notNull().default(""),
  // Versicherungsausweis-Felder (alle optional, Beträge in Cent)
  employer: text("employer"), // Arbeitgeber
  insuredSalary: integer("insured_salary"), // versicherter Jahreslohn
  coordinationDeduction: integer("coordination_deduction"), // Koordinationsabzug
  buyInPotential: integer("buy_in_potential"), // Einkaufspotenzial
  disabilityPension: integer("disability_pension"), // Invalidenrente pro Jahr
  deathBenefit: integer("death_benefit"), // Todesfallkapital
  // Stichtag der Angaben (YYYY-MM-DD, z. B. 31.12. des Ausweises) — die
  // Prognose akkumuliert ab diesem Datum; NULL = ab aktuellem Monat
  valueDate: text("value_date"),
});

/**
 * Sparbeitrags-Abstufungen einer Pensionskasse nach Alter — Sätze in
 * Basispunkten, getrennt nach Arbeitnehmer-/Arbeitgeberanteil.
 */
export const pensionFundTiers = sqliteTable(
  "pension_fund_tiers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fundId: integer("fund_id").notNull(),
    ageFrom: integer("age_from").notNull(),
    employeeRateBp: integer("employee_rate_bp").notNull().default(0),
    employerRateBp: integer("employer_rate_bp").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("pension_fund_tiers_fund_idx").on(t.fundId)]
);

/**
 * Säule 3a (n pro Benutzer). Bei account_id-Verknüpfung mit einem Finanz-Konto
 * zählt der dortige Saldo (current_balance ist dann irrelevant).
 */
export const pensionPillar3 = sqliteTable("pension_pillar3", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  institution: text("institution").notNull().default(""),
  currentBalance: integer("current_balance").notNull().default(0), // Cent
  yearlyDeposit: integer("yearly_deposit").notNull().default(0), // Cent
  interestRateBp: integer("interest_rate_bp").notNull().default(0), // Basispunkte p.a.
  accountId: integer("account_id"),
  notes: text("notes").notNull().default(""),
});

/** Datei-Anhänge der Vorsorge (AHV-Ausweis, PK-Ausweise, 3a-Belege) */
export const pensionAttachments = sqliteTable(
  "pension_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    entityType: text("entity_type", {
      enum: ["ahv", "fund", "pillar3"],
    }).notNull(),
    entityId: integer("entity_id").notNull(),
    // Zufälliger Dateiname im Attachments-Verzeichnis (eindeutig)
    storedName: text("stored_name").notNull().unique(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("pension_att_entity_idx").on(t.entityType, t.entityId)]
);

/**
 * Änderungshistorie des Vorsorge-Moduls (Muster: transaction_changes).
 * entity: profile | salary | deduction | ahv | fund | pillar3;
 * changes = JSON-Text [{field, from, to}] mit deutschen Feldnamen,
 * Beträge roh in Cent.
 */
export const pensionChanges = sqliteTable(
  "pension_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    entity: text("entity").notNull(),
    entityId: integer("entity_id").notNull(),
    comment: text("comment").notNull().default(""),
    changes: text("changes").notNull(), // JSON: [{ field, from, to }]
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("pension_changes_user_idx").on(t.userId, t.createdAt)]
);

/* -------------------------------- Hypotheken ------------------------------- */

/**
 * Wohneigentum & Hypotheken — anders als die Vorsorge **haushaltsweit**
 * sichtbar (kein user_id-Scoping): Das Eigenheim gehört in aller Regel
 * allen Haushaltsmitgliedern. Verknüpfte Finanz-Konten werden weiterhin
 * über die Konto-Rechte geprüft (lib/accountAccess.ts).
 *
 * Konventionen wie überall: Beträge in Cent, Prozentsätze in Basispunkten
 * (530 = 5,30 %), Datum als TEXT `YYYY-MM-DD`.
 */

/**
 * Liegenschaft. Die fünf bp-Felder sind die Bank-Parameter der
 * Tragbarkeits- und Belehnungsrechnung — sie unterscheiden sich je nach
 * Bank und Nutzungsart und sind deshalb pro Objekt überschreibbar
 * (Defaults = Schweizer Marktstandard für selbstbewohntes Wohneigentum).
 */
export const properties = sqliteTable("properties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  // Ländercode für die Berechnungs-Engine (derzeit nur "CH" implementiert)
  country: text("country").notNull().default("CH"),
  usage: text("usage", {
    enum: ["owner_occupied", "rental", "vacation"],
  })
    .notNull()
    .default("owner_occupied"),
  purchasePrice: integer("purchase_price").notNull().default(0), // Cent
  purchaseDate: text("purchase_date"), // YYYY-MM-DD
  marketValue: integer("market_value").notNull().default(0), // Cent
  valueDate: text("value_date"), // Stichtag des Verkehrswerts
  // Bruttojahreseinkommen des Haushalts für die Tragbarkeit. Bewusst manuell:
  // die Lohndaten der Vorsorge sind strikt privat pro Benutzer und dürfen in
  // einem haushaltsweiten Modul nicht gelesen werden.
  householdIncome: integer("household_income").notNull().default(0), // Cent
  // Grenze der 1. Hypothek (Default 66,67 % des Verkehrswerts)
  firstMortgageLimitBp: integer("first_mortgage_limit_bp")
    .notNull()
    .default(6667),
  // Maximale Belehnung (Default 80 %; Rendite ≈ 75 %, Ferien 50–66 %)
  maxLtvBp: integer("max_ltv_bp").notNull().default(8000),
  // Kalkulatorischer Zinssatz der Tragbarkeit (Default 5 % = 500 Bp)
  calcInterestRateBp: integer("calc_interest_rate_bp").notNull().default(500),
  // Unterhalt/Nebenkosten in % des Verkehrswerts (Default 1 %)
  maintenanceRateBp: integer("maintenance_rate_bp").notNull().default(100),
  // Frist der Amortisationspflicht in Jahren (Default 15; Rendite 10)
  amortizationYears: integer("amortization_years").notNull().default(15),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Hypothekar-Tranche. `principal` ist die Restschuld **per `balanceDate`**
 * (NULL = per heute) — Muster `pension_funds.value_date`. Bei SARON ist der
 * effektive Satz `interest_rate_bp + margin_bp`; er wird immer gerechnet,
 * nie gespeichert. `interest_recurring_id` verweist auf die aus der Tranche
 * erzeugte Dauerbuchung (NULL = noch keine übernommen).
 */
export const mortgageTranches = sqliteTable(
  "mortgage_tranches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["fixed", "saron", "variable"] })
      .notNull()
      .default("fixed"),
    principal: integer("principal").notNull().default(0), // Cent
    balanceDate: text("balance_date"), // Stichtag der Restschuld
    interestRateBp: integer("interest_rate_bp").notNull().default(0),
    marginBp: integer("margin_bp"), // nur bei SARON
    bankId: integer("bank_id"),
    startDate: text("start_date").notNull(), // YYYY-MM-DD
    maturityDate: text("maturity_date"), // NULL bei saron/variable
    // Zahlungsrhythmus des Zinses (Werte aus RECURRING_INTERVALS)
    paymentInterval: text("payment_interval", { enum: RECURRING_INTERVALS })
      .notNull()
      .default("quarterly"),
    interestRecurringId: integer("interest_recurring_id"),
    notes: text("notes").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("mortgage_tranches_property_idx").on(t.propertyId)]
);

/**
 * Amortisation. `direct` senkt die Restschuld einer konkreten Tranche
 * (`tranche_id` gesetzt); `indirect` zahlt für die gesamte Hypothek auf ein
 * Konto ein (meist Säule 3a) und lässt die Schuld unverändert —
 * `tranche_id` ist dann NULL. Anker ist deshalb immer `property_id`.
 */
export const mortgageAmortizations = sqliteTable(
  "mortgage_amortizations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull(),
    trancheId: integer("tranche_id"), // nur bei kind = "direct"
    kind: text("kind", { enum: ["direct", "indirect"] })
      .notNull()
      .default("direct"),
    amount: integer("amount").notNull().default(0), // Cent pro Intervall
    interval: text("interval", { enum: RECURRING_INTERVALS })
      .notNull()
      .default("yearly"),
    // Zielkonto der indirekten Amortisation (3a-/Sparkonto)
    accountId: integer("account_id"),
    startDate: text("start_date").notNull(), // YYYY-MM-DD
    endDate: text("end_date"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    recurringId: integer("recurring_id"),
    notes: text("notes").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("mortgage_amort_property_idx").on(t.propertyId)]
);

/**
 * Änderungshistorie des Hypotheken-Moduls (Muster: pension_changes).
 * entity: property | tranche | amortization; `user_id` ist hier **wer**
 * geändert hat — kein Sichtbarkeits-Scoping. Gelesen wird chronologisch
 * über den ganzen Haushalt, daher Index nur auf created_at.
 */
export const mortgageChanges = sqliteTable(
  "mortgage_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    entity: text("entity").notNull(),
    entityId: integer("entity_id").notNull(),
    comment: text("comment").notNull().default(""),
    changes: text("changes").notNull(), // JSON: [{ field, from, to }]
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  t => [index("mortgage_changes_created_idx").on(t.createdAt)]
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
