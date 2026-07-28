import {
  sqliteTable, text, integer, index, uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* ---------------------------------- Auth ---------------------------------- */

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  color: text("color").notNull().default("#10b981"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const authTokens = sqliteTable("auth_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  purpose: text("purpose", { enum: ["invite", "reset"] }).notNull(),
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
  // NULL = Gemeinschaftskonto (für alle sicht-/editierbar), sonst Besitzer-User
  ownerId: integer("owner_id"),
  bankId: integer("bank_id"),
  iban: text("iban"), // normalisiert: ohne Leerzeichen, Großbuchstaben
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Individuelle Freigaben privater Konten für andere Haushaltsmitglieder */
export const accountPermissions = sqliteTable("account_permissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  userId: integer("user_id").notNull(),
  canEdit: integer("can_edit", { mode: "boolean" }).notNull().default(false),
}, (t) => [
  uniqueIndex("account_perm_unique_idx").on(t.accountId, t.userId),
]);

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  color: text("color").notNull(),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["income", "expense", "transfer"] }).notNull(),
  accountId: integer("account_id").notNull(),
  toAccountId: integer("to_account_id"),
  amount: integer("amount").notNull(), // Cent, positiv
  categoryId: integer("category_id"),
  userId: integer("user_id").notNull(), // wer hat gebucht/bezahlt
  date: text("date").notNull(), // YYYY-MM-DD
  note: text("note").notNull().default(""),
  recurringId: integer("recurring_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  index("tx_date_idx").on(t.date),
  index("tx_account_idx").on(t.accountId),
]);

export const transactionSplits = sqliteTable("transaction_splits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  transactionId: integer("transaction_id").notNull(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(), // Cent
}, (t) => [
  index("split_tx_idx").on(t.transactionId),
]);

/** Beleg-/Foto-Anhänge einer Buchung; Dateien liegen im Attachments-Verzeichnis */
export const transactionAttachments = sqliteTable("transaction_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  transactionId: integer("transaction_id").notNull(),
  // Zufälliger Dateiname im Attachments-Verzeichnis (eindeutig)
  storedName: text("stored_name").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  index("attachment_tx_idx").on(t.transactionId),
]);

export const budgets = sqliteTable("budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id").notNull().unique(),
  amount: integer("amount").notNull(), // Cent / Monat
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
  interval: text("interval", { enum: ["weekly", "monthly", "yearly"] }).notNull(),
  nextDate: text("next_date").notNull(), // YYYY-MM-DD
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const savingsGoals = sqliteTable("savings_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  targetAmount: integer("target_amount").notNull(),
  savedAmount: integer("saved_amount").notNull().default(0),
  color: text("color").notNull(),
  deadline: text("deadline"), // YYYY-MM-DD
});

/* ------------------------------ App-Einstellungen ------------------------- */

/** Key-Value-Store für haushaltsweite Einstellungen (z. B. Währung) */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
