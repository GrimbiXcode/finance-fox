import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  banks,
  mortgageAmortizations,
  mortgageChanges,
  mortgageTranches,
  properties,
  recurring,
  users,
} from "@db/schema";
import { MONTHS_PER_INTERVAL, RECURRING_INTERVALS } from "@contracts/types";
import { requireAccountAccess } from "./lib/accountAccess";
import { auditAmount, logAudit } from "./lib/audit";
import { recordMortgageChange } from "./lib/mortgage/history";
import { getMortgageCalculator } from "./lib/mortgage";
import type { FieldValue } from "./lib/changeHistory";
import type { PaymentInterval } from "./lib/mortgage/scheduleCh";

/**
 * Hypotheken-Modul (Schweizer Modell) — anders als die Vorsorge
 * **haushaltsweit**: kein user_id-Scoping, jedes Mitglied sieht und
 * bearbeitet die Liegenschaften des Haushalts. Verknüpfte Finanz-Konten
 * werden weiterhin über die Konto-Rechte geprüft (requireAccountAccess).
 *
 * Jede Mutation schreibt bei echter Änderung einen Eintrag in
 * mortgage_changes und best effort ins Audit-Log.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");
const commentInput = z.string().max(500).optional();
/** Wöchentliche Zins-/Amortisationstermine gibt es fachlich nicht */
const paymentInterval = z.enum(
  RECURRING_INTERVALS.filter(i => i !== "weekly") as [
    PaymentInterval,
    ...PaymentInterval[],
  ]
);
const bpInput = z.number().int().min(0).max(100000);

/* --------------------------- Historien-Labels ------------------------------ */

const PROPERTY_LABELS: Record<string, string> = {
  name: "Name",
  address: "Adresse",
  usage: "Nutzung",
  purchasePrice: "Kaufpreis",
  purchaseDate: "Kaufdatum",
  marketValue: "Verkehrswert",
  valueDate: "Stichtag Verkehrswert",
  householdIncome: "Bruttojahreseinkommen",
  firstMortgageLimitBp: "Grenze 1. Hypothek (Bp)",
  maxLtvBp: "Maximale Belehnung (Bp)",
  calcInterestRateBp: "Kalkulatorischer Zins (Bp)",
  maintenanceRateBp: "Unterhaltspauschale (Bp)",
  amortizationYears: "Amortisationsfrist (Jahre)",
  notes: "Notizen",
};

const TRANCHE_LABELS: Record<string, string> = {
  name: "Name",
  kind: "Art",
  principal: "Restschuld",
  balanceDate: "Stichtag Restschuld",
  interestRateBp: "Zinssatz (Bp)",
  marginBp: "Marge (Bp)",
  bankId: "Bank",
  startDate: "Beginn",
  maturityDate: "Ablauf Zinsbindung",
  paymentInterval: "Zahlungsrhythmus",
  notes: "Notizen",
};

const AMORTIZATION_LABELS: Record<string, string> = {
  kind: "Art",
  trancheId: "Tranche",
  amount: "Betrag",
  interval: "Intervall",
  accountId: "Zielkonto",
  startDate: "Beginn",
  endDate: "Ende",
  active: "Aktiv",
  notes: "Notizen",
};

const USAGE_LABELS: Record<string, string> = {
  owner_occupied: "Selbstbewohnt",
  rental: "Renditeobjekt",
  vacation: "Ferienobjekt",
};

const TRANCHE_KIND_LABELS: Record<string, string> = {
  fixed: "Festhypothek",
  saron: "SARON",
  variable: "Variabel",
};

const INTERVAL_LABELS: Record<string, string> = {
  monthly: "monatlich",
  quarterly: "vierteljährlich",
  semiannual: "halbjährlich",
  yearly: "jährlich",
};

/** Enum-Werte im Verlauf lesbar machen (Beträge bleiben roh in Cent) */
function formatPropertyField(
  field: string,
  value: FieldValue
): string | number | null {
  if (value === null) return null;
  if (field === "usage") return USAGE_LABELS[String(value)] ?? String(value);
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
}

function formatTrancheField(
  field: string,
  value: FieldValue
): string | number | null {
  if (value === null) return null;
  if (field === "kind") return TRANCHE_KIND_LABELS[String(value)] ?? String(value);
  if (field === "paymentInterval")
    return INTERVAL_LABELS[String(value)] ?? String(value);
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
}

