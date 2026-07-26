import {
  sqliteTable, text, integer, index,
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

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: ["checking", "cash", "savings"] }).notNull(),
  initialBalance: integer("initial_balance").notNull().default(0), // Cent
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

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

export const budgets = sqliteTable("budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id").notNull().unique(),
  amount: integer("amount").notNull(), // Cent / Monat
});

export const recurring = sqliteTable("recurring", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  accountId: integer("account_id").notNull(),
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
