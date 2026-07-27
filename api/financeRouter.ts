import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  accountPermissions, accounts, appSettings, budgets, categories, recurring,
  savingsGoals, transactions, transactionSplits, users,
} from "@db/schema";
import { CURRENCY_CODES, DEFAULT_CURRENCY } from "@contracts/types";
import { runRecurringJob } from "./lib/recurringJob";
import {
  listVisibleAccounts, requireAccountAccess, touchesVisibleAccount,
  visibleAccountIds,
} from "./lib/accountAccess";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");

export const financeRouter = createRouter({
  /* --------------------------------- Konten --------------------------------- */

  listAccounts: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [accs, txs] = await Promise.all([
      listVisibleAccounts(db, ctx.user),
      db.select({
        type: transactions.type,
        accountId: transactions.accountId,
        toAccountId: transactions.toAccountId,
        amount: transactions.amount,
      }).from(transactions),
    ]);
    return accs.map((a) => {
      let balance = a.initialBalance;
      for (const t of txs) {
        if (t.type === "transfer") {
          if (t.accountId === a.id) balance -= t.amount;
          if (t.toAccountId === a.id) balance += t.amount;
        } else if (t.accountId === a.id) {
          balance += t.type === "income" ? t.amount : -t.amount;
        }
      }
      return { ...a, balance };
    });
  }),

  createAccount: authedQuery
    .input(z.object({
      name: z.string().min(1),
      type: z.enum(["checking", "cash", "savings"]),
      initialBalance: z.number().int(),
      // true = privates Konto, der anlegende Nutzer wird Besitzer
      private: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db.insert(accounts).values({
        name: input.name,
        type: input.type,
        initialBalance: input.initialBalance,
        ownerId: input.private ? ctx.user.id : null,
        createdAt: new Date(),
      });
      return { ok: true };
    }),

  /** Konto bearbeiten (Name, Typ, Anfangsbestand) — erfordert "edit" */
  updateAccount: authedQuery
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      type: z.enum(["checking", "cash", "savings"]),
      initialBalance: z.number().int(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireAccountAccess(db, ctx.user, input.id, "edit");
      await db.update(accounts)
        .set({
          name: input.name,
          type: input.type,
          initialBalance: input.initialBalance,
        })
        .where(eq(accounts.id, input.id));
      return { ok: true };
    }),

  /**
   * Konto löschen (entschärft): erfordert die Eingabe des exakten Kontonamens.
   * Gemeinschaftskonto: jedes Mitglied; privates Konto: nur Besitzer/Admin.
   */
  deleteAccount: authedQuery
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const account = await db.query.accounts
        .findFirst({ where: eq(accounts.id, input.id) });
      const mayDelete = account && (
        account.ownerId === null ||
        account.ownerId === ctx.user.id ||
        ctx.user.role === "admin"
      );
      // NOT_FOUND statt FORBIDDEN: Existenz privater Konten soll nicht leaken
      if (!account || !mayDelete) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Konto nicht gefunden." });
      }
      if (input.name !== account.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Der eingegebene Kontoname stimmt nicht überein.",
        });
      }
      const txIds = (await db.select({ id: transactions.id }).from(transactions)
        .where(eq(transactions.accountId, input.id))).map((t) => t.id);
      db.transaction((tx) => {
        for (const id of txIds) {
          tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id)).run();
        }
        tx.delete(transactions).where(eq(transactions.accountId, input.id)).run();
        tx.delete(recurring).where(eq(recurring.accountId, input.id)).run();
        tx.delete(accountPermissions).where(eq(accountPermissions.accountId, input.id)).run();
        tx.delete(accounts).where(eq(accounts.id, input.id)).run();
      });
      return { ok: true };
    }),

  /**
   * Konto privat stellen / wieder freigeben.
   * Privat stellen: bei Gemeinschaftskonto jedes Mitglied (wird Besitzer),
   * sonst nur Besitzer/Admin (No-op bei bereits privatem Konto).
   * Freigeben (privat → gemeinsam): nur Besitzer oder Admin; individuelle
   * Freigaben werden dabei entfernt.
   */
  setAccountPrivacy: authedQuery
    .input(z.object({
      id: z.number().int().positive(),
      private: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const account = await db.query.accounts
        .findFirst({ where: eq(accounts.id, input.id) });
      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Konto nicht gefunden." });
      }
      const isOwnerOrAdmin =
        account.ownerId === ctx.user.id || ctx.user.role === "admin";
      if (input.private) {
        if (account.ownerId === null) {
          await db.update(accounts)
            .set({ ownerId: ctx.user.id })
            .where(eq(accounts.id, input.id));
        } else if (!isOwnerOrAdmin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Konto nicht gefunden." });
        }
      } else if (account.ownerId !== null) {
        if (!isOwnerOrAdmin) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Konto nicht gefunden." });
        }
        db.transaction((tx) => {
          tx.update(accounts).set({ ownerId: null })
            .where(eq(accounts.id, input.id)).run();
          tx.delete(accountPermissions)
            .where(eq(accountPermissions.accountId, input.id)).run();
        });
      }
      return { ok: true };
    }),

  /** Besitzer: individuelle Freigabe für ein privates Konto setzen/entziehen */
  setAccountPermission: authedQuery
    .input(z.object({
      accountId: z.number().int().positive(),
      userId: z.number().int().positive(),
      level: z.enum(["none", "view", "edit"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const account = await db.query.accounts
        .findFirst({ where: eq(accounts.id, input.accountId) });
      if (!account || account.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Konto nicht gefunden." });
      }
      const target = await db.query.users
        .findFirst({ where: eq(users.id, input.userId) });
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Benutzer nicht gefunden.",
        });
      }
      if (target.id === account.ownerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Für den Besitzer kann keine Freigabe gesetzt werden.",
        });
      }
      if (input.level === "none") {
        await db.delete(accountPermissions).where(and(
          eq(accountPermissions.accountId, input.accountId),
          eq(accountPermissions.userId, input.userId),
        ));
      } else {
        const canEdit = input.level === "edit";
        await db.insert(accountPermissions)
          .values({
            accountId: input.accountId,
            userId: input.userId,
            canEdit,
          })
          .onConflictDoUpdate({
            target: [accountPermissions.accountId, accountPermissions.userId],
            set: { canEdit },
          });
      }
      return { ok: true };
    }),

  /** Besitzer oder Admin: Freigaben eines Kontos auflisten */
  listAccountPermissions: authedQuery
    .input(z.object({ accountId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const account = await db.query.accounts
        .findFirst({ where: eq(accounts.id, input.accountId) });
      const allowed = account && (
        account.ownerId === ctx.user.id || ctx.user.role === "admin"
      );
      if (!account || !allowed) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Konto nicht gefunden." });
      }
      return db.select().from(accountPermissions)
        .where(eq(accountPermissions.accountId, input.accountId));
    }),

  /* -------------------------------- Kategorien ------------------------------- */

  listCategories: authedQuery.query(() => getDb().select().from(categories)),

  createCategory: authedQuery
    .input(z.object({
      name: z.string().min(1),
      type: z.enum(["income", "expense"]),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }))
    .mutation(async ({ input }) => {
      await getDb().insert(categories).values(input);
      return { ok: true };
    }),

  deleteCategory: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      db.transaction((tx) => {
        tx.update(transactions).set({ categoryId: null }).where(eq(transactions.categoryId, input.id)).run();
        tx.delete(budgets).where(eq(budgets.categoryId, input.id)).run();
        tx.delete(categories).where(eq(categories.id, input.id)).run();
      });
      return { ok: true };
    }),

  /* ------------------------------- Transaktionen ------------------------------ */

  listTransactions: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const visible = await visibleAccountIds(db, ctx.user);
    const [allTxs, splits] = await Promise.all([
      db.select().from(transactions).orderBy(desc(transactions.date), desc(transactions.id)),
      db.select().from(transactionSplits),
    ]);
    // Sichtbar, wenn Quell- ODER Zielkonto sichtbar ist
    const txs = allTxs.filter((t) => touchesVisibleAccount(visible, t));
    const byTx = new Map<number, { userId: number; amount: number }[]>();
    for (const s of splits) {
      const list = byTx.get(s.transactionId) ?? [];
      list.push({ userId: s.userId, amount: s.amount });
      byTx.set(s.transactionId, list);
    }
    return txs.map((t) => ({ ...t, splits: byTx.get(t.id) ?? [] }));
  }),

  createTransaction: authedQuery
    .input(z.object({
      type: z.enum(["income", "expense", "transfer"]),
      accountId: z.number().int().positive(),
      toAccountId: z.number().int().positive().optional(),
      amount: z.number().int().positive(),
      categoryId: z.number().int().positive().optional(),
      userId: z.number().int().positive(),
      date: isoDate,
      note: z.string().default(""),
      splits: z.array(z.object({
        userId: z.number().int().positive(),
        amount: z.number().int().positive(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { splits, ...txData } = input;
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");
      // Bei Umbuchungen muss zumindest das Zielkonto sichtbar sein
      if (input.type === "transfer" && input.toAccountId) {
        await requireAccountAccess(db, ctx.user, input.toAccountId, "view");
      }
      if (splits && splits.length > 0) {
        const sum = splits.reduce((s, x) => s + x.amount, 0);
        if (sum !== input.amount) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Anteile müssen in Summe dem Betrag entsprechen." });
        }
      }
      db.transaction((tx) => {
        const inserted = tx.insert(transactions).values({ ...txData, createdAt: new Date() })
          .returning({ id: transactions.id }).all();
        const txId = inserted[0]?.id;
        if (txId && splits && splits.length > 0) {
          for (const s of splits) {
            tx.insert(transactionSplits).values({ transactionId: txId, ...s }).run();
          }
        }
      });
      return { ok: true };
    }),

  deleteTransaction: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const txRow = await db.query.transactions
        .findFirst({ where: eq(transactions.id, input.id) });
      if (!txRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buchung nicht gefunden.",
        });
      }
      await requireAccountAccess(db, ctx.user, txRow.accountId, "edit");
      db.transaction((tx) => {
        tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, input.id)).run();
        tx.delete(transactions).where(eq(transactions.id, input.id)).run();
      });
      return { ok: true };
    }),

  /* --------------------------------- Budgets --------------------------------- */

  listBudgets: authedQuery.query(() => getDb().select().from(budgets)),

  setBudget: authedQuery
    .input(z.object({
      categoryId: z.number().int().positive(),
      amount: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.budgets.findFirst({ where: eq(budgets.categoryId, input.categoryId) });
      if (existing) {
        await db.update(budgets).set({ amount: input.amount }).where(eq(budgets.id, existing.id));
      } else {
        await db.insert(budgets).values(input);
      }
      return { ok: true };
    }),

  deleteBudget: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await getDb().delete(budgets).where(eq(budgets.id, input.id));
      return { ok: true };
    }),

  /* ------------------------------- Wiederkehrend ------------------------------ */

  listRecurring: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const visible = await visibleAccountIds(db, ctx.user);
    const rows = await db.select().from(recurring);
    return rows.filter((r) => visible.has(r.accountId));
  }),

  createRecurring: authedQuery
    .input(z.object({
      type: z.enum(["income", "expense"]),
      accountId: z.number().int().positive(),
      amount: z.number().int().positive(),
      categoryId: z.number().int().positive().optional(),
      userId: z.number().int().positive(),
      note: z.string().default(""),
      interval: z.enum(["weekly", "monthly", "yearly"]),
      nextDate: isoDate,
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");
      await db.insert(recurring).values({ ...input, active: true, createdAt: new Date() });
      return { ok: true };
    }),

  toggleRecurring: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.recurring.findFirst({ where: eq(recurring.id, input.id) });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await requireAccountAccess(db, ctx.user, row.accountId, "edit");
      await db.update(recurring).set({ active: !row.active }).where(eq(recurring.id, input.id));
      return { ok: true };
    }),

  deleteRecurring: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.recurring.findFirst({ where: eq(recurring.id, input.id) });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await requireAccountAccess(db, ctx.user, row.accountId, "edit");
      await db.delete(recurring).where(eq(recurring.id, input.id));
      return { ok: true };
    }),

  /** Manueller Trigger des Cron-Jobs (z. B. direkt nach dem Anlegen) */
  runRecurringNow: authedQuery.mutation(async () => ({ created: await runRecurringJob() })),

  /* --------------------------------- Sparziele -------------------------------- */

  listGoals: authedQuery.query(() => getDb().select().from(savingsGoals)),

  createGoal: authedQuery
    .input(z.object({
      name: z.string().min(1),
      targetAmount: z.number().int().positive(),
      savedAmount: z.number().int().min(0).default(0),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      deadline: isoDate.optional(),
    }))
    .mutation(async ({ input }) => {
      await getDb().insert(savingsGoals).values(input);
      return { ok: true };
    }),

  updateGoalSaved: authedQuery
    .input(z.object({ id: z.number().int().positive(), savedAmount: z.number().int().min(0) }))
    .mutation(async ({ input }) => {
      await getDb().update(savingsGoals)
        .set({ savedAmount: input.savedAmount })
        .where(eq(savingsGoals.id, input.id));
      return { ok: true };
    }),

  deleteGoal: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await getDb().delete(savingsGoals).where(eq(savingsGoals.id, input.id));
      return { ok: true };
    }),

  /** Vollständiger Import in einem Schritt (serverseitiges Mapping) */
  importLocalFull: authedQuery
    .input(z.object({
      accounts: z.array(z.object({
        oldId: z.string(), name: z.string().min(1),
        type: z.enum(["checking", "cash", "savings"]), initialBalance: z.number().int(),
      })).max(50),
      categories: z.array(z.object({
        oldId: z.string(), name: z.string().min(1),
        type: z.enum(["income", "expense"]), color: z.string(),
      })).max(200),
      transactions: z.array(z.object({
        type: z.enum(["income", "expense", "transfer"]),
        accountId: z.string(), toAccountId: z.string().optional(),
        amount: z.number().int().positive(), categoryId: z.string().optional(),
        memberId: z.string(), date: isoDate, note: z.string(),
        splits: z.array(z.object({ memberId: z.string(), amount: z.number().int() })).optional(),
      })).max(20000),
      budgets: z.array(z.object({ categoryId: z.string(), amount: z.number().int().positive() })).max(200),
      recurring: z.array(z.object({
        type: z.enum(["income", "expense"]), accountId: z.string(),
        amount: z.number().int().positive(), categoryId: z.string().optional(),
        memberId: z.string(), note: z.string(),
        interval: z.enum(["weekly", "monthly", "yearly"]),
        nextDate: isoDate, active: z.boolean(),
      })).max(200),
      goals: z.array(z.object({
        name: z.string().min(1), targetAmount: z.number().int().positive(),
        savedAmount: z.number().int().min(0), color: z.string(), deadline: isoDate.optional(),
      })).max(100),
      memberMap: z.record(z.string(), z.number().int().positive()),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existingTx = await db.select({ id: transactions.id }).from(transactions).limit(1);
      if (existingTx.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Import nur möglich, solange noch keine Buchungen existieren." });
      }
      const accountMap = new Map<string, number>();
      const categoryMap = new Map<string, number>();
      const now = new Date();
      const fallbackUser = ctx.user.id;

      db.transaction((tx) => {
        for (const a of input.accounts) {
          const rows = tx.insert(accounts).values({
            name: a.name, type: a.type, initialBalance: a.initialBalance, createdAt: now,
          }).returning({ id: accounts.id }).all();
          if (rows[0]) accountMap.set(a.oldId, rows[0].id);
        }
        for (const c of input.categories) {
          const rows = tx.insert(categories).values({ name: c.name, type: c.type, color: c.color })
            .returning({ id: categories.id }).all();
          if (rows[0]) categoryMap.set(c.oldId, rows[0].id);
        }
        for (const t of input.transactions) {
          const accountId = accountMap.get(t.accountId);
          if (!accountId) continue;
          const rows = tx.insert(transactions).values({
            type: t.type, accountId,
            toAccountId: t.toAccountId ? accountMap.get(t.toAccountId) : undefined,
            amount: t.amount,
            categoryId: t.categoryId ? categoryMap.get(t.categoryId) : undefined,
            userId: input.memberMap[t.memberId] ?? fallbackUser,
            date: t.date, note: t.note, createdAt: now,
          }).returning({ id: transactions.id }).all();
          if (rows[0] && t.splits && t.splits.length > 0) {
            for (const sp of t.splits) {
              const uid = input.memberMap[sp.memberId];
              if (uid) {
                tx.insert(transactionSplits).values({ transactionId: rows[0].id, userId: uid, amount: sp.amount }).run();
              }
            }
          }
        }
        for (const b of input.budgets) {
          const categoryId = categoryMap.get(b.categoryId);
          if (categoryId) tx.insert(budgets).values({ categoryId, amount: b.amount }).run();
        }
        for (const r of input.recurring) {
          const accountId = accountMap.get(r.accountId);
          if (!accountId) continue;
          tx.insert(recurring).values({
            type: r.type, accountId, amount: r.amount,
            categoryId: r.categoryId ? categoryMap.get(r.categoryId) : undefined,
            userId: input.memberMap[r.memberId] ?? fallbackUser,
            note: r.note, interval: r.interval, nextDate: r.nextDate,
            active: r.active, createdAt: now,
          }).run();
        }
        for (const g of input.goals) {
          tx.insert(savingsGoals).values(g).run();
        }
      });
      return { ok: true };
    }),

  /** Sind bereits Finanzdaten vorhanden? (für Wizard-Import-Angebot) */
  hasData: authedQuery.query(async () => {
    const db = getDb();
    const tx = await db.select({ id: transactions.id }).from(transactions).limit(1);
    const acc = await db.select({ id: accounts.id }).from(accounts).limit(1);
    return { hasTransactions: tx.length > 0, hasAccounts: acc.length > 0 };
  }),

  /** Admin: alle Finanzdaten löschen (Neustart) */
  resetFinanceData: authedQuery.mutation(async () => {
    const db = getDb();
    db.transaction((tx) => {
      tx.delete(transactionSplits).where(ne(transactionSplits.id, -1)).run();
      tx.delete(transactions).where(ne(transactions.id, -1)).run();
      tx.delete(recurring).where(ne(recurring.id, -1)).run();
      tx.delete(budgets).where(ne(budgets.id, -1)).run();
      tx.delete(savingsGoals).where(ne(savingsGoals.id, -1)).run();
      tx.delete(categories).where(ne(categories.id, -1)).run();
      tx.delete(accountPermissions).where(ne(accountPermissions.id, -1)).run();
      tx.delete(accounts).where(ne(accounts.id, -1)).run();
    });
    return { ok: true };
  }),

  /* ---------------------------- App-Einstellungen --------------------------- */

  /** Haushaltsweite Einstellungen lesen (aktuell: Währung) */
  getAppSettings: authedQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(appSettings);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const currency = map.get("currency");
    return {
      currency: (CURRENCY_CODES as readonly string[]).includes(currency ?? "")
        ? (currency as (typeof CURRENCY_CODES)[number])
        : DEFAULT_CURRENCY,
    };
  }),

  /** Admin: Währung für den gesamten Haushalt festlegen */
  setCurrency: adminQuery
    .input(z.object({ currency: z.enum(CURRENCY_CODES) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .insert(appSettings)
        .values({ key: "currency", value: input.currency })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: input.currency },
        });
      return { ok: true };
    }),
});