function formatAmortizationField(
  field: string,
  value: FieldValue
): string | number | null {
  if (value === null) return null;
  if (field === "kind") return value === "direct" ? "direkt" : "indirekt";
  if (field === "interval")
    return INTERVAL_LABELS[String(value)] ?? String(value);
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
}

/* ------------------------------- Helfer ------------------------------------ */

/** Liegenschaft laden oder NOT_FOUND werfen */
async function loadProperty(id: number) {
  const row = await getDb().query.properties.findFirst({
    where: eq(properties.id, id),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Liegenschaft nicht gefunden.",
    });
  }
  return row;
}

/** Tranche laden oder NOT_FOUND werfen */
async function loadTranche(id: number) {
  const row = await getDb().query.mortgageTranches.findFirst({
    where: eq(mortgageTranches.id, id),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Tranche nicht gefunden.",
    });
  }
  return row;
}

/** Amortisation laden oder NOT_FOUND werfen */
async function loadAmortization(id: number) {
  const row = await getDb().query.mortgageAmortizations.findFirst({
    where: eq(mortgageAmortizations.id, id),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Amortisation nicht gefunden.",
    });
  }
  return row;
}

/**
 * IDs der Dauerbuchungen, die es wirklich noch gibt. Rückverweise auf
 * gelöschte Dauerbuchungen gelten überall als „nicht vorhanden" — so lügt
 * kein Badge und „Als Dauerbuchung übernehmen" bleibt benutzbar.
 */
async function existingRecurringIds(ids: number[]): Promise<Set<number>> {
  const wanted = ids.filter(i => i > 0);
  if (wanted.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: recurring.id })
    .from(recurring)
    .where(inArray(recurring.id, wanted));
  return new Set(rows.map(r => r.id));
}

/** Wöchentliche Werte gibt es fachlich nicht — defensiv auf monthly */
function asPaymentInterval(interval: string): PaymentInterval {
  return interval === "weekly" ? "monthly" : (interval as PaymentInterval);
}

