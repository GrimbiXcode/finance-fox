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
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      to_account_id INTEGER,
      amount INTEGER NOT NULL,
      category_id INTEGER,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      recurring_id INTEGER,
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
    `CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL UNIQUE,
      amount INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      category_id INTEGER,
      user_id INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      interval TEXT NOT NULL,
      next_date TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS savings_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_amount INTEGER NOT NULL,
      saved_amount INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL,
      deadline TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
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
  if (!accountCols.some((col) => col[1] === "owner_id")) {
    db.run("ALTER TABLE accounts ADD COLUMN owner_id INTEGER" as never);
  }
  if (!accountCols.some((col) => col[1] === "bank_id")) {
    db.run("ALTER TABLE accounts ADD COLUMN bank_id INTEGER" as never);
  }
  if (!accountCols.some((col) => col[1] === "iban")) {
    db.run("ALTER TABLE accounts ADD COLUMN iban TEXT" as never);
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
       VALUES ('${key}', '${name}', 1)` as never,
    );
  }

  markDirty();
}
