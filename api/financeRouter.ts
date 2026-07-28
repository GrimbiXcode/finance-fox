import { z } from "zod";
import { and, desc, eq, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  accountPermissions,
  accounts,
  accountTypes,
  appSettings,
  auditLog,
  banks,
  budgets,
  categories,
  goalContributions,
  projects,
  recurring,
  savingsGoals,
  splitTemplates,
  tags,
  transactions,
  transactionAttachments,
  transactionSplits,
  transactionTags,
  users,
} from "@db/schema";
import { CURRENCY_CODES, DEFAULT_CURRENCY, TAG_COLORS } from "@contracts/types";
import type { ShareWeight } from "@contracts/splitShares";
import { runRecurringJob } from "./lib/recurringJob";
import {
  CSV_HEADER,
  TYPE_LABELS,
  csvEscape,
  csvFieldSeparator,
  formatEuroCsv,
  isValidIsoDate,
  parseCsv,
  parseEuroCsv,
  typeFromLabel,
} from "./lib/csv";
import {
  listVisibleAccounts,
  requireAccountAccess,
  touchesVisibleAccount,
  visibleAccountIds,
} from "./lib/accountAccess";
import { deleteAttachmentsForTransactions } from "./lib/attachments";
import { parseCamt053 } from "./lib/camt";
import { computeBudgetStatuses } from "./lib/budgets";
import { getNotifyConfig, isHttpUrl, sendNotification } from "./lib/notify";
import {
  ensureAccountTypeExists,
  ensureBankExists,
  normalizeIban,
} from "./lib/accountTypes";
import { auditAmount, logAudit } from "./lib/audit";

/** Einzahl/Mehrzahl für deutsche Fehlermeldungen */
const kontoAnzahl = (n: number) => (n === 1 ? "1 Konto" : `${n} Konten`);

const buchungAnzahl = (n: number) => (n === 1 ? "1 Buchung" : `${n} Buchungen`);

/** Kurzdetail einer Buchung fürs Audit-Log: Typ, Betrag, Datum, ggf. Notiz */
const txDetail = (t: {
  type: keyof typeof TYPE_LABELS;
  amount: number;
  date: string;
  note?: string;
}) =>
  `${TYPE_LABELS[t.type]} ${auditAmount(t.amount)} am ${t.date}${t.note ? ` — ${t.note}` : ""}`;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");

/**
 * Meilenstein-Benachrichtigung (25/50/75/100 %) für Sparziele — löst aus,
 * wenn der Fortschritt einen Meilenstein von unten überschreitet.
 * Wird mit dem Gesamtfortschritt (Basis savedAmount + Beiträge) gefüttert.
 */
async function notifyGoalMilestones(
  db: ReturnType<typeof getDb>,
  goal: { name: string; targetAmount: number },
  beforeTotal: number,
  afterTotal: number
) {
  if (goal.targetAmount <= 0) return;
  const beforePct = (beforeTotal / goal.targetAmount) * 100;
  const afterPct = (afterTotal / goal.targetAmount) * 100;
  for (const milestone of [25, 50, 75, 100]) {
    if (beforePct < milestone && afterPct >= milestone) {
      await sendNotification(
        db,
        "goal",
        `Sparziel ${goal.name}: ${milestone} % erreicht`,
        `Beim Sparziel „${goal.name}“ sind ${milestone} % angespart.`
      );
    }
  }
}