/** Erster Tag des Folgemonats als YYYY-MM-DD (wie transferNetSalary) */
function firstOfNextMonth(): string {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Prüft den Rückverweis auf eine Dauerbuchung.
 *
 * Selbstheilend: Zeigt der Verweis auf eine gelöschte Dauerbuchung, gilt er
 * als nicht gesetzt — sonst wäre der Posten nach dem Löschen der
 * Dauerbuchung für immer blockiert.
 */
async function assertNoLiveRecurring(
  recurringId: number | null,
  message: string
): Promise<void> {
  if (recurringId === null) return;
  const known = await existingRecurringIds([recurringId]);
  if (known.has(recurringId)) {
    throw new TRPCError({ code: "CONFLICT", message });
  }
}

/** Zins pro Zahlungstermin (Cent) */
function interestPerPayment(
  principal: number,
  effectiveRateBp: number,
  interval: PaymentInterval
): number {
  const yearly = Math.round((principal * effectiveRateBp) / 10000);
  return Math.round((yearly * MONTHS_PER_INTERVAL[interval]) / 12);
}

/** Tranchen + Amortisationen einer Liegenschaft für die Engine aufbereiten */
async function scheduleFor(propertyId: number) {
  const db = getDb();
  const property = await loadProperty(propertyId);
  const [tranches, amorts] = await Promise.all([
    db
      .select()
      .from(mortgageTranches)
      .where(eq(mortgageTranches.propertyId, propertyId)),
    db
      .select()
      .from(mortgageAmortizations)
      .where(eq(mortgageAmortizations.propertyId, propertyId)),
  ]);
  return { property, tranches, amorts };
}

export const mortgageRouter = createRouter({
  /* ----------------------------- Liegenschaften --------------------------- */

  listProperties: authedQuery.query(async () => {
    const db = getDb();
    const [rows, tranches, amorts] = await Promise.all([
      db.select().from(properties).orderBy(properties.id),
      db.select().from(mortgageTranches),
      db.select().from(mortgageAmortizations),
    ]);
    return rows.map(p => {
      const own = tranches.filter(t => t.propertyId === p.id);
      const totalDebt = own.reduce((s, t) => s + t.principal, 0);
      return {
        ...p,
        totalDebt,
        ltvBp:
          p.marketValue > 0
            ? Math.round((totalDebt * 10000) / p.marketValue)
            : null,
        trancheCount: own.length,
        amortizationCount: amorts.filter(a => a.propertyId === p.id).length,
      };
    });
  }),

  addProperty: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(1, "Name darf nicht leer sein."),
        address: z.string().trim().default(""),
        country: z.string().trim().length(2).default("CH"),
        usage: z
          .enum(["owner_occupied", "rental", "vacation"])
          .default("owner_occupied"),
        purchasePrice: z.number().int().min(0).default(0),
        purchaseDate: isoDate.nullish(),
        marketValue: z.number().int().min(0).default(0),
        valueDate: isoDate.nullish(),
        householdIncome: z.number().int().min(0).default(0),
        firstMortgageLimitBp: bpInput.default(6667),
        maxLtvBp: bpInput.default(8000),
        calcInterestRateBp: bpInput.default(500),
        maintenanceRateBp: bpInput.default(100),
        amortizationYears: z.number().int().min(1).max(50).default(15),
        notes: z.string().trim().default(""),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const values = {
        ...input,
        purchaseDate: input.purchaseDate ?? null,
        valueDate: input.valueDate ?? null,
      };
      const inserted = await db
        .insert(properties)
        .values({ ...values, createdAt: new Date() })
        .returning({ id: properties.id });
      const id = inserted[0].id;
      await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "property",
        entityId: id,
        before: null,
        after: values as Record<string, FieldValue>,
        fieldLabels: PROPERTY_LABELS,
        format: formatPropertyField,
        summary: `Liegenschaft „${input.name}“`,
      });
      logAudit(
        db,
        ctx.user.id,
        "mortgage.property.created",
        "mortgage",
        id,
        `Liegenschaft „${input.name}“ (${auditAmount(input.marketValue)})`
      );
      return { id };
    }),

  updateProperty: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1, "Name darf nicht leer sein.").optional(),
        address: z.string().trim().optional(),
        usage: z.enum(["owner_occupied", "rental", "vacation"]).optional(),
        purchasePrice: z.number().int().min(0).optional(),
        purchaseDate: isoDate.nullish(),
        marketValue: z.number().int().min(0).optional(),
        valueDate: isoDate.nullish(),
        householdIncome: z.number().int().min(0).optional(),
        firstMortgageLimitBp: bpInput.optional(),
        maxLtvBp: bpInput.optional(),
        calcInterestRateBp: bpInput.optional(),
        maintenanceRateBp: bpInput.optional(),
        amortizationYears: z.number().int().min(1).max(50).optional(),
        notes: z.string().trim().optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadProperty(input.id);
      const next = {
        name: input.name ?? row.name,
        address: input.address ?? row.address,
        usage: input.usage ?? row.usage,
        purchasePrice: input.purchasePrice ?? row.purchasePrice,
        // nullish: undefined = unverändert, null = entfernen
        purchaseDate:
          input.purchaseDate === undefined ? row.purchaseDate : input.purchaseDate,
        marketValue: input.marketValue ?? row.marketValue,
        valueDate:
          input.valueDate === undefined ? row.valueDate : input.valueDate,
        householdIncome: input.householdIncome ?? row.householdIncome,
        firstMortgageLimitBp:
          input.firstMortgageLimitBp ?? row.firstMortgageLimitBp,
        maxLtvBp: input.maxLtvBp ?? row.maxLtvBp,
        calcInterestRateBp: input.calcInterestRateBp ?? row.calcInterestRateBp,
        maintenanceRateBp: input.maintenanceRateBp ?? row.maintenanceRateBp,
        amortizationYears: input.amortizationYears ?? row.amortizationYears,
        notes: input.notes ?? row.notes,
      };
      const changed = await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "property",
        entityId: row.id,
        comment: input.comment,
        before: {
          name: row.name,
          address: row.address,
          usage: row.usage,
          purchasePrice: row.purchasePrice,
          purchaseDate: row.purchaseDate,
          marketValue: row.marketValue,
          valueDate: row.valueDate,
          householdIncome: row.householdIncome,
          firstMortgageLimitBp: row.firstMortgageLimitBp,
          maxLtvBp: row.maxLtvBp,
          calcInterestRateBp: row.calcInterestRateBp,
          maintenanceRateBp: row.maintenanceRateBp,
          amortizationYears: row.amortizationYears,
          notes: row.notes,
        },
        after: next,
        fieldLabels: PROPERTY_LABELS,
        format: formatPropertyField,
      });
      if (changed > 0) {
        await db
          .update(properties)
          .set(next)
          .where(eq(properties.id, row.id));
        logAudit(
          db,
          ctx.user.id,
          "mortgage.property.updated",
          "mortgage",
          row.id,
          `Liegenschaft „${next.name}“`
        );
      }
      return { ok: true };
    }),

  deleteProperty: authedQuery
    .input(
      z.object({ id: z.number().int().positive(), comment: commentInput })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadProperty(input.id);
      // Kaskade: erst Kinder, dann die Liegenschaft
      await db
        .delete(mortgageAmortizations)
        .where(eq(mortgageAmortizations.propertyId, row.id));
      await db
        .delete(mortgageTranches)
        .where(eq(mortgageTranches.propertyId, row.id));
      await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "property",
        entityId: row.id,
        comment: input.comment,
        before: { name: row.name },
        after: null,
        fieldLabels: PROPERTY_LABELS,
        summary: `Liegenschaft „${row.name}“`,
      });
      await db.delete(properties).where(eq(properties.id, row.id));
      logAudit(
        db,
        ctx.user.id,
        "mortgage.property.deleted",
        "mortgage",
        row.id,
        `Liegenschaft „${row.name}“`
      );
      return { ok: true };
    }),

  /* -------------------------------- Tranchen ------------------------------ */

  listTranches: authedQuery
    .input(
      z.object({ propertyId: z.number().int().positive().optional() }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await (input?.propertyId
        ? db
            .select()
            .from(mortgageTranches)
            .where(eq(mortgageTranches.propertyId, input.propertyId))
        : db.select().from(mortgageTranches));
      const [bankRows, known] = await Promise.all([
        db.select().from(banks),
        existingRecurringIds(
          rows.map(r => r.interestRecurringId ?? 0).filter(i => i > 0)
        ),
      ]);
      const bankName = new Map(bankRows.map(b => [b.id, b.name]));
      return rows.map(t => {
        const rate = t.interestRateBp + (t.kind === "saron" ? (t.marginBp ?? 0) : 0);
        const yearlyInterest = Math.round((t.principal * rate) / 10000);
        return {
          ...t,
          effectiveRateBp: rate,
          yearlyInterest,
          bankName: t.bankId === null ? null : (bankName.get(t.bankId) ?? null),
          // Rückverweis nur, wenn die Dauerbuchung noch existiert
          interestRecurringId:
            t.interestRecurringId !== null && known.has(t.interestRecurringId)
              ? t.interestRecurringId
              : null,
        };
      });
    }),

  addTranche: authedQuery
    .input(
      z.object({
        propertyId: z.number().int().positive(),
        name: z.string().trim().min(1, "Name darf nicht leer sein."),
        kind: z.enum(["fixed", "saron", "variable"]).default("fixed"),
        principal: z.number().int().min(0).default(0),
        balanceDate: isoDate.nullish(),
        interestRateBp: bpInput.default(0),
        marginBp: bpInput.nullish(),
        bankId: z.number().int().positive().nullish(),
        startDate: isoDate,
        maturityDate: isoDate.nullish(),
        paymentInterval: paymentInterval.default("quarterly"),
        notes: z.string().trim().default(""),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await loadProperty(input.propertyId);
      const values = {
        propertyId: input.propertyId,
        name: input.name,
        kind: input.kind,
        principal: input.principal,
        balanceDate: input.balanceDate ?? null,
        interestRateBp: input.interestRateBp,
        marginBp: input.marginBp ?? null,
        bankId: input.bankId ?? null,
        startDate: input.startDate,
        maturityDate: input.maturityDate ?? null,
        paymentInterval: input.paymentInterval,
        notes: input.notes,
      };
      const inserted = await db
        .insert(mortgageTranches)
        .values({ ...values, createdAt: new Date() })
        .returning({ id: mortgageTranches.id });
      const id = inserted[0].id;
      await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "tranche",
        entityId: id,
        before: null,
        after: values as unknown as Record<string, FieldValue>,
        fieldLabels: TRANCHE_LABELS,
        format: formatTrancheField,
        summary: `Tranche „${input.name}“`,
      });
      logAudit(
        db,
        ctx.user.id,
        "mortgage.tranche.created",
        "mortgage",
        id,
        `Tranche „${input.name}“ (${auditAmount(input.principal)})`
      );
      return { id };
    }),

  updateTranche: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1, "Name darf nicht leer sein.").optional(),
        kind: z.enum(["fixed", "saron", "variable"]).optional(),
        principal: z.number().int().min(0).optional(),
        balanceDate: isoDate.nullish(),
        interestRateBp: bpInput.optional(),
        marginBp: bpInput.nullish(),
        bankId: z.number().int().positive().nullish(),
        startDate: isoDate.optional(),
        maturityDate: isoDate.nullish(),
        paymentInterval: paymentInterval.optional(),
        notes: z.string().trim().optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadTranche(input.id);
      const next = {
        name: input.name ?? row.name,
        kind: input.kind ?? row.kind,
        principal: input.principal ?? row.principal,
        balanceDate:
          input.balanceDate === undefined ? row.balanceDate : input.balanceDate,
        interestRateBp: input.interestRateBp ?? row.interestRateBp,
        marginBp: input.marginBp === undefined ? row.marginBp : input.marginBp,
        bankId: input.bankId === undefined ? row.bankId : input.bankId,
        startDate: input.startDate ?? row.startDate,
        maturityDate:
          input.maturityDate === undefined
            ? row.maturityDate
            : input.maturityDate,
        paymentInterval: input.paymentInterval ?? row.paymentInterval,
        notes: input.notes ?? row.notes,
      };
      const changed = await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "tranche",
        entityId: row.id,
        comment: input.comment,
        before: {
          name: row.name,
          kind: row.kind,
          principal: row.principal,
          balanceDate: row.balanceDate,
          interestRateBp: row.interestRateBp,
          marginBp: row.marginBp,
          bankId: row.bankId,
          startDate: row.startDate,
          maturityDate: row.maturityDate,
          paymentInterval: row.paymentInterval,
          notes: row.notes,
        },
        after: next,
        fieldLabels: TRANCHE_LABELS,
        format: formatTrancheField,
      });
      if (changed > 0) {
        await db
          .update(mortgageTranches)
          .set(next)
          .where(eq(mortgageTranches.id, row.id));
        logAudit(
          db,
          ctx.user.id,
          "mortgage.tranche.updated",
          "mortgage",
          row.id,
          `Tranche „${next.name}“`
        );
      }
      return { ok: true };
    }),

  deleteTranche: authedQuery
    .input(
      z.object({ id: z.number().int().positive(), comment: commentInput })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadTranche(input.id);
      // Direkte Amortisationen dieser Tranche verlieren ihr Ziel — sie
      // werden mitgelöscht, statt als wirkungslose Zeilen stehenzubleiben
      await db
        .delete(mortgageAmortizations)
        .where(eq(mortgageAmortizations.trancheId, row.id));
      await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "tranche",
        entityId: row.id,
        comment: input.comment,
        before: { name: row.name },
        after: null,
        fieldLabels: TRANCHE_LABELS,
        summary: `Tranche „${row.name}“`,
      });
      await db
        .delete(mortgageTranches)
        .where(eq(mortgageTranches.id, row.id));
      logAudit(
        db,
        ctx.user.id,
        "mortgage.tranche.deleted",
        "mortgage",
        row.id,
        `Tranche „${row.name}“`
      );
      return { ok: true };
    }),

  /* ----------------------------- Amortisationen --------------------------- */

  listAmortizations: authedQuery
    .input(
      z.object({ propertyId: z.number().int().positive().optional() }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await (input?.propertyId
        ? db
            .select()
            .from(mortgageAmortizations)
            .where(eq(mortgageAmortizations.propertyId, input.propertyId))
        : db.select().from(mortgageAmortizations));
      const known = await existingRecurringIds(
        rows.map(r => r.recurringId ?? 0).filter(i => i > 0)
      );
      return rows.map(a => ({
        ...a,
        recurringId:
          a.recurringId !== null && known.has(a.recurringId)
            ? a.recurringId
            : null,
      }));
    }),

  addAmortization: authedQuery
    .input(
      z.object({
        propertyId: z.number().int().positive(),
        trancheId: z.number().int().positive().nullish(),
        kind: z.enum(["direct", "indirect"]).default("direct"),
        amount: z.number().int().positive(),
        interval: paymentInterval.default("yearly"),
        accountId: z.number().int().positive().nullish(),
        startDate: isoDate,
        endDate: isoDate.nullish(),
        active: z.boolean().default(true),
        notes: z.string().trim().default(""),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await loadProperty(input.propertyId);

      // Direkt muss eine Tranche der Liegenschaft treffen, indirekt nicht
      let trancheId: number | null = null;
      if (input.kind === "direct") {
        if (!input.trancheId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Für eine direkte Amortisation muss eine Tranche gewählt werden.",
          });
        }
        const tranche = await loadTranche(input.trancheId);
        if (tranche.propertyId !== input.propertyId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Die Tranche gehört nicht zu dieser Liegenschaft.",
          });
        }
        trancheId = tranche.id;
      }
      if (input.accountId) {
        // Verknüpftes Konto muss mindestens lesbar sein (wie bei Säule 3a)
        await requireAccountAccess(db, ctx.user, input.accountId, "view");
      }
      if (input.endDate && input.endDate < input.startDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Das Enddatum darf nicht vor dem Beginn liegen.",
        });
      }

      const values = {
        propertyId: input.propertyId,
        trancheId,
        kind: input.kind,
        amount: input.amount,
        interval: input.interval,
        accountId: input.accountId ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        active: input.active,
        notes: input.notes,
      };
      const inserted = await db
        .insert(mortgageAmortizations)
        .values({ ...values, createdAt: new Date() })
        .returning({ id: mortgageAmortizations.id });
      const id = inserted[0].id;
      const label = input.kind === "direct" ? "Direkte" : "Indirekte";
      await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "amortization",
        entityId: id,
        before: null,
        after: values as unknown as Record<string, FieldValue>,
        fieldLabels: AMORTIZATION_LABELS,
        format: formatAmortizationField,
        summary: `${label} Amortisation`,
      });
      logAudit(
        db,
        ctx.user.id,
        "mortgage.amortization.created",
        "mortgage",
        id,
        `${label} Amortisation ${auditAmount(input.amount)}`
      );
      return { id };
    }),

  updateAmortization: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        amount: z.number().int().positive().optional(),
        interval: paymentInterval.optional(),
        accountId: z.number().int().positive().nullish(),
        startDate: isoDate.optional(),
        endDate: isoDate.nullish(),
        active: z.boolean().optional(),
        notes: z.string().trim().optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadAmortization(input.id);
      if (input.accountId) {
        await requireAccountAccess(db, ctx.user, input.accountId, "view");
      }
      const next = {
        kind: row.kind,
        trancheId: row.trancheId,
        amount: input.amount ?? row.amount,
        interval: input.interval ?? row.interval,
        accountId:
          input.accountId === undefined ? row.accountId : input.accountId,
        startDate: input.startDate ?? row.startDate,
        endDate: input.endDate === undefined ? row.endDate : input.endDate,
        active: input.active ?? row.active,
        notes: input.notes ?? row.notes,
      };
      if (next.endDate && next.endDate < next.startDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Das Enddatum darf nicht vor dem Beginn liegen.",
        });
      }
      const changed = await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "amortization",
        entityId: row.id,
        comment: input.comment,
        before: {
          kind: row.kind,
          trancheId: row.trancheId,
          amount: row.amount,
          interval: row.interval,
          accountId: row.accountId,
          startDate: row.startDate,
          endDate: row.endDate,
          active: row.active,
          notes: row.notes,
        },
        after: next,
        fieldLabels: AMORTIZATION_LABELS,
        format: formatAmortizationField,
      });
      if (changed > 0) {
        await db
          .update(mortgageAmortizations)
          .set(next)
          .where(eq(mortgageAmortizations.id, row.id));
        logAudit(
          db,
          ctx.user.id,
          "mortgage.amortization.updated",
          "mortgage",
          row.id,
          `Amortisation ${auditAmount(next.amount)}`
        );
      }
      return { ok: true };
    }),

  deleteAmortization: authedQuery
    .input(
      z.object({ id: z.number().int().positive(), comment: commentInput })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadAmortization(input.id);
      const label = row.kind === "direct" ? "Direkte" : "Indirekte";
      await recordMortgageChange(db, {
        userId: ctx.user.id,
        entity: "amortization",
        entityId: row.id,
        comment: input.comment,
        before: { amount: row.amount },
        after: null,
        fieldLabels: AMORTIZATION_LABELS,
        summary: `${label} Amortisation`,
      });
      await db
        .delete(mortgageAmortizations)
        .where(eq(mortgageAmortizations.id, row.id));
      logAudit(
        db,
        ctx.user.id,
        "mortgage.amortization.deleted",
        "mortgage",
        row.id,
        `${label} Amortisation ${auditAmount(row.amount)}`
      );
      return { ok: true };
    }),

  /* -------------------------------- Verlauf ------------------------------- */

  listChanges: authedQuery
    .input(
      z.object({
        entity: z.string().max(50).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        // Offset-Cursor für die Pagination („Mehr laden" im UI)
        cursor: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const where = input.entity
        ? eq(mortgageChanges.entity, input.entity)
        : undefined;
      const [rows, countRow, userRows] = await Promise.all([
        db.query.mortgageChanges.findMany({
          where,
          orderBy: (t, { desc: d }) => [d(t.createdAt), d(t.id)],
          limit: input.limit,
          offset: input.cursor,
        }),
        db
          .select({ total: sql<number>`count(*)` })
          .from(mortgageChanges)
          .where(where),
        db
          .select({ id: users.id, name: users.name, color: users.color })
          .from(users),
      ]);
      const byId = new Map(userRows.map(u => [u.id, u]));
      const total = countRow[0]?.total ?? 0;
      const nextCursor =
        input.cursor + rows.length < total ? input.cursor + rows.length : null;
      return {
        entries: rows.map(row => ({
          ...row,
          // Haushaltsweit: wer die Änderung gemacht hat, gehört ins UI
          userName: byId.get(row.userId)?.name ?? null,
          userColor: byId.get(row.userId)?.color ?? null,
          changes: JSON.parse(row.changes) as {
            field: string;
            from: string | number | null;
            to: string | number | null;
          }[],
        })),
        total,
        nextCursor,
      };
    }),

  /* ------------------------------- Berechnung ----------------------------- */

  forecast: authedQuery
    .input(
      z.object({
        propertyId: z.number().int().positive(),
        months: z.number().int().min(12).max(600).default(360),
      })
    )
    .query(async ({ input }) => {
      const { property, tranches, amorts } = await scheduleFor(
        input.propertyId
      );
      let calculator;
      try {
        calculator = getMortgageCalculator(property.country);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Unbekanntes Land.",
        });
      }
      return calculator.schedule({
        property,
        tranches: tranches.map(t => ({
          ...t,
          paymentInterval: asPaymentInterval(t.paymentInterval),
        })),
        amortizations: amorts.map(a => ({
          ...a,
          interval: asPaymentInterval(a.interval),
        })),
        months: input.months,
      });
    }),

  /**
   * Kompakte Kennzahlen fürs Dashboard — bewusst ohne Engine-Aufruf, die
   * aktuelle Restschuld ist schlicht die Summe der Tranchen.
   */
  summary: authedQuery.query(async () => {
    const db = getDb();
    const [props, tranches, amorts] = await Promise.all([
      db.select().from(properties),
      db.select().from(mortgageTranches),
      db.select().from(mortgageAmortizations),
    ]);
    const propertyValue = props.reduce((s, p) => s + p.marketValue, 0);
    const totalDebt = tranches.reduce((s, t) => s + t.principal, 0);
    const known = await existingRecurringIds([
      ...tranches.map(t => t.interestRecurringId ?? 0),
      ...amorts.map(a => a.recurringId ?? 0),
    ]);
    const missing = (id: number | null) => id === null || !known.has(id);
    return {
      count: props.length,
      propertyValue,
      totalDebt,
      equity: propertyValue - totalDebt,
      missingRecurringCount:
        tranches.filter(t => missing(t.interestRecurringId)).length +
        amorts.filter(a => a.active && missing(a.recurringId)).length,
    };
  }),

  /* ------------------------ Übernahme als Dauerbuchung -------------------- */

  /**
   * Legt den Hypothekarzins einer Tranche als wiederkehrende Ausgabe an.
   * Kopie, kein Live-Sync (wie `pension.transferNetSalary`): Ändert sich
   * später der Zinssatz, muss die Dauerbuchung angepasst werden.
   */
  transferInterestToRecurring: authedQuery
    .input(
      z.object({
        trancheId: z.number().int().positive(),
        accountId: z.number().int().positive(),
        categoryId: z.number().int().positive().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tranche = await loadTranche(input.trancheId);
      await assertNoLiveRecurring(
        tranche.interestRecurringId,
        "Für diese Tranche ist bereits eine Dauerbuchung hinterlegt."
      );
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");

      const rate =
        tranche.interestRateBp +
        (tranche.kind === "saron" ? (tranche.marginBp ?? 0) : 0);
      const interval = asPaymentInterval(tranche.paymentInterval);
      const amount = interestPerPayment(tranche.principal, rate, interval);
      if (amount <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Aus Restschuld und Zinssatz ergibt sich kein Zinsbetrag — bitte zuerst erfassen.",
        });
      }

      const nextDate = firstOfNextMonth();
      const inserted = await db
        .insert(recurring)
        .values({
          type: "expense",
          accountId: input.accountId,
          toAccountId: null,
          amount,
          categoryId: input.categoryId ?? null,
          userId: ctx.user.id,
          note: `Hypothekarzins „${tranche.name}“`,
          interval,
          nextDate,
          endDate: null,
          active: true,
          createdAt: new Date(),
        })
        .returning({ id: recurring.id });
      const recurringId = inserted[0].id;
      await db
        .update(mortgageTranches)
        .set({ interestRecurringId: recurringId })
        .where(eq(mortgageTranches.id, tranche.id));
      logAudit(
        db,
        ctx.user.id,
        "mortgage.interest.transferred",
        "mortgage",
        tranche.id,
        `Hypothekarzins „${tranche.name}“ ${auditAmount(amount)} ${INTERVAL_LABELS[interval]}`
      );
      return { id: recurringId, amount, interval, nextDate };
    }),

  /**
   * Legt eine Amortisation als Dauerbuchung an: direkt als Ausgabe,
   * indirekt als Umbuchung aufs verknüpfte Konto (meist Säule 3a).
   */
  transferAmortizationToRecurring: authedQuery
    .input(
      z.object({
        amortizationId: z.number().int().positive(),
        accountId: z.number().int().positive(),
        /** Ziel der Umbuchung bei indirekter Amortisation */
        toAccountId: z.number().int().positive().nullish(),
        categoryId: z.number().int().positive().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadAmortization(input.amortizationId);
      await assertNoLiveRecurring(
        row.recurringId,
        "Für diese Amortisation ist bereits eine Dauerbuchung hinterlegt."
      );
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");

      const interval = asPaymentInterval(row.interval);
      let note: string;
      let toAccountId: number | null = null;

      if (row.kind === "indirect") {
        // Umbuchung aufs Vorsorge-/Sparkonto: Rechte wie bei createRecurring
        const target = input.toAccountId ?? row.accountId;
        if (!target) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Für die indirekte Amortisation fehlt das Zielkonto — bitte eines hinterlegen.",
          });
        }
        if (target === input.accountId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Quell- und Zielkonto müssen sich unterscheiden.",
          });
        }
        await requireAccountAccess(db, ctx.user, target, "view");
        toAccountId = target;
        note = "Amortisation (indirekt)";
      } else {
        const tranche =
          row.trancheId !== null ? await loadTranche(row.trancheId) : null;
        note = tranche
          ? `Amortisation „${tranche.name}“ (direkt)`
          : "Amortisation (direkt)";
      }

      const nextDate = firstOfNextMonth();
      const inserted = await db
        .insert(recurring)
        .values({
          type: row.kind === "indirect" ? "transfer" : "expense",
          accountId: input.accountId,
          toAccountId,
          amount: row.amount,
          categoryId: row.kind === "indirect" ? null : (input.categoryId ?? null),
          userId: ctx.user.id,
          note,
          interval,
          nextDate,
          endDate: row.endDate,
          active: true,
          createdAt: new Date(),
        })
        .returning({ id: recurring.id });
      const recurringId = inserted[0].id;
      await db
        .update(mortgageAmortizations)
        .set({ recurringId })
        .where(eq(mortgageAmortizations.id, row.id));
      logAudit(
        db,
        ctx.user.id,
        "mortgage.amortization.transferred",
        "mortgage",
        row.id,
        `${note} ${auditAmount(row.amount)} ${INTERVAL_LABELS[interval]}`
      );
      return { id: recurringId, amount: row.amount, interval, nextDate };
    }),
});
