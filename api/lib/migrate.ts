import { getDb, markDirty } from "../queries/connection";

/** Minimal-Typ für den better-sqlite3-kompatiblen Proxy hinter db.$client */
type RawClient = {
  prepare(sql: string): { raw(): { all(...params: unknown[]): unknown[][] } };
};

/**
 * Stellt sicher, dass alle Tabellen existieren.
 * Führt beim Serverstart einmalig CREATE TABLE IF NOT EXISTS aus —
 * idempotent, entspricht db/schema.ts.
 */
export function ensureSchema() {
  const db = getDb();
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      color TEXT NOT NULL DEFAULT '#10b981',
      active INTEGER NOT NULL DEFAULT 1,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      quick_account_id INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS account_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      builtin INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      initial_balance INTEGER NOT NULL DEFAULT 0,
      owner_id INTEGER,
      bank_id INTEGER,
      iban TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS account_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      can_edit INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS account_perm_unique_idx
      ON account_permissions (account_id, user_id)`,
    `CREATE TABLE IF NOT EXISTS account_owners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS account_owners_unique_idx
      ON account_owners (account_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS account_owners_account_idx
      ON account_owners (account_id)`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT NOT NULL,
      parent_id INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS split_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      shares TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      to_account_id INTEGER,
      amount INTEGER NOT NULL,
      category_id INTEGER,
      user_id INTEGER NOT NULL,
      project_id INTEGER,
      date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      recurring_id INTEGER,
      storno_of_id INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS tx_date_idx ON transactions (date)`,
    `CREATE INDEX IF NOT EXISTS tx_account_idx ON transactions (account_id)`,
    `CREATE TABLE IF NOT EXISTS transaction_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS split_tx_idx ON transaction_splits (transaction_id)`,
    `CREATE TABLE IF NOT EXISTS transaction_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      changes TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS tx_change_tx_idx ON transaction_changes (transaction_id)`,
    `CREATE TABLE IF NOT EXISTS transaction_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS attachment_tx_idx ON transaction_attachments (transaction_id)`,
    `CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS transaction_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tx_tag_unique_idx
      ON transaction_tags (transaction_id, tag_id)`,
    `CREATE INDEX IF NOT EXISTS tx_tag_tag_idx ON transaction_tags (tag_id)`,
    `CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      period TEXT NOT NULL DEFAULT 'monthly',
      rollover INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      to_account_id INTEGER,
      amount INTEGER NOT NULL,
      category_id INTEGER,
      user_id INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      interval TEXT NOT NULL,
      next_date TEXT NOT NULL,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS savings_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_amount INTEGER,
      saved_amount INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL,
      deadline TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS goal_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS goal_contrib_goal_idx
      ON goal_contributions (goal_id)`,
    `CREATE TABLE IF NOT EXISTS goal_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      value INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS goal_sources_goal_idx
      ON goal_sources (goal_id)`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      detail TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at)`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    // Vorsorge-Modul (privat pro Benutzer, synchron mit db/schema.ts)
    `CREATE TABLE IF NOT EXISTS pension_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      country TEXT NOT NULL DEFAULT 'CH',
      birth_date TEXT NOT NULL,
      retirement_age INTEGER NOT NULL DEFAULT 65,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pension_salaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      gross_monthly INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS pension_salaries_user_month_idx
      ON pension_salaries (user_id, valid_from)`,
    `CREATE TABLE IF NOT EXISTS pension_deductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      salary_id INTEGER,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      value INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )`,
    // Der Index auf salary_id steht bewusst NICHT hier: die Spalte wird bei
    // Bestands-DBs erst weiter unten guardiert nachgerüstet (ALTER TABLE) —
    // ein Index hier würde beim Start auf „no such column: salary_id" laufen.
    `CREATE TABLE IF NOT EXISTS pension_ahv (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      ahv_number TEXT,
      contribution_years INTEGER,
      expected_monthly_pension INTEGER,
      notes TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS pension_funds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'pension_fund',
      current_capital INTEGER NOT NULL DEFAULT 0,
      yearly_savings INTEGER NOT NULL DEFAULT 0,
      interest_rate_bp INTEGER NOT NULL DEFAULT 0,
      conversion_rate_bp INTEGER NOT NULL DEFAULT 680,
      notes TEXT NOT NULL DEFAULT '',
      employer TEXT,
      insured_salary INTEGER,
      coordination_deduction INTEGER,
      buy_in_potential INTEGER,
      disability_pension INTEGER,
      death_benefit INTEGER,
      value_date TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS pension_fund_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fund_id INTEGER NOT NULL,
      age_from INTEGER NOT NULL,
      employee_rate_bp INTEGER NOT NULL DEFAULT 0,
      employer_rate_bp INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS pension_fund_tiers_fund_idx
      ON pension_fund_tiers (fund_id)`,
    `CREATE TABLE IF NOT EXISTS pension_pillar3 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      institution TEXT NOT NULL DEFAULT '',
      current_balance INTEGER NOT NULL DEFAULT 0,
      yearly_deposit INTEGER NOT NULL DEFAULT 0,
      interest_rate_bp INTEGER NOT NULL DEFAULT 0,
      account_id INTEGER,
      notes TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS pension_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS pension_att_entity_idx
      ON pension_attachments (entity_type, entity_id)`,
    `CREATE TABLE IF NOT EXISTS pension_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      changes TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS pension_changes_user_idx
      ON pension_changes (user_id, created_at)`,

    // Hypotheken-Modul (haushaltsweit, synchron mit db/schema.ts).
    // Neue Tabellen: die Indizes dürfen hier stehen, weil CREATE TABLE und
    // CREATE INDEX zusammen laufen — der Guard-Zwang gilt nur für Spalten,
    // die per ALTER TABLE an Bestandstabellen nachgerüstet werden.
    `CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'CH',
      usage TEXT NOT NULL DEFAULT 'owner_occupied',
      purchase_price INTEGER NOT NULL DEFAULT 0,
      purchase_date TEXT,
      market_value INTEGER NOT NULL DEFAULT 0,
      value_date TEXT,
      household_income INTEGER NOT NULL DEFAULT 0,
      first_mortgage_limit_bp INTEGER NOT NULL DEFAULT 6667,
      max_ltv_bp INTEGER NOT NULL DEFAULT 8000,
      calc_interest_rate_bp INTEGER NOT NULL DEFAULT 500,
      maintenance_rate_bp INTEGER NOT NULL DEFAULT 100,
      amortization_years INTEGER NOT NULL DEFAULT 15,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS mortgage_tranches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'fixed',
      principal INTEGER NOT NULL DEFAULT 0,
      balance_date TEXT,
      interest_rate_bp INTEGER NOT NULL DEFAULT 0,
      margin_bp INTEGER,
      bank_id INTEGER,
      start_date TEXT NOT NULL,
      maturity_date TEXT,
      payment_interval TEXT NOT NULL DEFAULT 'quarterly',
      interest_recurring_id INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS mortgage_tranches_property_idx
      ON mortgage_tranches (property_id)`,
    `CREATE TABLE IF NOT EXISTS mortgage_amortizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      tranche_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'direct',
      amount INTEGER NOT NULL DEFAULT 0,
      interval TEXT NOT NULL DEFAULT 'yearly',
      account_id INTEGER,
      start_date TEXT NOT NULL,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      recurring_id INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS mortgage_amort_property_idx
      ON mortgage_amortizations (property_id)`,
    `CREATE TABLE IF NOT EXISTS mortgage_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      changes TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS mortgage_changes_created_idx
      ON mortgage_changes (created_at)`,
  ];
  for (const sql of stmts) {
    db.run(sql as never);
  }

  // Bestands-DBs nachträglich um neue Spalten ergänzen (ensureSchema ist
  // idempotent, aber nicht-migrierend — CREATE TABLE ändert bestehende
  // Tabellen nicht). Bestehende Konten bleiben so Gemeinschaftskonten
  // (owner_id NULL), das heutige Verhalten ändert sich nicht.
  const raw = (db as unknown as { $client: RawClient }).$client;
  const accountCols = raw.prepare("PRAGMA table_info(accounts)").raw().all();
  if (!accountCols.some(col => col[1] === "owner_id")) {
    db.run("ALTER TABLE accounts ADD COLUMN owner_id INTEGER" as never);
  }
  if (!accountCols.some(col => col[1] === "bank_id")) {
    db.run("ALTER TABLE accounts ADD COLUMN bank_id INTEGER" as never);
  }
  if (!accountCols.some(col => col[1] === "iban")) {
    db.run("ALTER TABLE accounts ADD COLUMN iban TEXT" as never);
  }
  // Migration: Konto gehört dem Ersteller — die bisherigen Einzel-Besitzer
  // (accounts.owner_id) waren zugleich die Ersteller ihrer Privatkonten und
  // werden in die Besitzerliste account_owners übernommen. Guardiert: nur
  // wenn account_owners noch leer ist UND Konten mit owner_id existieren
  // (idempotent; die Spalte owner_id selbst bleibt physisch bestehen).
  const ownerRowCount = raw
    .prepare("SELECT COUNT(*) FROM account_owners")
    .raw()
    .all()[0][0] as number;
  const legacyOwnerCount = raw
    .prepare("SELECT COUNT(*) FROM accounts WHERE owner_id IS NOT NULL")
    .raw()
    .all()[0][0] as number;
  if (ownerRowCount === 0 && legacyOwnerCount > 0) {
    db.run(
      `INSERT INTO account_owners (account_id, user_id)
       SELECT id, owner_id FROM accounts WHERE owner_id IS NOT NULL` as never
    );
  }
  // 2FA/TOTP: Secret und Aktivierungs-Flag an Bestands-DBs nachrüsten
  const userCols = raw.prepare("PRAGMA table_info(users)").raw().all();
  if (!userCols.some(col => col[1] === "totp_secret")) {
    db.run("ALTER TABLE users ADD COLUMN totp_secret TEXT" as never);
  }
  if (!userCols.some(col => col[1] === "totp_enabled")) {
    db.run(
      "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0" as never
    );
  }
  // Schnellerfassung: konfiguriertes Konto an Bestands-DBs nachrüsten
  if (!userCols.some(col => col[1] === "quick_account_id")) {
    db.run("ALTER TABLE users ADD COLUMN quick_account_id INTEGER" as never);
  }
  // Dauerbuchungen: Zielkonto für wiederkehrende Umbuchungen nachrüsten
  const recurringCols = raw.prepare("PRAGMA table_info(recurring)").raw().all();
  if (!recurringCols.some(col => col[1] === "to_account_id")) {
    db.run("ALTER TABLE recurring ADD COLUMN to_account_id INTEGER" as never);
  }
  // Dauerbuchungen: optionales Enddatum nachrüsten (NULL = kein Ende)
  if (!recurringCols.some(col => col[1] === "end_date")) {
    db.run("ALTER TABLE recurring ADD COLUMN end_date TEXT" as never);
  }
  // Kategorien-Hierarchie: parent_id für Unterkategorien nachrüsten
  const categoryCols = raw.prepare("PRAGMA table_info(categories)").raw().all();
  if (!categoryCols.some(col => col[1] === "parent_id")) {
    db.run("ALTER TABLE categories ADD COLUMN parent_id INTEGER" as never);
  }
  // Projekte: project_id an Buchungen nachrüsten (NULL = laufender Haushalt)
  const txCols = raw.prepare("PRAGMA table_info(transactions)").raw().all();
  if (!txCols.some(col => col[1] === "project_id")) {
    db.run("ALTER TABLE transactions ADD COLUMN project_id INTEGER" as never);
  }
  // Storno: Verweis der Storno-Buchung auf das Original nachrüsten
  if (!txCols.some(col => col[1] === "storno_of_id")) {
    db.run("ALTER TABLE transactions ADD COLUMN storno_of_id INTEGER" as never);
  }
  // Budgets: Zeitraum (Monat/Jahr), Rollover und Anker-Datum nachrüsten.
  // Bestandsbudgets bleiben Monatsbudgets ohne Rollover (created_at NULL =
  // Rollover-Anker am Jahresanfang, siehe api/lib/budgets.ts).
  const budgetCols = raw.prepare("PRAGMA table_info(budgets)").raw().all();
  if (!budgetCols.some(col => col[1] === "period")) {
    db.run(
      "ALTER TABLE budgets ADD COLUMN period TEXT NOT NULL DEFAULT 'monthly'" as never
    );
  }
  if (!budgetCols.some(col => col[1] === "rollover")) {
    db.run(
      "ALTER TABLE budgets ADD COLUMN rollover INTEGER NOT NULL DEFAULT 0" as never
    );
  }
  if (!budgetCols.some(col => col[1] === "created_at")) {
    db.run("ALTER TABLE budgets ADD COLUMN created_at INTEGER" as never);
  }
  // Pensionskassen: Versicherungsausweis-Felder an Bestands-DBs nachrüsten
  // (alle nullable, Beträge in Cent; Abstufungen liegen in pension_fund_tiers)
  const pensionFundCols = raw
    .prepare("PRAGMA table_info(pension_funds)")
    .raw()
    .all();
  for (const [col, ddl] of [
    ["employer", "ALTER TABLE pension_funds ADD COLUMN employer TEXT"],
    [
      "insured_salary",
      "ALTER TABLE pension_funds ADD COLUMN insured_salary INTEGER",
    ],
    [
      "coordination_deduction",
      "ALTER TABLE pension_funds ADD COLUMN coordination_deduction INTEGER",
    ],
    [
      "buy_in_potential",
      "ALTER TABLE pension_funds ADD COLUMN buy_in_potential INTEGER",
    ],
    [
      "disability_pension",
      "ALTER TABLE pension_funds ADD COLUMN disability_pension INTEGER",
    ],
    [
      "death_benefit",
      "ALTER TABLE pension_funds ADD COLUMN death_benefit INTEGER",
    ],
    ["value_date", "ALTER TABLE pension_funds ADD COLUMN value_date TEXT"],
  ] as const) {
    if (!pensionFundCols.some(c => c[1] === col)) {
      db.run(ddl as never);
    }
  }
  // Lohnabzüge: salary_id für eintragsbezogene Abzüge nachrüsten
  // (NULL = global, gilt für alle Löhne — Bestandszeilen bleiben global)
  const pensionDeductionCols = raw
    .prepare("PRAGMA table_info(pension_deductions)")
    .raw()
    .all();
  if (!pensionDeductionCols.some(c => c[1] === "salary_id")) {
    db.run(
      "ALTER TABLE pension_deductions ADD COLUMN salary_id INTEGER" as never
    );
  }
  // Index erst jetzt anlegen — vorher existiert die Spalte in Bestands-DBs nicht
  db.run(
    `CREATE INDEX IF NOT EXISTS pension_deductions_salary_idx
      ON pension_deductions (salary_id)` as never
  );
  // Offene Sparziele: target_amount wird nullable (NULL = ohne Zielbetrag).
  // NOT NULL lässt sich per ALTER nicht entfernen — Bestands-Tabellen daher
  // neu aufbauen und Daten kopieren (idempotent über das notnull-Flag,
  // PRAGMA table_info: col[1] = Name, col[3] = notnull).
  const goalCols = raw.prepare("PRAGMA table_info(savings_goals)").raw().all();
  const targetCol = goalCols.find(col => col[1] === "target_amount");
  if (targetCol && targetCol[3] === 1) {
    db.run("BEGIN" as never);
    try {
      db.run(
        `CREATE TABLE savings_goals_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          target_amount INTEGER,
          saved_amount INTEGER NOT NULL DEFAULT 0,
          color TEXT NOT NULL,
          deadline TEXT
        )` as never
      );
      db.run(
        `INSERT INTO savings_goals_new
           (id, name, target_amount, saved_amount, color, deadline)
         SELECT id, name, target_amount, saved_amount, color, deadline
           FROM savings_goals` as never
      );
      db.run("DROP TABLE savings_goals" as never);
      db.run("ALTER TABLE savings_goals_new RENAME TO savings_goals" as never);
      db.run("COMMIT" as never);
    } catch (err) {
      db.run("ROLLBACK" as never);
      throw err;
    }
  }

  // Builtin-Kontotypen seeden — nur fehlende Keys ergänzen, bestehende
  // Einträge (z. B. umbenannte) niemals überschreiben.
  for (const [key, name] of [
    ["checking", "Girokonto"],
    ["cash", "Bargeld"],
    ["savings", "Sparkonto"],
  ] as const) {
    db.run(
      `INSERT OR IGNORE INTO account_types (key, name, builtin)
       VALUES ('${key}', '${name}', 1)` as never
    );
  }

  markDirty();
}