export const financeRouter = createRouter({
  /* --------------------------------- Konten --------------------------------- */

  listAccounts: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [accs, txs] = await Promise.all([
      listVisibleAccounts(db, ctx.user),
      db
        .select({
          type: transactions.type,
          accountId: transactions.accountId,
          toAccountId: transactions.toAccountId,
          amount: transactions.amount,
        })
        .from(transactions),
    ]);
    return accs.map(a => {
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

  /**
   * Manueller Kontoabgleich: vergleicht den berechneten Soll-Saldo (gleiche
   * Logik wie listAccounts) mit dem gemeldeten Ist-Saldo und bucht die
   * Differenz als Korrekturbuchung (Einnahme/Ausgabe ohne Kategorie).
   * Bei Differenz 0 wird nichts gebucht. Erfordert "edit" auf dem Konto.
   */
  reconcileAccount: authedQuery
    .input(
      z.object({
        accountId: z.number().int().positive(),
        // Ist-Saldo in Cent (darf negativ sein)
        actualBalance: z.number().int(),
        date: isoDate.optional(),
        note: z.string().default("Kontoabgleich"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const account = await requireAccountAccess(
        db,
        ctx.user,
        input.accountId,
        "edit"
      );
      const txs = await db
        .select({
          type: transactions.type,
          accountId: transactions.accountId,
          toAccountId: transactions.toAccountId,
          amount: transactions.amount,
        })
        .from(transactions);
      // Soll-Saldo: gleiche Logik wie in listAccounts
      let balance = account.initialBalance;
      for (const t of txs) {
        if (t.type === "transfer") {
          if (t.accountId === account.id) balance -= t.amount;
          if (t.toAccountId === account.id) balance += t.amount;
        } else if (t.accountId === account.id) {
          balance += t.type === "income" ? t.amount : -t.amount;
        }
      }
      const difference = input.actualBalance - balance;
      if (difference === 0) return { ok: true, difference: 0 };
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      await db.insert(transactions).values({
        type: difference > 0 ? "income" : "expense",
        accountId: account.id,
        amount: Math.abs(difference),
        categoryId: null,
        userId: ctx.user.id,
        date: input.date ?? today,
        note: input.note,
        createdAt: now,
      });
      logAudit(
        db,
        ctx.user.id,
        "account.reconciled",
        "account",
        account.id,
        `${account.name}: Differenz ${auditAmount(difference)}`
      );
      return { ok: true, difference };
    }),

  /**
   * Saldo-Verlauf eines Kontos als sparsame Punkteserie für ein Chart:
   * Startpunkt (Zeitraum-Beginn mit dem Saldo aus allen früheren Buchungen),
   * jeder Tag mit Saldo-Änderung, Endpunkt (heute mit aktuellem Saldo).
   * Vorzeichenlogik wie listAccounts. Erfordert "view" auf dem Konto.
   */
  accountBalanceHistory: authedQuery
    .input(
      z.object({
        accountId: z.number().int().positive(),
        // Rückblick in Monaten; 0 = komplette Historie ab erster Buchung
        months: z
          .union([z.literal(3), z.literal(6), z.literal(12), z.literal(0)])
          .default(12),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const account = await requireAccountAccess(
        db,
        ctx.user,
        input.accountId,
        "view"
      );
      const txs = await db
        .select({
          type: transactions.type,
          accountId: transactions.accountId,
          toAccountId: transactions.toAccountId,
          amount: transactions.amount,
          date: transactions.date,
        })
        .from(transactions)
        .where(
          or(
            eq(transactions.accountId, account.id),
            eq(transactions.toAccountId, account.id)
          )
        );

      const localIso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const now = new Date();
      const today = localIso(now);

      // Zeitraum-Beginn: heute − months Monate; bei 0 die erste Buchung
      let startDate: string;
      if (input.months === 0) {
        startDate = txs.reduce((min, t) => (t.date < min ? t.date : min), today);
      } else {
        startDate = localIso(
          new Date(
            now.getFullYear(),
            now.getMonth() - input.months,
            now.getDate()
          )
        );
      }

      // Tages-Deltas ab Startdatum sammeln; frühere Buchungen fließen in den
      // Start-Saldo ein, zukünftige Buchungen bleiben außen vor
      let balance = account.initialBalance;
      const deltaByDate = new Map<string, number>();
      for (const t of txs) {
        let delta = 0;
        if (t.type === "transfer") {
          if (t.accountId === account.id) delta -= t.amount;
          if (t.toAccountId === account.id) delta += t.amount;
        } else if (t.accountId === account.id) {
          delta = t.type === "income" ? t.amount : -t.amount;
        }
        if (delta === 0) continue;
        if (t.date < startDate) {
          balance += delta;
          continue;
        }
        if (t.date > today) continue;
        deltaByDate.set(t.date, (deltaByDate.get(t.date) ?? 0) + delta);
      }

      const points: { date: string; balance: number }[] = [
        { date: startDate, balance },
      ];
      for (const date of [...deltaByDate.keys()].sort()) {
        balance += deltaByDate.get(date)!;
        const last = points[points.length - 1];
        // Buchung genau am Startdatum (months=0): in den Startpunkt falten,
        // damit kein Datum doppelt in der Serie auftaucht
        if (last.date === date) last.balance = balance;
        else points.push({ date, balance });
      }
      // Endpunkt heute immer vorhanden (mindestens 2 Punkte für das Chart)
      if (points[points.length - 1].date !== today || points.length === 1) {
        points.push({ date: today, balance });
      }
      return points;
    }),

  createAccount: authedQuery
    .input(
      z.object({
        name: z.string().min(1),
        // Key aus account_types (Builtin oder Custom-Typ)
        type: z.string().min(1),
        initialBalance: z.number().int(),
        bankId: z.number().int().positive().nullish(),
        iban: z.string().max(60).nullish(),
        // true = privates Konto, der anlegende Nutzer wird Besitzer
        private: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await ensureAccountTypeExists(db, input.type);
      await ensureBankExists(db, input.bankId);
      const inserted = await db
        .insert(accounts)
        .values({
          name: input.name,
          type: input.type,
          initialBalance: input.initialBalance,
          bankId: input.bankId ?? null,
          iban: normalizeIban(input.iban),
          ownerId: input.private ? ctx.user.id : null,
          createdAt: new Date(),
        })
        .returning({ id: accounts.id });
      logAudit(
        db,
        ctx.user.id,
        "account.created",
        "account",
        inserted[0]?.id ?? null,
        input.name
      );
      return { ok: true };
    }),

  /** Konto bearbeiten (Name, Typ, Bank, IBAN, Anfangsbestand) — erfordert "edit" */
  updateAccount: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1),
        type: z.string().min(1),
        initialBalance: z.number().int(),
        bankId: z.number().int().positive().nullish(),
        iban: z.string().max(60).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireAccountAccess(db, ctx.user, input.id, "edit");
      await ensureAccountTypeExists(db, input.type);
      await ensureBankExists(db, input.bankId);
      await db
        .update(accounts)
        .set({
          name: input.name,
          type: input.type,
          initialBalance: input.initialBalance,
          bankId: input.bankId ?? null,
          iban: normalizeIban(input.iban),
        })
        .where(eq(accounts.id, input.id));
      logAudit(
        db,
        ctx.user.id,
        "account.updated",
        "account",
        input.id,
        input.name
      );
      return { ok: true };
    }),

  /**
   * Konto löschen (entschärft): erfordert die Eingabe des exakten Kontonamens.
   * Gemeinschaftskonto: jedes Mitglied; privates Konto: nur Besitzer/Admin.
   */
  deleteAccount: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const account = await db.query.accounts.findFirst({
        where: eq(accounts.id, input.id),
      });
      const mayDelete =
        account &&
        (account.ownerId === null ||
          account.ownerId === ctx.user.id ||
          ctx.user.role === "admin");
      // NOT_FOUND statt FORBIDDEN: Existenz privater Konten soll nicht leaken
      if (!account || !mayDelete) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Konto nicht gefunden.",
        });
      }
      if (input.name !== account.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Der eingegebene Kontoname stimmt nicht überein.",
        });
      }
      const txIds = (
        await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.accountId, input.id))
      ).map(t => t.id);
      // Beleg-Zeilen + Dateien der Kontobuchungen entfernen
      await deleteAttachmentsForTransactions(db, txIds);
      db.transaction(tx => {
        for (const id of txIds) {
          tx.delete(transactionSplits)
            .where(eq(transactionSplits.transactionId, id))
            .run();
          tx.delete(transactionTags)
            .where(eq(transactionTags.transactionId, id))
            .run();
        }
        tx.delete(transactions)
          .where(eq(transactions.accountId, input.id))
          .run();
        tx.delete(recurring).where(eq(recurring.accountId, input.id)).run();
        tx.delete(accountPermissions)
          .where(eq(accountPermissions.accountId, input.id))
          .run();
        tx.delete(accounts).where(eq(accounts.id, input.id)).run();
      });
      logAudit(
        db,
        ctx.user.id,
        "account.deleted",
        "account",
        input.id,
        account.name
      );
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
    .input(
      z.object({
        id: z.number().int().positive(),
        private: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const account = await db.query.accounts.findFirst({
        where: eq(accounts.id, input.id),
      });
      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Konto nicht gefunden.",
        });
      }
      const isOwnerOrAdmin =
        account.ownerId === ctx.user.id || ctx.user.role === "admin";
      if (input.private) {
        if (account.ownerId === null) {
          await db
            .update(accounts)
            .set({ ownerId: ctx.user.id })
            .where(eq(accounts.id, input.id));
        } else if (!isOwnerOrAdmin) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Konto nicht gefunden.",
          });
        }
      } else if (account.ownerId !== null) {
        if (!isOwnerOrAdmin) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Konto nicht gefunden.",
          });
        }
        db.transaction(tx => {
          tx.update(accounts)
            .set({ ownerId: null })
            .where(eq(accounts.id, input.id))
            .run();
          tx.delete(accountPermissions)
            .where(eq(accountPermissions.accountId, input.id))
            .run();
        });
      }
      logAudit(
        db,
        ctx.user.id,
        "account.privacy",
        "account",
        input.id,
        `${account.name}: ${input.private ? "privat" : "gemeinsam"}`
      );
      return { ok: true };
    }),

  /** Besitzer: individuelle Freigabe für ein privates Konto setzen/entziehen */
  setAccountPermission: authedQuery
    .input(
      z.object({
        accountId: z.number().int().positive(),
        userId: z.number().int().positive(),
        level: z.enum(["none", "view", "edit"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const account = await db.query.accounts.findFirst({
        where: eq(accounts.id, input.accountId),
      });
      if (!account || account.ownerId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Konto nicht gefunden.",
        });
      }
      const target = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
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
        await db
          .delete(accountPermissions)
          .where(
            and(
              eq(accountPermissions.accountId, input.accountId),
              eq(accountPermissions.userId, input.userId)
            )
          );
      } else {
        const canEdit = input.level === "edit";
        await db
          .insert(accountPermissions)
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
      logAudit(
        db,
        ctx.user.id,
        "account.permission",
        "account",
        input.accountId,
        `${account.name} → ${target.name}: ${input.level}`
      );
      return { ok: true };
    }),

  /** Besitzer oder Admin: Freigaben eines Kontos auflisten */
  listAccountPermissions: authedQuery
    .input(z.object({ accountId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const account = await db.query.accounts.findFirst({
        where: eq(accounts.id, input.accountId),
      });
      const allowed =
        account &&
        (account.ownerId === ctx.user.id || ctx.user.role === "admin");
      if (!account || !allowed) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Konto nicht gefunden.",
        });
      }
      return db
        .select()
        .from(accountPermissions)
        .where(eq(accountPermissions.accountId, input.accountId));
    }),

  /* ---------------------------- Kontotypen & Banken -------------------------- */

  /** Alle Kontotypen: Builtin zuerst, dann alphabetisch nach Name */
  listAccountTypes: authedQuery.query(() =>
    getDb()
      .select()
      .from(accountTypes)
      .orderBy(desc(accountTypes.builtin), accountTypes.name)
  ),

  createAccountType: authedQuery
    .input(z.object({ name: z.string().trim().min(1).max(50) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.select().from(accountTypes);
      if (
        existing.some(t => t.name.toLowerCase() === input.name.toLowerCase())
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ein Kontotyp mit diesem Namen existiert bereits.",
        });
      }
      const key = `custom_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const rows = await db
        .insert(accountTypes)
        .values({ key, name: input.name, builtin: false })
        .returning();
      return rows[0];
    }),

  /** Löschen nur für eigene Typen, die nicht mehr verwendet werden */
  deleteAccountType: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const row = await db.query.accountTypes.findFirst({
        where: eq(accountTypes.id, input.id),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Kontotyp nicht gefunden.",
        });
      }
      if (row.builtin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Standard-Kontotypen können nicht gelöscht werden.",
        });
      }
      const used = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.type, row.key));
      if (used.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Der Kontotyp wird noch von ${kontoAnzahl(used.length)} verwendet.`,
        });
      }
      await db.delete(accountTypes).where(eq(accountTypes.id, input.id));
      return { ok: true };
    }),

  listBanks: authedQuery.query(() =>
    getDb().select().from(banks).orderBy(banks.name)
  ),

  createBank: authedQuery
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.select().from(banks);
      if (
        existing.some(b => b.name.toLowerCase() === input.name.toLowerCase())
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Eine Bank mit diesem Namen existiert bereits.",
        });
      }
      const rows = await db.insert(banks).values(input).returning();
      return rows[0];
    }),

  /** Löschen nur, wenn die Bank keinem Konto mehr zugeordnet ist */
  deleteBank: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const row = await db.query.banks.findFirst({
        where: eq(banks.id, input.id),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bank nicht gefunden.",
        });
      }
      const used = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.bankId, input.id));
      if (used.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Die Bank wird noch von ${kontoAnzahl(used.length)} verwendet.`,
        });
      }
      await db.delete(banks).where(eq(banks.id, input.id));
      return { ok: true };
    }),

  /* -------------------------------- Kategorien ------------------------------- */

  listCategories: authedQuery.query(() => getDb().select().from(categories)),

  createCategory: authedQuery
    .input(
      z.object({
        name: z.string().min(1),
        type: z.enum(["income", "expense"]),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        // Optional: als Unterkategorie dieser Oberkategorie anlegen
        parentId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      let color = input.color;
      if (input.parentId !== undefined) {
        const parent = await db.query.categories.findFirst({
          where: eq(categories.id, input.parentId),
        });
        if (!parent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Oberkategorie nicht gefunden.",
          });
        }
        // Genau eine Hierarchieebene: keine Unter-Unterkategorien
        if (parent.parentId !== null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Unterkategorien können keine weiteren Unterkategorien haben.",
          });
        }
        if (parent.type !== input.type) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Die Unterkategorie muss denselben Typ wie die Oberkategorie haben.",
          });
        }
        // Unterkategorien erben die Farbe der Oberkategorie
        color = parent.color;
      }
      const inserted = await db
        .insert(categories)
        .values({
          name: input.name,
          type: input.type,
          color,
          parentId: input.parentId ?? null,
        })
        .returning({ id: categories.id });
      logAudit(
        db,
        ctx.user.id,
        "category.created",
        "category",
        inserted[0]?.id ?? null,
        input.name
      );
      return { ok: true };
    }),

  deleteCategory: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const cat = await db.query.categories.findFirst({
        where: eq(categories.id, input.id),
      });
      const children = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.parentId, input.id));
      if (children.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Die Kategorie hat noch ${children.length === 1 ? "1 Unterkategorie" : `${children.length} Unterkategorien`} und kann nicht gelöscht werden.`,
        });
      }
      db.transaction(tx => {
        tx.update(transactions)
          .set({ categoryId: null })
          .where(eq(transactions.categoryId, input.id))
          .run();
        tx.delete(budgets).where(eq(budgets.categoryId, input.id)).run();
        tx.delete(categories).where(eq(categories.id, input.id)).run();
      });
      logAudit(
        db,
        ctx.user.id,
        "category.deleted",
        "category",
        input.id,
        cat?.name ?? ""
      );
      return { ok: true };
    }),

  /* -------------------------- Projekte & Vorlagen --------------------------- */

  /** Alle Projekte der Kostenaufteilung, alphabetisch nach Name */
  listProjects: authedQuery.query(() =>
    getDb().select().from(projects).orderBy(projects.name)
  ),

  createProject: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.select().from(projects);
      if (
        existing.some(p => p.name.toLowerCase() === input.name.toLowerCase())
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ein Projekt mit diesem Namen existiert bereits.",
        });
      }
      const rows = await db
        .insert(projects)
        .values({ ...input, createdAt: new Date() })
        .returning();
      logAudit(
        db,
        ctx.user.id,
        "project.created",
        "project",
        rows[0].id,
        input.name
      );
      return rows[0];
    }),

  /** Löschen nur, wenn keine Buchung mehr dem Projekt zugeordnet ist */
  deleteProject: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.projects.findFirst({
        where: eq(projects.id, input.id),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Projekt nicht gefunden.",
        });
      }
      const used = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.projectId, input.id));
      if (used.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Das Projekt wird noch von ${buchungAnzahl(used.length)} verwendet und kann nicht gelöscht werden.`,
        });
      }
      await db.delete(projects).where(eq(projects.id, input.id));
      logAudit(
        db,
        ctx.user.id,
        "project.deleted",
        "project",
        input.id,
        row.name
      );
      return { ok: true };
    }),

  /**
   * Gespeicherte Aufteilungsvorlagen. shares kommt als geparstes JSON-Array
   * [{ userId, weight }] zum Client (in der DB liegt es als Text).
   */
  listSplitTemplates: authedQuery.query(async () => {
    const rows = await getDb()
      .select()
      .from(splitTemplates)
      .orderBy(splitTemplates.name);
    return rows.map(r => ({
      ...r,
      shares: JSON.parse(r.shares) as ShareWeight[],
    }));
  }),

  createSplitTemplate: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        shares: z
          .array(
            z.object({
              userId: z.number().int().positive(),
              weight: z.number().positive(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.select().from(splitTemplates);
      if (
        existing.some(t => t.name.toLowerCase() === input.name.toLowerCase())
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Eine Vorlage mit diesem Namen existiert bereits.",
        });
      }
      const allUsers = await db.select({ id: users.id }).from(users);
      const known = new Set(allUsers.map(u => u.id));
      if (input.shares.some(s => !known.has(s.userId))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Die Vorlage enthält einen unbekannten Benutzer.",
        });
      }
      const rows = await db
        .insert(splitTemplates)
        .values({
          name: input.name,
          shares: JSON.stringify(input.shares),
          createdAt: new Date(),
        })
        .returning();
      logAudit(
        db,
        ctx.user.id,
        "splitTemplate.created",
        "splitTemplate",
        rows[0].id,
        input.name
      );
      return { ...rows[0], shares: input.shares };
    }),

  deleteSplitTemplate: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.splitTemplates.findFirst({
        where: eq(splitTemplates.id, input.id),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Vorlage nicht gefunden.",
        });
      }
      await db.delete(splitTemplates).where(eq(splitTemplates.id, input.id));
      logAudit(
        db,
        ctx.user.id,
        "splitTemplate.deleted",
        "splitTemplate",
        input.id,
        row.name
      );
      return { ok: true };
    }),

  /* ---------------------------------- Tags ---------------------------------- */

  /**
   * Alle Tags des Haushalts, alphabetisch nach Name. Tags sind haushaltsweit
   * (keine Konto-Bindung, keine Sichtbarkeitslogik).
   */
  listTags: authedQuery.query(() =>
    getDb().select().from(tags).orderBy(tags.name)
  ),

  createTag: authedQuery
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.select().from(tags);
      if (
        existing.some(t => t.name.toLowerCase() === input.name.toLowerCase())
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ein Tag mit diesem Namen existiert bereits.",
        });
      }
      // Farbe automatisch: die am seltensten verwendete Palettenfarbe
      const counts = new Map<string, number>(TAG_COLORS.map(c => [c, 0]));
      for (const t of existing) {
        counts.set(t.color, (counts.get(t.color) ?? 0) + 1);
      }
      const color: string = TAG_COLORS.reduce((best, c) =>
        (counts.get(c) ?? 0) < (counts.get(best) ?? 0) ? c : best
      );
      const rows = await db
        .insert(tags)
        .values({ name: input.name, color, createdAt: new Date() })
        .returning();
      logAudit(db, ctx.user.id, "tag.created", "tag", rows[0].id, input.name);
      return rows[0];
    }),

  /**
   * Tag löschen — bewusst OHNE Sperre bei vorhandenen Zuordnungen (anders
   * als bei Kategorien/Projekten): Tags sind leichtgewichtige Labels, ihre
   * Zuordnungen zu Buchungen werden einfach mit entfernt.
   */
  deleteTag: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.tags.findFirst({
        where: eq(tags.id, input.id),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tag nicht gefunden.",
        });
      }
      db.transaction(tx => {
        tx.delete(transactionTags)
          .where(eq(transactionTags.tagId, input.id))
          .run();
        tx.delete(tags).where(eq(tags.id, input.id)).run();
      });
      logAudit(db, ctx.user.id, "tag.deleted", "tag", input.id, row.name);
      return { ok: true };
    }),

  /**
   * Ersetzt die Tags einer Buchung komplett (Ersetzen-Semantik — leere
   * tagIds entfernen alle Tags). Erfordert "edit" auf dem Buchungskonto.
   */
  setTransactionTags: authedQuery
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        tagIds: z.array(z.number().int().positive()).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const txRow = await db.query.transactions.findFirst({
        where: eq(transactions.id, input.transactionId),
      });
      if (!txRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buchung nicht gefunden.",
        });
      }
      await requireAccountAccess(db, ctx.user, txRow.accountId, "edit");
      const wanted = [...new Set(input.tagIds)];
      const allTags = await db.select().from(tags);
      const known = new Map(allTags.map(t => [t.id, t]));
      if (wanted.some(id => !known.has(id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Mindestens ein Tag existiert nicht.",
        });
      }
      db.transaction(tx => {
        tx.delete(transactionTags)
          .where(eq(transactionTags.transactionId, input.transactionId))
          .run();
        for (const tagId of wanted) {
          tx.insert(transactionTags)
            .values({ transactionId: input.transactionId, tagId })
            .run();
        }
      });
      logAudit(
        db,
        ctx.user.id,
        "transaction.tags",
        "transaction",
        input.transactionId,
        wanted.length > 0
          ? wanted.map(id => known.get(id)?.name ?? "").join(", ")
          : "Alle Tags entfernt"
      );
      return { ok: true };
    }),

  /* ------------------------------- Transaktionen ------------------------------ */

  listTransactions: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const visible = await visibleAccountIds(db, ctx.user);
    const [allTxs, splits, attachments, tagRows, allTags] = await Promise.all([
      db
        .select()
        .from(transactions)
        .orderBy(desc(transactions.date), desc(transactions.id)),
      db.select().from(transactionSplits),
      db
        .select({
          id: transactionAttachments.id,
          transactionId: transactionAttachments.transactionId,
          originalName: transactionAttachments.originalName,
          mimeType: transactionAttachments.mimeType,
          sizeBytes: transactionAttachments.sizeBytes,
        })
        .from(transactionAttachments),
      db.select().from(transactionTags),
      db.select().from(tags),
    ]);
    // Sichtbar, wenn Quell- ODER Zielkonto sichtbar ist
    const txs = allTxs.filter(t => touchesVisibleAccount(visible, t));
    const byTx = new Map<number, { userId: number; amount: number }[]>();
    for (const s of splits) {
      const list = byTx.get(s.transactionId) ?? [];
      list.push({ userId: s.userId, amount: s.amount });
      byTx.set(s.transactionId, list);
    }
    const attsByTx = new Map<
      number,
      {
        id: number;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
      }[]
    >();
    for (const a of attachments) {
      const list = attsByTx.get(a.transactionId) ?? [];
      list.push({
        id: a.id,
        originalName: a.originalName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      });
      attsByTx.set(a.transactionId, list);
    }
    const tagById = new Map(allTags.map(t => [t.id, t]));
    const tagsByTx = new Map<
      number,
      { id: number; name: string; color: string }[]
    >();
    for (const r of tagRows) {
      const tag = tagById.get(r.tagId);
      if (!tag) continue;
      const list = tagsByTx.get(r.transactionId) ?? [];
      list.push({ id: tag.id, name: tag.name, color: tag.color });
      tagsByTx.set(r.transactionId, list);
    }
    return txs.map(t => ({
      ...t,
      splits: byTx.get(t.id) ?? [],
      attachments: attsByTx.get(t.id) ?? [],
      tags: tagsByTx.get(t.id) ?? [],
    }));
  }),

  createTransaction: authedQuery
    .input(
      z.object({
        type: z.enum(["income", "expense", "transfer"]),
        accountId: z.number().int().positive(),
        toAccountId: z.number().int().positive().optional(),
        amount: z.number().int().positive(),
        categoryId: z.number().int().positive().optional(),
        userId: z.number().int().positive(),
        // Optional: Zuordnung zu einem Projekt (NULL = laufender Haushalt)
        projectId: z.number().int().positive().optional(),
        date: isoDate,
        note: z.string().default(""),
        splits: z
          .array(
            z.object({
              userId: z.number().int().positive(),
              amount: z.number().int().positive(),
            })
          )
          .optional(),
        // Optional: Tags der Buchung (mehrere, haushaltsweit)
        tagIds: z.array(z.number().int().positive()).max(50).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { splits, tagIds, ...txData } = input;
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");
      // Bei Umbuchungen muss zumindest das Zielkonto sichtbar sein
      if (input.type === "transfer" && input.toAccountId) {
        await requireAccountAccess(db, ctx.user, input.toAccountId, "view");
      }
      if (input.projectId) {
        const project = await db.query.projects.findFirst({
          where: eq(projects.id, input.projectId),
        });
        if (!project) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Das angegebene Projekt existiert nicht.",
          });
        }
      }
      if (splits && splits.length > 0) {
        const sum = splits.reduce((s, x) => s + x.amount, 0);
        if (sum !== input.amount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Anteile müssen in Summe dem Betrag entsprechen.",
          });
        }
      }
      if (tagIds && tagIds.length > 0) {
        const allTags = await db.select({ id: tags.id }).from(tags);
        const known = new Set(allTags.map(t => t.id));
        if (tagIds.some(id => !known.has(id))) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Mindestens ein Tag existiert nicht.",
          });
        }
      }
      // Budget-Wächter: bei Ausgaben mit Kategorie den Zustand vor dem
      // Insert festhalten, um einen Kipppunkt über 100 % zu erkennen
      const budgetsBefore =
        input.type === "expense" && input.categoryId
          ? await computeBudgetStatuses(db, ctx.user)
          : null;
      const txId = db.transaction(tx => {
        const inserted = tx
          .insert(transactions)
          .values({ ...txData, createdAt: new Date() })
          .returning({ id: transactions.id })
          .all();
        const id = inserted[0]?.id;
        if (id && splits && splits.length > 0) {
          for (const s of splits) {
            tx.insert(transactionSplits)
              .values({ transactionId: id, ...s })
              .run();
          }
        }
        if (id && tagIds && tagIds.length > 0) {
          for (const tagId of new Set(tagIds)) {
            tx.insert(transactionTags)
              .values({ transactionId: id, tagId })
              .run();
          }
        }
        return id;
      });
      logAudit(
        db,
        ctx.user.id,
        "transaction.created",
        "transaction",
        txId ?? null,
        txDetail(input)
      );
      if (budgetsBefore && input.categoryId) {
        // Nur Budgets prüfen, die die gebuchte Kategorie (oder deren
        // Oberkategorie) betreffen — Benachrichtigung beim Kippen von
        // ≤100 % auf >100 %, danach nicht erneut.
        const cat = await db.query.categories.findFirst({
          where: eq(categories.id, input.categoryId),
        });
        const budgetsAfter = await computeBudgetStatuses(db, ctx.user);
        for (const status of budgetsAfter) {
          const relevant =
            status.budget.categoryId === input.categoryId ||
            status.budget.categoryId === cat?.parentId;
          if (!relevant) continue;
          const before = budgetsBefore.find(
            b => b.budget.id === status.budget.id
          );
          if (before && before.percent <= 100 && status.percent > 100) {
            const budgetCat = await db.query.categories.findFirst({
              where: eq(categories.id, status.budget.categoryId),
            });
            await sendNotification(
              db,
              "budget",
              `Budget überschritten: ${budgetCat?.name ?? "Unbekannt"}`,
              `Das Budget „${budgetCat?.name ?? "Unbekannt"}“ liegt jetzt bei ${status.percent} %.`
            );
          }
        }
      }
      return { id: txId };
    }),

  deleteTransaction: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const txRow = await db.query.transactions.findFirst({
        where: eq(transactions.id, input.id),
      });
      if (!txRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buchung nicht gefunden.",
        });
      }
      await requireAccountAccess(db, ctx.user, txRow.accountId, "edit");
      // Beleg-Zeilen + Dateien entfernen, bevor die Buchung gelöscht wird
      await deleteAttachmentsForTransactions(db, [input.id]);
      db.transaction(tx => {
        tx.delete(transactionSplits)
          .where(eq(transactionSplits.transactionId, input.id))
          .run();
        tx.delete(transactionTags)
          .where(eq(transactionTags.transactionId, input.id))
          .run();
        tx.delete(transactions).where(eq(transactions.id, input.id)).run();
      });
      logAudit(
        db,
        ctx.user.id,
        "transaction.deleted",
        "transaction",
        input.id,
        txDetail(txRow)
      );
      return { ok: true };
    }),

  /* --------------------------------- Budgets --------------------------------- */

  listBudgets: authedQuery.query(() => getDb().select().from(budgets)),

  /**
   * Aktuelle Auswertung aller Budgets (Zeitraum-Ausgaben inkl. Unter-
   * kategorien, effektives Limit inkl. Rollover-Übertrag, verbleibend,
   * Prozent) — gemeinsame Logik aus api/lib/budgets.ts, die auch die
   * Budget-Prognose nutzt.
   */
  listBudgetStatus: authedQuery.query(async ({ ctx }) =>
    computeBudgetStatuses(getDb(), ctx.user)
  ),

  setBudget: authedQuery
    .input(
      z.object({
        categoryId: z.number().int().positive(),
        amount: z.number().int().positive(),
        period: z.enum(["monthly", "yearly"]).default("monthly"),
        // Rollover nur bei period "monthly" relevant (Übertrag in Folgemonate)
        rollover: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.budgets.findFirst({
        where: eq(budgets.categoryId, input.categoryId),
      });
      if (existing) {
        // createdAt (Rollover-Anker) bleibt beim Anpassen erhalten
        await db
          .update(budgets)
          .set({
            amount: input.amount,
            period: input.period,
            rollover: input.rollover,
          })
          .where(eq(budgets.id, existing.id));
      } else {
        await db.insert(budgets).values({
          categoryId: input.categoryId,
          amount: input.amount,
          period: input.period,
          rollover: input.rollover,
          createdAt: new Date(),
        });
      }
      const budgetCat = await db.query.categories.findFirst({
        where: eq(categories.id, input.categoryId),
      });
      logAudit(
        db,
        ctx.user.id,
        "budget.saved",
        "budget",
        input.categoryId,
        `${budgetCat?.name ?? "Unbekannt"}: ${auditAmount(input.amount)} ${input.period === "monthly" ? "monatlich" : "jährlich"}${input.rollover ? ", Rollover" : ""}`
      );
      return { ok: true };
    }),

  deleteBudget: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db.delete(budgets).where(eq(budgets.id, input.id));
      logAudit(db, ctx.user.id, "budget.deleted", "budget", input.id);
      return { ok: true };
    }),

  /* ------------------------------- Wiederkehrend ------------------------------ */

  listRecurring: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const visible = await visibleAccountIds(db, ctx.user);
    const rows = await db.select().from(recurring);
    // Dauer-Umbuchungen bleiben sichtbar, wenn Quell- ODER Zielkonto sichtbar
    // ist (analog zu listTransactions).
    return rows.filter(
      r =>
        visible.has(r.accountId) ||
        (r.toAccountId !== null && visible.has(r.toAccountId))
    );
  }),

  createRecurring: authedQuery
    .input(
      z.object({
        type: z.enum(["income", "expense", "transfer"]),
        accountId: z.number().int().positive(),
        toAccountId: z.number().int().positive().optional(),
        amount: z.number().int().positive(),
        categoryId: z.number().int().positive().optional(),
        userId: z.number().int().positive(),
        note: z.string().default(""),
        interval: z.enum(["weekly", "monthly", "yearly"]),
        nextDate: isoDate,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");
      if (input.type === "transfer") {
        if (!input.toAccountId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Bei Umbuchungen muss ein Zielkonto angegeben werden.",
          });
        }
        if (input.toAccountId === input.accountId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Zielkonto muss ein anderes Konto sein.",
          });
        }
        // Zielkonto muss zumindest sichtbar sein (wie bei createTransaction)
        await requireAccountAccess(db, ctx.user, input.toAccountId, "view");
      }
      await db.insert(recurring).values({
        ...input,
        // Kategorie ist bei Umbuchungen irrelevant
        categoryId: input.type === "transfer" ? undefined : input.categoryId,
        toAccountId: input.type === "transfer" ? input.toAccountId : undefined,
        active: true,
        createdAt: new Date(),
      });
      logAudit(
        db,
        ctx.user.id,
        "recurring.created",
        "recurring",
        null,
        `${TYPE_LABELS[input.type]} ${auditAmount(input.amount)}, ${input.interval === "weekly" ? "wöchentlich" : input.interval === "monthly" ? "monatlich" : "jährlich"} ab ${input.nextDate}${input.note ? ` — ${input.note}` : ""}`
      );
      return { ok: true };
    }),

  toggleRecurring: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.recurring.findFirst({
        where: eq(recurring.id, input.id),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await requireAccountAccess(db, ctx.user, row.accountId, "edit");
      await db
        .update(recurring)
        .set({ active: !row.active })
        .where(eq(recurring.id, input.id));
      logAudit(
        db,
        ctx.user.id,
        "recurring.toggled",
        "recurring",
        input.id,
        `${row.note || TYPE_LABELS[row.type]}: ${row.active ? "pausiert" : "aktiviert"}`
      );
      return { ok: true };
    }),

  deleteRecurring: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.recurring.findFirst({
        where: eq(recurring.id, input.id),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await requireAccountAccess(db, ctx.user, row.accountId, "edit");
      await db.delete(recurring).where(eq(recurring.id, input.id));
      logAudit(
        db,
        ctx.user.id,
        "recurring.deleted",
        "recurring",
        input.id,
        `${TYPE_LABELS[row.type]} ${auditAmount(row.amount)}${row.note ? ` — ${row.note}` : ""}`
      );
      return { ok: true };
    }),

  /** Manueller Trigger des Cron-Jobs (z. B. direkt nach dem Anlegen) */
  runRecurringNow: authedQuery.mutation(async () => ({
    created: await runRecurringJob(),
  })),

  /* --------------------------------- Sparziele -------------------------------- */

  listGoals: authedQuery.query(() => getDb().select().from(savingsGoals)),

  createGoal: authedQuery
    .input(
      z.object({
        name: z.string().min(1),
        targetAmount: z.number().int().positive(),
        savedAmount: z.number().int().min(0).default(0),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        deadline: isoDate.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const inserted = await db
        .insert(savingsGoals)
        .values(input)
        .returning({ id: savingsGoals.id });
      logAudit(
        db,
        ctx.user.id,
        "goal.created",
        "goal",
        inserted[0]?.id ?? null,
        `${input.name} (Ziel ${auditAmount(input.targetAmount)})`
      );
      return { ok: true };
    }),

  updateGoalSaved: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        savedAmount: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      // Zustand vorher laden, um überschrittene Meilensteine zu erkennen
      const goal = await db.query.savingsGoals.findFirst({
        where: eq(savingsGoals.id, input.id),
      });
      await db
        .update(savingsGoals)
        .set({ savedAmount: input.savedAmount })
        .where(eq(savingsGoals.id, input.id));
      logAudit(
        db,
        ctx.user.id,
        "goal.updated",
        "goal",
        input.id,
        `${goal?.name ?? "Sparziel"}: ${auditAmount(input.savedAmount)} angespart`
      );
      // Meilenstein-Benachrichtigung (25/50/75/100 %), nur beim Ansteigen
      if (goal && goal.targetAmount > 0) {
        const beforePct = (goal.savedAmount / goal.targetAmount) * 100;
        const afterPct = (input.savedAmount / goal.targetAmount) * 100;
        for (const milestone of [25, 50, 75, 100]) {
          if (beforePct < milestone && afterPct >= milestone) {
            await sendNotification(
              db,
              "goal",
              `Sparziel ${goal.name}: ${milestone} % erreicht`,
              `Beim Sparziel „${goal.name}“ sind ${milestone} % angespart.`
            );
          }
        }
      }
      return { ok: true };
    }),

  deleteGoal: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const goal = await db.query.savingsGoals.findFirst({
        where: eq(savingsGoals.id, input.id),
      });
      // Beiträge des Ziels mitlöschen (Kaskade)
      await db
        .delete(goalContributions)
        .where(eq(goalContributions.goalId, input.id));
      await db.delete(savingsGoals).where(eq(savingsGoals.id, input.id));
      logAudit(
        db,
        ctx.user.id,
        "goal.deleted",
        "goal",
        input.id,
        goal?.name ?? ""
      );
      return { ok: true };
    }),

  /**
   * Beitrag eines Mitglieds zu einem Sparziel. Der Gesamtfortschritt eines
   * Ziels ist savedAmount (Basis, manuell via updateGoalSaved) plus Summe
   * aller Beiträge — Beiträge lösen wie updateGoalSaved Meilensteine aus.
   */
  addGoalContribution: authedQuery
    .input(
      z.object({
        goalId: z.number().int().positive(),
        amount: z.number().int().positive(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const goal = await db.query.savingsGoals.findFirst({
        where: eq(savingsGoals.id, input.goalId),
      });
      if (!goal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sparziel nicht gefunden.",
        });
      }
      // Fortschritt vor dem Beitrag (Basis + bisherige Beiträge)
      const existing = await db
        .select({ amount: goalContributions.amount })
        .from(goalContributions)
        .where(eq(goalContributions.goalId, input.goalId));
      const beforeTotal =
        goal.savedAmount + existing.reduce((s, c) => s + c.amount, 0);
      const inserted = await db
        .insert(goalContributions)
        .values({
          goalId: input.goalId,
          userId: ctx.user.id,
          amount: input.amount,
          note: input.note ?? "",
          createdAt: new Date(),
        })
        .returning({ id: goalContributions.id });
      await notifyGoalMilestones(
        db,
        goal,
        beforeTotal,
        beforeTotal + input.amount
      );
      logAudit(
        db,
        ctx.user.id,
        "goal.contribution.added",
        "goal",
        input.goalId,
        `${auditAmount(input.amount)} für „${goal.name}“`
      );
      return { id: inserted[0].id };
    }),

  /** Beiträge eines Sparziels inkl. Name/Farbe des Beitragszahlers */
  listGoalContributions: authedQuery
    .input(z.object({ goalId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: goalContributions.id,
          goalId: goalContributions.goalId,
          userId: goalContributions.userId,
          amount: goalContributions.amount,
          note: goalContributions.note,
          createdAt: goalContributions.createdAt,
          userName: users.name,
          userColor: users.color,
        })
        .from(goalContributions)
        .innerJoin(users, eq(goalContributions.userId, users.id))
        .where(eq(goalContributions.goalId, input.goalId))
        .orderBy(desc(goalContributions.createdAt));
      return rows;
    }),

  /** Eigenen Beitrag löschen; Admins dürfen alle Beiträge löschen */
  deleteGoalContribution: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.goalContributions.findFirst({
        where: eq(goalContributions.id, input.id),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Beitrag nicht gefunden.",
        });
      }
      if (row.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Nur eigene Beiträge dürfen gelöscht werden.",
        });
      }
      await db
        .delete(goalContributions)
        .where(eq(goalContributions.id, input.id));
      logAudit(
        db,
        ctx.user.id,
        "goal.contribution.deleted",
        "goal",
        row.goalId,
        `Beitrag ${auditAmount(row.amount)}`
      );
      return { ok: true };
    }),

  /** Vollständiger Import in einem Schritt (serverseitiges Mapping) */
  importLocalFull: authedQuery
    .input(
      z.object({
        accounts: z
          .array(
            z.object({
              oldId: z.string(),
              name: z.string().min(1),
              type: z.enum(["checking", "cash", "savings"]),
              initialBalance: z.number().int(),
            })
          )
          .max(50),
        categories: z
          .array(
            z.object({
              oldId: z.string(),
              name: z.string().min(1),
              type: z.enum(["income", "expense"]),
              color: z.string(),
            })
          )
          .max(200),
        transactions: z
          .array(
            z.object({
              type: z.enum(["income", "expense", "transfer"]),
              accountId: z.string(),
              toAccountId: z.string().optional(),
              amount: z.number().int().positive(),
              categoryId: z.string().optional(),
              memberId: z.string(),
              date: isoDate,
              note: z.string(),
              splits: z
                .array(
                  z.object({ memberId: z.string(), amount: z.number().int() })
                )
                .optional(),
            })
          )
          .max(20000),
        budgets: z
          .array(
            z.object({
              categoryId: z.string(),
              amount: z.number().int().positive(),
            })
          )
          .max(200),
        recurring: z
          .array(
            z.object({
              type: z.enum(["income", "expense"]),
              accountId: z.string(),
              amount: z.number().int().positive(),
              categoryId: z.string().optional(),
              memberId: z.string(),
              note: z.string(),
              interval: z.enum(["weekly", "monthly", "yearly"]),
              nextDate: isoDate,
              active: z.boolean(),
            })
          )
          .max(200),
        goals: z
          .array(
            z.object({
              name: z.string().min(1),
              targetAmount: z.number().int().positive(),
              savedAmount: z.number().int().min(0),
              color: z.string(),
              deadline: isoDate.optional(),
            })
          )
          .max(100),
        memberMap: z.record(z.string(), z.number().int().positive()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existingTx = await db
        .select({ id: transactions.id })
        .from(transactions)
        .limit(1);
      if (existingTx.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Import nur möglich, solange noch keine Buchungen existieren.",
        });
      }
      const accountMap = new Map<string, number>();
      const categoryMap = new Map<string, number>();
      const now = new Date();
      const fallbackUser = ctx.user.id;

      db.transaction(tx => {
        for (const a of input.accounts) {
          const rows = tx
            .insert(accounts)
            .values({
              name: a.name,
              type: a.type,
              initialBalance: a.initialBalance,
              createdAt: now,
            })
            .returning({ id: accounts.id })
            .all();
          if (rows[0]) accountMap.set(a.oldId, rows[0].id);
        }
        for (const c of input.categories) {
          const rows = tx
            .insert(categories)
            .values({ name: c.name, type: c.type, color: c.color })
            .returning({ id: categories.id })
            .all();
          if (rows[0]) categoryMap.set(c.oldId, rows[0].id);
        }
        for (const t of input.transactions) {
          const accountId = accountMap.get(t.accountId);
          if (!accountId) continue;
          const rows = tx
            .insert(transactions)
            .values({
              type: t.type,
              accountId,
              toAccountId: t.toAccountId
                ? accountMap.get(t.toAccountId)
                : undefined,
              amount: t.amount,
              categoryId: t.categoryId
                ? categoryMap.get(t.categoryId)
                : undefined,
              userId: input.memberMap[t.memberId] ?? fallbackUser,
              date: t.date,
              note: t.note,
              createdAt: now,
            })
            .returning({ id: transactions.id })
            .all();
          if (rows[0] && t.splits && t.splits.length > 0) {
            for (const sp of t.splits) {
              const uid = input.memberMap[sp.memberId];
              if (uid) {
                tx.insert(transactionSplits)
                  .values({
                    transactionId: rows[0].id,
                    userId: uid,
                    amount: sp.amount,
                  })
                  .run();
              }
            }
          }
        }
        for (const b of input.budgets) {
          const categoryId = categoryMap.get(b.categoryId);
          if (categoryId)
            tx.insert(budgets).values({ categoryId, amount: b.amount }).run();
        }
        for (const r of input.recurring) {
          const accountId = accountMap.get(r.accountId);
          if (!accountId) continue;
          tx.insert(recurring)
            .values({
              type: r.type,
              accountId,
              amount: r.amount,
              categoryId: r.categoryId
                ? categoryMap.get(r.categoryId)
                : undefined,
              userId: input.memberMap[r.memberId] ?? fallbackUser,
              note: r.note,
              interval: r.interval,
              nextDate: r.nextDate,
              active: r.active,
              createdAt: now,
            })
            .run();
        }
        for (const g of input.goals) {
          tx.insert(savingsGoals).values(g).run();
        }
      });
      logAudit(
        db,
        ctx.user.id,
        "data.imported",
        "data",
        null,
        `${input.accounts.length} Konten, ${input.categories.length} Kategorien, ${input.transactions.length} Buchungen, ${input.recurring.length} Dauerbuchungen, ${input.goals.length} Sparziele`
      );
      return { ok: true };
    }),

  /** Sind bereits Finanzdaten vorhanden? (für Wizard-Import-Angebot) */
  hasData: authedQuery.query(async () => {
    const db = getDb();
    const tx = await db
      .select({ id: transactions.id })
      .from(transactions)
      .limit(1);
    const acc = await db.select({ id: accounts.id }).from(accounts).limit(1);
    return { hasTransactions: tx.length > 0, hasAccounts: acc.length > 0 };
  }),

  /** Admin: alle Finanzdaten löschen (Neustart) */
  resetFinanceData: authedQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    const txIds = (
      await db.select({ id: transactions.id }).from(transactions)
    ).map(t => t.id);
    // Beleg-Zeilen + Dateien aller Buchungen entfernen
    await deleteAttachmentsForTransactions(db, txIds);
    db.transaction(tx => {
      tx.delete(transactionSplits).where(ne(transactionSplits.id, -1)).run();
      tx.delete(transactionTags).where(ne(transactionTags.id, -1)).run();
      tx.delete(tags).where(ne(tags.id, -1)).run();
      tx.delete(transactions).where(ne(transactions.id, -1)).run();
      tx.delete(recurring).where(ne(recurring.id, -1)).run();
      tx.delete(budgets).where(ne(budgets.id, -1)).run();
      tx.delete(goalContributions).where(ne(goalContributions.id, -1)).run();
      tx.delete(savingsGoals).where(ne(savingsGoals.id, -1)).run();
      tx.delete(categories).where(ne(categories.id, -1)).run();
      tx.delete(accountPermissions).where(ne(accountPermissions.id, -1)).run();
      tx.delete(accounts).where(ne(accounts.id, -1)).run();
    });
    logAudit(
      db,
      ctx.user.id,
      "data.reset",
      "data",
      null,
      "Alle Finanzdaten gelöscht"
    );
    return { ok: true };
  }),

  /* ---------------------------- CSV-Export/-Import --------------------------- */

  /**
   * Alle für den Nutzer sichtbaren Transaktionen als CSV. Trenn- und
   * Dezimalzeichen richten sich nach der optionalen Locale des Clients
   * (de-* → Semikolon/Dezimalkomma, sonst Komma/Dezimalpunkt — Format
   * siehe api/lib/csv.ts). Default ohne Locale: deutsches Format.
   */
  exportTransactionsCsv: authedQuery
    .input(z.object({ locale: z.string().max(35).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const visible = await visibleAccountIds(db, ctx.user);
      const [allTxs, accs, cats] = await Promise.all([
        db.select().from(transactions),
        db.select().from(accounts),
        db.select().from(categories),
      ]);
      const accountName = new Map(accs.map(a => [a.id, a.name]));
      const categoryName = new Map(cats.map(c => [c.id, c.name]));
      const txs = allTxs
        .filter(t => touchesVisibleAccount(visible, t))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      const separator = csvFieldSeparator(input?.locale);
      const lines = [
        CSV_HEADER.map(h => csvEscape(h, separator)).join(separator),
      ];
      for (const t of txs) {
        lines.push(
          [
            t.date,
            TYPE_LABELS[t.type],
            formatEuroCsv(t.amount, input?.locale),
            t.categoryId ? (categoryName.get(t.categoryId) ?? "") : "",
            accountName.get(t.accountId) ?? "",
            t.toAccountId ? (accountName.get(t.toAccountId) ?? "") : "",
            t.note,
          ]
            .map(v => csvEscape(v, separator))
            .join(separator)
        );
      }
      return lines.join("\r\n");
    }),

  /**
   * Einfacher CSV-Import auf EIN Konto: nur Einnahmen/Ausgaben werden
   * importiert, Umbuchungs-Zeilen werden übersprungen (und gezählt).
   * Kategorien per exaktem Namens-Match (case-insensitiv, passend zum Typ),
   * ohne Match categoryId = null. Fehlerhafte Zeilen werden übersprungen.
   */
  importTransactionsCsv: authedQuery
    .input(
      z.object({
        csv: z.string().max(5 * 1024 * 1024),
        accountId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");
      const cats = await db.select().from(categories);
      const catByName = new Map<string, number>();
      for (const c of cats) {
        // Kategorien werden rein per Name gematcht (keine Ober-/Unter-
        // unterscheidung im CSV) — bei Namensgleichheit gewinnt die erste
        // passende Kategorie (kleinste ID).
        const key = `${c.type}:${c.name.toLowerCase()}`;
        if (!catByName.has(key)) catByName.set(key, c.id);
      }

      const errors: string[] = [];
      let imported = 0;
      let skipped = 0;
      const rows: (typeof transactions.$inferInsert)[] = [];
      const now = new Date();

      parseCsv(input.csv).forEach((rec, idx) => {
        const [dateRaw, typeRaw, amountRaw, catRaw, , , noteRaw] = rec.fields;
        // Kopfzeile und komplett leere Zeilen ignorieren
        if (idx === 0 && (dateRaw ?? "").trim().toLowerCase() === "datum") {
          return;
        }
        if (rec.fields.every(f => f.trim() === "")) return;
        const fail = (msg: string) => {
          skipped++;
          if (errors.length < 20) errors.push(`Zeile ${rec.line}: ${msg}`);
        };

        const type = typeFromLabel(typeRaw ?? "");
        if (type === "transfer") {
          skipped++;
          return;
        }
        if (!type) {
          return fail(`unbekannter Typ "${(typeRaw ?? "").trim()}"`);
        }
        const date = (dateRaw ?? "").trim();
        if (!isValidIsoDate(date)) {
          return fail(`ungültiges Datum "${date}"`);
        }
        const amount = parseEuroCsv(amountRaw ?? "");
        if (amount === null) {
          return fail(`ungültiger Betrag "${(amountRaw ?? "").trim()}"`);
        }
        const catName = (catRaw ?? "").trim();
        const categoryId = catName
          ? (catByName.get(`${type}:${catName.toLowerCase()}`) ?? null)
          : null;
        rows.push({
          type,
          accountId: input.accountId,
          amount,
          categoryId,
          userId: ctx.user.id,
          date,
          note: noteRaw ?? "",
          createdAt: now,
        });
        imported++;
      });

      if (rows.length > 0) {
        db.transaction(tx => {
          for (const r of rows) tx.insert(transactions).values(r).run();
        });
      }
      logAudit(
        db,
        ctx.user.id,
        "transaction.imported",
        "transaction",
        input.accountId,
        `CSV: ${imported} importiert, ${skipped} übersprungen`
      );
      return { imported, skipped, errors };
    }),

  /**
   * CAMT.053-Import (ISO-20022-XML-Kontoauszug) auf EIN Konto: Gutschriften
   * werden Einnahmen, Belastungen Ausgaben (jeweils ohne Kategorie), die
   * Notiz setzt sich aus Gegenpartei und Verwendungszweck zusammen.
   * Dubletten-Schutz: identische Kombination aus Konto, Datum, Betrag und
   * Notiz (in der DB oder doppelt in der Datei) wird übersprungen.
   */
  importCamt: authedQuery
    .input(
      z.object({
        xml: z.string().max(10 * 1024 * 1024),
        accountId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");

      const parsed = parseCamt053(input.xml);

      // Vorhandene Buchungen des Kontos für den Dubletten-Abgleich
      const existing = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId));
      const seen = new Set(
        existing
          .filter(t => t.type !== "transfer")
          .map(t => `${t.date}|${t.amount}|${t.note}`)
      );

      let imported = 0;
      let duplicates = 0;
      const rows: (typeof transactions.$inferInsert)[] = [];
      const now = new Date();

      for (const e of parsed.entries) {
        const type = e.amountCents > 0 ? "income" : "expense";
        const amount = Math.abs(e.amountCents);
        const note = [e.party, e.note].filter(Boolean).join(" — ");
        const key = `${e.date}|${amount}|${note}`;
        if (seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);
        rows.push({
          type,
          accountId: input.accountId,
          amount,
          categoryId: null,
          userId: ctx.user.id,
          date: e.date,
          note,
          createdAt: now,
        });
        imported++;
      }

      if (rows.length > 0) {
        db.transaction(tx => {
          for (const r of rows) tx.insert(transactions).values(r).run();
        });
      }
      logAudit(
        db,
        ctx.user.id,
        "transaction.imported",
        "transaction",
        input.accountId,
        `CAMT: ${imported} importiert, ${duplicates} Dubletten, ${parsed.errors.length} Fehler`
      );
      return { imported, duplicates, errors: parsed.errors };
    }),

  /* ---------------------------- App-Einstellungen --------------------------- */

  /** Haushaltsweite Einstellungen lesen (aktuell: Währung) */
  getAppSettings: authedQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(appSettings);
    const map = new Map(rows.map(r => [r.key, r.value]));
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
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .insert(appSettings)
        .values({ key: "currency", value: input.currency })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: input.currency },
        });
      logAudit(
        db,
        ctx.user.id,
        "settings.currency",
        "settings",
        null,
        `Währung: ${input.currency}`
      );
      return { ok: true };
    }),

  /** Admin: Benachrichtigungs-Einstellungen (ntfy/Webhook) lesen */
  getNotifySettings: adminQuery.query(() => getNotifyConfig(getDb())),

  /** Admin: Benachrichtigungs-Einstellungen speichern (leer = deaktiviert) */
  setNotifySettings: adminQuery
    .input(
      z.object({
        ntfyUrl: z.string().nullable(),
        webhookUrl: z.string().nullable(),
        events: z.object({
          budget: z.boolean(),
          recurring: z.boolean(),
          goal: z.boolean(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const clean = (raw: string | null, label: string): string | null => {
        const v = (raw ?? "").trim();
        if (v === "") return null;
        if (!isHttpUrl(v)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${label} muss mit http:// oder https:// beginnen.`,
          });
        }
        return v;
      };
      const entries: [string, string][] = [
        ["notify_ntfy_url", clean(input.ntfyUrl, "Die ntfy-URL") ?? ""],
        [
          "notify_webhook_url",
          clean(input.webhookUrl, "Die Webhook-URL") ?? "",
        ],
        ["notify_events", JSON.stringify(input.events)],
      ];
      for (const [key, value] of entries) {
        await db
          .insert(appSettings)
          .values({ key, value })
          .onConflictDoUpdate({ target: appSettings.key, set: { value } });
      }
      const activeEvents = (Object.entries(input.events) as [string, boolean][])
        .filter(([, on]) => on)
        .map(([k]) => k)
        .join(", ");
      logAudit(
        db,
        ctx.user.id,
        "settings.notify",
        "settings",
        null,
        `Benachrichtigungen: ${activeEvents || "keine Ereignisse"}`
      );
      return { ok: true };
    }),

  /** Admin: Testbenachrichtigung über die konfigurierten Kanäle senden */
  sendTestNotification: adminQuery.mutation(async () => {
    const db = getDb();
    const cfg = await getNotifyConfig(db);
    if (!cfg.ntfyUrl && !cfg.webhookUrl) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Keine Benachrichtigungs-URL konfiguriert.",
      });
    }
    const sent = await sendNotification(
      db,
      "test",
      "Finance Fox: Testbenachrichtigung",
      "Die Benachrichtigungen sind eingerichtet."
    );
    if (sent.length === 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Testbenachrichtigung konnte nicht gesendet werden.",
      });
    }
    return { sent };
  }),

  /* -------------------------------- Audit-Log ------------------------------- */

  /**
   * Aktivitäts-Chronik des Haushalts (neueste zuerst), lesbar für alle
   * Mitglieder. userId null → Akteur „System“ (z. B. fehlgeschlagener Login).
   */
  listAuditLog: authedQuery
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(500).default(100),
          entity: z.string().max(50).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: auditLog.id,
          userId: auditLog.userId,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          detail: auditLog.detail,
          createdAt: auditLog.createdAt,
          userName: users.name,
          userColor: users.color,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .where(input?.entity ? eq(auditLog.entity, input.entity) : undefined)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(input?.limit ?? 100);
    }),

  /* ------------------------------- Auswertung ------------------------------- */

  /**
   * Jahresvergleich der Ausgaben: pro Ausgaben-Oberkategorie (Unterkategorien
   * aufgerollt, nur sichtbare Konten) die Summen des Jahres und des Vorjahres
   * in Cent, absteigend nach der Jahressumme sortiert. Ausgaben ohne
   * Kategorie erscheinen als eigene Zeile (categoryId null).
   */
  yearComparison: authedQuery
    .input(z.object({ year: z.number().int().min(2000).max(2100) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const visible = await visibleAccountIds(db, ctx.user);
      const [allTxs, cats] = await Promise.all([
        db
          .select({
            type: transactions.type,
            accountId: transactions.accountId,
            toAccountId: transactions.toAccountId,
            amount: transactions.amount,
            categoryId: transactions.categoryId,
            date: transactions.date,
          })
          .from(transactions),
        db.select().from(categories),
      ]);
      const rootOf = new Map(cats.map(c => [c.id, c.parentId ?? c.id]));
      const yearPrefix = `${input.year}-`;
      const prevPrefix = `${input.year - 1}-`;
      // Schlüssel -1 = Ausgaben ohne Kategorie
      const sums = new Map<number, { current: number; previous: number }>();
      for (const t of allTxs) {
        if (t.type !== "expense" || !touchesVisibleAccount(visible, t)) {
          continue;
        }
        const isCurrent = t.date.startsWith(yearPrefix);
        if (!isCurrent && !t.date.startsWith(prevPrefix)) continue;
        const rootId =
          t.categoryId === null
            ? -1
            : (rootOf.get(t.categoryId) ?? t.categoryId);
        const entry = sums.get(rootId) ?? { current: 0, previous: 0 };
        if (isCurrent) entry.current += t.amount;
        else entry.previous += t.amount;
        sums.set(rootId, entry);
      }
      const rows: {
        categoryId: number | null;
        name: string;
        color: string;
        current: number;
        previous: number;
      }[] = cats
        .filter(c => c.type === "expense" && c.parentId === null)
        .map(c => ({
          categoryId: c.id,
          name: c.name,
          color: c.color,
          ...(sums.get(c.id) ?? { current: 0, previous: 0 }),
        }));
      const uncategorized = sums.get(-1);
      if (
        uncategorized &&
        (uncategorized.current > 0 || uncategorized.previous > 0)
      ) {
        rows.push({
          categoryId: null,
          name: "Ohne Kategorie",
          color: "#94a3b8",
          ...uncategorized,
        });
      }
      rows.sort((a, b) => b.current - a.current);
      return { year: input.year, prevYear: input.year - 1, rows };
    }),
});
