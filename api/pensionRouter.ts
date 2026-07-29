import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  accounts,
  categories,
  pensionAhv,
  pensionAttachments,
  pensionChanges,
  pensionDeductions,
  pensionFunds,
  pensionPillar3,
  pensionProfiles,
  pensionSalaries,
  recurring,
} from "@db/schema";
import { requireAccountAccess } from "./lib/accountAccess";
import { deletePensionAttachmentsFor } from "./lib/attachments";
import { auditAmount, logAudit } from "./lib/audit";
import {
  recordPensionChange,
  type PensionFieldValue,
} from "./lib/pension/history";
import { computeNet, salaryForMonth } from "./lib/pension/netSalary";
import { pillar3AccountSync } from "./lib/pension/accountSync";
import { getPensionCalculator } from "./lib/pension";

/**
 * Vorsorge-Modul (Schweizer 3-Säulen-Prinzip) — alle Daten sind strikt
 * privat: jeder Endpunkt ist auf ctx.user.id gescoped, es gibt keine
 * Haushalts-Sichtbarkeit. Jede Mutation schreibt bei echter Änderung einen
 * Eintrag in pension_changes (recordPensionChange) und best effort ins
 * Audit-Log (ohne sensible Werte wie die AHV-Nummer).
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "Monat als YYYY-MM");
const commentInput = z.string().max(500).optional();

/** Deutsche Feldnamen der Änderungshistorie (pension_changes) */
const PROFILE_LABELS = {
  birthDate: "Geburtsdatum",
  retirementAge: "Rentenalter",
  country: "Land",
};
const SALARY_LABELS = {
  validFrom: "Gültig ab",
  grossMonthly: "Bruttolohn",
  note: "Notiz",
};
const DEDUCTION_LABELS = {
  name: "Name",
  mode: "Modus",
  value: "Wert",
  active: "Aktiv",
};
const AHV_LABELS = {
  ahvNumber: "AHV-Nummer",
  contributionYears: "Beitragsjahre",
  expectedMonthlyPension: "Erwartete Monatsrente",
  notes: "Notizen",
};
const FUND_LABELS = {
  name: "Name",
  kind: "Art",
  currentCapital: "Guthaben",
  yearlySavings: "Jährliches Sparen",
  interestRateBp: "Zinssatz (Bp)",
  conversionRateBp: "Umwandlungssatz (Bp)",
  notes: "Notizen",
};
const PILLAR3_LABELS = {
  name: "Name",
  institution: "Institution",
  currentBalance: "Guthaben",
  yearlyDeposit: "Jährliche Einzahlung",
  interestRateBp: "Zinssatz (Bp)",
  accountId: "Konto",
  notes: "Notizen",
};

/** Lesbare Werte für Enum-Felder der Historie */
function formatDeductionField(
  field: string,
  value: PensionFieldValue
): string | number | null {
  if (field === "mode") {
    if (value === "percent") return "Prozent";
    if (value === "absolute") return "Absolut";
  }
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
}

function formatFundField(
  field: string,
  value: PensionFieldValue
): string | number | null {
  if (field === "kind") {
    if (value === "pension_fund") return "Pensionskasse";
    if (value === "vested_benefits") return "Freizügigkeitskonto";
  }
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
}

/** Aktueller Monat als YYYY-MM (lokal) */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Erster Tag des Folgemonats als YYYY-MM-DD (lokal) */
function firstOfNextMonth(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Validierung der Abzugswerte (percent: Basispunkte, absolute: Cent) */
function assertDeductionValue(mode: "percent" | "absolute", value: number) {
  if (mode === "percent" && (value <= 0 || value > 10000)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Prozent-Abzüge müssen zwischen 1 und 10000 Basispunkten liegen.",
    });
  }
  if (mode === "absolute" && value <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Absolute Abzüge müssen grösser als 0 sein.",
    });
  }
}

export const pensionRouter = createRouter({
  /* ---------------------------------- Profil -------------------------------- */

  getProfile: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const row = await db.query.pensionProfiles.findFirst({
      where: eq(pensionProfiles.userId, ctx.user.id),
    });
    return row ?? null;
  }),

  updateProfile: authedQuery
    .input(
      z.object({
        birthDate: isoDate.optional(),
        retirementAge: z.number().int().min(50).max(75).optional(),
        country: z
          .string()
          .regex(/^[A-Z]{2}$/, "Ländercode als ISO-Code (z. B. CH)")
          .optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.pensionProfiles.findFirst({
        where: eq(pensionProfiles.userId, ctx.user.id),
      });
      if (!existing) {
        if (!input.birthDate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Zum Anlegen des Vorsorgeprofils wird das Geburtsdatum benötigt.",
          });
        }
        const inserted = await db
          .insert(pensionProfiles)
          .values({
            userId: ctx.user.id,
            country: input.country ?? "CH",
            birthDate: input.birthDate,
            retirementAge: input.retirementAge ?? 65,
            createdAt: new Date(),
          })
          .returning({ id: pensionProfiles.id });
        await recordPensionChange(db, {
          userId: ctx.user.id,
          entity: "profile",
          entityId: inserted[0].id,
          comment: input.comment,
          before: null,
          after: {
            birthDate: input.birthDate,
            retirementAge: input.retirementAge ?? 65,
            country: input.country ?? "CH",
          },
          fieldLabels: PROFILE_LABELS,
          summary: `Profil angelegt (Rentenalter ${input.retirementAge ?? 65})`,
        });
        logAudit(
          db,
          ctx.user.id,
          "pension.profile.created",
          "pension",
          inserted[0].id,
          `Vorsorgeprofil angelegt (Rentenalter ${input.retirementAge ?? 65})`
        );
        return { ok: true };
      }

      const next = {
        birthDate: input.birthDate ?? existing.birthDate,
        retirementAge: input.retirementAge ?? existing.retirementAge,
        country: input.country ?? existing.country,
      };
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "profile",
        entityId: existing.id,
        comment: input.comment,
        before: {
          birthDate: existing.birthDate,
          retirementAge: existing.retirementAge,
          country: existing.country,
        },
        after: next,
        fieldLabels: PROFILE_LABELS,
      });
      if (changed > 0) {
        await db
          .update(pensionProfiles)
          .set(next)
          .where(eq(pensionProfiles.id, existing.id));
        logAudit(
          db,
          ctx.user.id,
          "pension.profile.updated",
          "pension",
          existing.id,
          "Vorsorgeprofil aktualisiert"
        );
      }
      return { ok: true };
    }),

  /* ----------------------------------- Lohn --------------------------------- */

  listSalaries: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.query.pensionSalaries.findMany({
      where: eq(pensionSalaries.userId, ctx.user.id),
      orderBy: (t, { asc }) => [asc(t.validFrom)],
    });
  }),

  addSalary: authedQuery
    .input(
      z.object({
        validFrom: isoMonth,
        grossMonthly: z.number().int().positive(),
        note: z.string().max(500).default(""),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const duplicate = await db.query.pensionSalaries.findFirst({
        where: and(
          eq(pensionSalaries.userId, ctx.user.id),
          eq(pensionSalaries.validFrom, input.validFrom)
        ),
      });
      if (duplicate) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Für diesen Monat ist bereits ein Lohn erfasst.",
        });
      }
      const inserted = await db
        .insert(pensionSalaries)
        .values({
          userId: ctx.user.id,
          validFrom: input.validFrom,
          grossMonthly: input.grossMonthly,
          note: input.note,
        })
        .returning({ id: pensionSalaries.id });
      const summary = `Lohn ab ${input.validFrom}: ${input.grossMonthly}`;
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "salary",
        entityId: inserted[0].id,
        comment: input.comment,
        before: null,
        after: {
          validFrom: input.validFrom,
          grossMonthly: input.grossMonthly,
          note: input.note,
        },
        fieldLabels: SALARY_LABELS,
      });
      logAudit(
        db,
        ctx.user.id,
        "pension.salary.created",
        "pension",
        inserted[0].id,
        summary
      );
      return { id: inserted[0].id };
    }),

  updateSalary: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        validFrom: isoMonth.optional(),
        grossMonthly: z.number().int().positive().optional(),
        note: z.string().max(500).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.pensionSalaries.findFirst({
        where: and(
          eq(pensionSalaries.id, input.id),
          eq(pensionSalaries.userId, ctx.user.id)
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Lohneintrag nicht gefunden.",
        });
      }
      const next = {
        validFrom: input.validFrom ?? row.validFrom,
        grossMonthly: input.grossMonthly ?? row.grossMonthly,
        note: input.note ?? row.note,
      };
      if (next.validFrom !== row.validFrom) {
        const duplicate = await db.query.pensionSalaries.findFirst({
          where: and(
            eq(pensionSalaries.userId, ctx.user.id),
            eq(pensionSalaries.validFrom, next.validFrom)
          ),
        });
        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Für diesen Monat ist bereits ein Lohn erfasst.",
          });
        }
      }
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "salary",
        entityId: row.id,
        comment: input.comment,
        before: {
          validFrom: row.validFrom,
          grossMonthly: row.grossMonthly,
          note: row.note,
        },
        after: next,
        fieldLabels: SALARY_LABELS,
      });
      if (changed > 0) {
        await db
          .update(pensionSalaries)
          .set(next)
          .where(eq(pensionSalaries.id, row.id));
        logAudit(
          db,
          ctx.user.id,
          "pension.salary.updated",
          "pension",
          row.id,
          `Lohn ab ${next.validFrom}: ${next.grossMonthly}`
        );
      }
      return { ok: true };
    }),

  deleteSalary: authedQuery
    .input(z.object({ id: z.number().int().positive(), comment: commentInput }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.pensionSalaries.findFirst({
        where: and(
          eq(pensionSalaries.id, input.id),
          eq(pensionSalaries.userId, ctx.user.id)
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Lohneintrag nicht gefunden.",
        });
      }
      const summary = `Lohn ab ${row.validFrom}: ${row.grossMonthly}`;
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "salary",
        entityId: row.id,
        comment: input.comment,
        before: {
          validFrom: row.validFrom,
          grossMonthly: row.grossMonthly,
          note: row.note,
        },
        after: null,
        fieldLabels: SALARY_LABELS,
      });
      await db.delete(pensionSalaries).where(eq(pensionSalaries.id, row.id));
      logAudit(
        db,
        ctx.user.id,
        "pension.salary.deleted",
        "pension",
        row.id,
        summary
      );
      return { ok: true };
    }),

  /* ---------------------------------- Abzüge -------------------------------- */

  listDeductions: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.query.pensionDeductions.findMany({
      where: eq(pensionDeductions.userId, ctx.user.id),
      orderBy: (t, { asc }) => [asc(t.id)],
    });
  }),

  addDeduction: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(1, "Name darf nicht leer sein."),
        mode: z.enum(["percent", "absolute"]),
        value: z.number().int(),
        active: z.boolean().default(true),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertDeductionValue(input.mode, input.value);
      const db = getDb();
      const inserted = await db
        .insert(pensionDeductions)
        .values({
          userId: ctx.user.id,
          name: input.name,
          mode: input.mode,
          value: input.value,
          active: input.active,
          createdAt: new Date(),
        })
        .returning({ id: pensionDeductions.id });
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "deduction",
        entityId: inserted[0].id,
        comment: input.comment,
        before: null,
        after: {
          name: input.name,
          mode: input.mode,
          value: input.value,
          active: input.active,
        },
        fieldLabels: DEDUCTION_LABELS,
        format: formatDeductionField,
        summary: `Abzug „${input.name}“`,
      });
      logAudit(
        db,
        ctx.user.id,
        "pension.deduction.created",
        "pension",
        inserted[0].id,
        `Abzug „${input.name}“`
      );
      return { id: inserted[0].id };
    }),

  updateDeduction: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1, "Name darf nicht leer sein.").optional(),
        mode: z.enum(["percent", "absolute"]).optional(),
        value: z.number().int().optional(),
        active: z.boolean().optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.pensionDeductions.findFirst({
        where: and(
          eq(pensionDeductions.id, input.id),
          eq(pensionDeductions.userId, ctx.user.id)
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Abzug nicht gefunden.",
        });
      }
      const next = {
        name: input.name ?? row.name,
        mode: input.mode ?? row.mode,
        value: input.value ?? row.value,
        active: input.active ?? row.active,
      };
      assertDeductionValue(next.mode, next.value);
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "deduction",
        entityId: row.id,
        comment: input.comment,
        before: {
          name: row.name,
          mode: row.mode,
          value: row.value,
          active: row.active,
        },
        after: next,
        fieldLabels: DEDUCTION_LABELS,
        format: formatDeductionField,
      });
      if (changed > 0) {
        await db
          .update(pensionDeductions)
          .set(next)
          .where(eq(pensionDeductions.id, row.id));
        logAudit(
          db,
          ctx.user.id,
          "pension.deduction.updated",
          "pension",
          row.id,
          `Abzug „${next.name}“`
        );
      }
      return { ok: true };
    }),

  deleteDeduction: authedQuery
    .input(z.object({ id: z.number().int().positive(), comment: commentInput }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.pensionDeductions.findFirst({
        where: and(
          eq(pensionDeductions.id, input.id),
          eq(pensionDeductions.userId, ctx.user.id)
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Abzug nicht gefunden.",
        });
      }
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "deduction",
        entityId: row.id,
        comment: input.comment,
        before: {
          name: row.name,
          mode: row.mode,
          value: row.value,
          active: row.active,
        },
        after: null,
        fieldLabels: DEDUCTION_LABELS,
        format: formatDeductionField,
        summary: `Abzug „${row.name}“`,
      });
      await db
        .delete(pensionDeductions)
        .where(eq(pensionDeductions.id, row.id));
      logAudit(
        db,
        ctx.user.id,
        "pension.deduction.deleted",
        "pension",
        row.id,
        `Abzug „${row.name}“`
      );
      return { ok: true };
    }),

  /* ------------------------------- Säule 1 (AHV) ---------------------------- */

  getAhv: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const row = await db.query.pensionAhv.findFirst({
      where: eq(pensionAhv.userId, ctx.user.id),
    });
    return row ?? null;
  }),

  updateAhv: authedQuery
    .input(
      z.object({
        ahvNumber: z.string().max(50).nullable().optional(),
        contributionYears: z
          .number()
          .int()
          .min(0)
          .max(50)
          .nullable()
          .optional(),
        expectedMonthlyPension: z.number().int().min(0).nullable().optional(),
        notes: z.string().max(2000).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.pensionAhv.findFirst({
        where: eq(pensionAhv.userId, ctx.user.id),
      });
      // Audit-Detail bewusst ohne AHV-Nummer (sensibler Wert)
      if (!existing) {
        const values = {
          userId: ctx.user.id,
          ahvNumber: input.ahvNumber ?? null,
          contributionYears: input.contributionYears ?? null,
          expectedMonthlyPension: input.expectedMonthlyPension ?? null,
          notes: input.notes ?? "",
        };
        const inserted = await db
          .insert(pensionAhv)
          .values(values)
          .returning({ id: pensionAhv.id });
        await recordPensionChange(db, {
          userId: ctx.user.id,
          entity: "ahv",
          entityId: inserted[0].id,
          comment: input.comment,
          before: null,
          after: {
            ahvNumber: values.ahvNumber,
            contributionYears: values.contributionYears,
            expectedMonthlyPension: values.expectedMonthlyPension,
            notes: values.notes,
          },
          fieldLabels: AHV_LABELS,
          summary: "AHV-Daten angelegt",
        });
        logAudit(
          db,
          ctx.user.id,
          "pension.ahv.created",
          "pension",
          inserted[0].id,
          "AHV-Daten angelegt"
        );
        return { ok: true };
      }

      const next = {
        ahvNumber:
          input.ahvNumber === undefined ? existing.ahvNumber : input.ahvNumber,
        contributionYears:
          input.contributionYears === undefined
            ? existing.contributionYears
            : input.contributionYears,
        expectedMonthlyPension:
          input.expectedMonthlyPension === undefined
            ? existing.expectedMonthlyPension
            : input.expectedMonthlyPension,
        notes: input.notes ?? existing.notes,
      };
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "ahv",
        entityId: existing.id,
        comment: input.comment,
        before: {
          ahvNumber: existing.ahvNumber,
          contributionYears: existing.contributionYears,
          expectedMonthlyPension: existing.expectedMonthlyPension,
          notes: existing.notes,
        },
        after: next,
        fieldLabels: AHV_LABELS,
      });
      if (changed > 0) {
        await db
          .update(pensionAhv)
          .set(next)
          .where(eq(pensionAhv.id, existing.id));
        logAudit(
          db,
          ctx.user.id,
          "pension.ahv.updated",
          "pension",
          existing.id,
          "AHV-Daten aktualisiert"
        );
      }
      return { ok: true };
    }),

  /* --------------------------- Säule 2 (Pensionskasse) ---------------------- */

  listFunds: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.query.pensionFunds.findMany({
      where: eq(pensionFunds.userId, ctx.user.id),
      orderBy: (t, { asc }) => [asc(t.id)],
    });
  }),

  addFund: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(1, "Name darf nicht leer sein."),
        kind: z
          .enum(["pension_fund", "vested_benefits"])
          .default("pension_fund"),
        currentCapital: z.number().int().min(0).default(0),
        yearlySavings: z.number().int().min(0).default(0),
        interestRateBp: z.number().int().min(0).default(0),
        conversionRateBp: z.number().int().min(0).default(680),
        notes: z.string().max(2000).default(""),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { comment, ...values } = input;
      const inserted = await db
        .insert(pensionFunds)
        .values({ userId: ctx.user.id, ...values })
        .returning({ id: pensionFunds.id });
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "fund",
        entityId: inserted[0].id,
        comment,
        before: null,
        after: { ...values },
        fieldLabels: FUND_LABELS,
        format: formatFundField,
        summary: `Vorsorgekonto „${input.name}“`,
      });
      logAudit(
        db,
        ctx.user.id,
        "pension.fund.created",
        "pension",
        inserted[0].id,
        `Vorsorgekonto „${input.name}“`
      );
      return { id: inserted[0].id };
    }),

  updateFund: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1, "Name darf nicht leer sein.").optional(),
        kind: z.enum(["pension_fund", "vested_benefits"]).optional(),
        currentCapital: z.number().int().min(0).optional(),
        yearlySavings: z.number().int().min(0).optional(),
        interestRateBp: z.number().int().min(0).optional(),
        conversionRateBp: z.number().int().min(0).optional(),
        notes: z.string().max(2000).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.pensionFunds.findFirst({
        where: and(
          eq(pensionFunds.id, input.id),
          eq(pensionFunds.userId, ctx.user.id)
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Vorsorgekonto nicht gefunden.",
        });
      }
      const next = {
        name: input.name ?? row.name,
        kind: input.kind ?? row.kind,
        currentCapital: input.currentCapital ?? row.currentCapital,
        yearlySavings: input.yearlySavings ?? row.yearlySavings,
        interestRateBp: input.interestRateBp ?? row.interestRateBp,
        conversionRateBp: input.conversionRateBp ?? row.conversionRateBp,
        notes: input.notes ?? row.notes,
      };
      const before = {
        name: row.name,
        kind: row.kind,
        currentCapital: row.currentCapital,
        yearlySavings: row.yearlySavings,
        interestRateBp: row.interestRateBp,
        conversionRateBp: row.conversionRateBp,
        notes: row.notes,
      };
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "fund",
        entityId: row.id,
        comment: input.comment,
        before,
        after: next,
        fieldLabels: FUND_LABELS,
        format: formatFundField,
      });
      if (changed > 0) {
        await db
          .update(pensionFunds)
          .set(next)
          .where(eq(pensionFunds.id, row.id));
        logAudit(
          db,
          ctx.user.id,
          "pension.fund.updated",
          "pension",
          row.id,
          `Vorsorgekonto „${next.name}“`
        );
      }
      return { ok: true };
    }),

  deleteFund: authedQuery
    .input(z.object({ id: z.number().int().positive(), comment: commentInput }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.pensionFunds.findFirst({
        where: and(
          eq(pensionFunds.id, input.id),
          eq(pensionFunds.userId, ctx.user.id)
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Vorsorgekonto nicht gefunden.",
        });
      }
      // Kaskade: zugehörige Anhänge (DB-Zeilen + Dateien) mitlöschen
      await deletePensionAttachmentsFor(db, "fund", [row.id]);
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "fund",
        entityId: row.id,
        comment: input.comment,
        before: {
          name: row.name,
          kind: row.kind,
          currentCapital: row.currentCapital,
          yearlySavings: row.yearlySavings,
          interestRateBp: row.interestRateBp,
          conversionRateBp: row.conversionRateBp,
          notes: row.notes,
        },
        after: null,
        fieldLabels: FUND_LABELS,
        format: formatFundField,
        summary: `Vorsorgekonto „${row.name}“`,
      });
      await db.delete(pensionFunds).where(eq(pensionFunds.id, row.id));
      logAudit(
        db,
        ctx.user.id,
        "pension.fund.deleted",
        "pension",
        row.id,
        `Vorsorgekonto „${row.name}“`
      );
      return { ok: true };
    }),

  /* ------------------------------- Säule 3a --------------------------------- */

  listPillar3: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.query.pensionPillar3.findMany({
      where: eq(pensionPillar3.userId, ctx.user.id),
      orderBy: (t, { asc }) => [asc(t.id)],
    });
    // Verknüpfte Konten: Saldo-Sync + Sparziel-Verpflichtungen anhängen.
    // Ohne „view"-Recht bleibt der Eintrag lesbar, aber ohne Sync-Werte.
    return Promise.all(
      rows.map(async row => {
        if (row.accountId === null) {
          return {
            ...row,
            syncedBalance: null,
            goalCommitment: null,
            goalNames: [] as string[],
          };
        }
        try {
          const sync = await pillar3AccountSync(db, ctx.user, row.accountId);
          return {
            ...row,
            syncedBalance: sync.syncedBalance,
            goalCommitment: sync.goalCommitment,
            goalNames: sync.goalNames,
          };
        } catch {
          return {
            ...row,
            syncedBalance: null,
            goalCommitment: null,
            goalNames: [] as string[],
          };
        }
      })
    );
  }),

  addPillar3: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(1, "Name darf nicht leer sein."),
        institution: z.string().max(200).default(""),
        currentBalance: z.number().int().min(0).default(0),
        yearlyDeposit: z.number().int().min(0).default(0),
        interestRateBp: z.number().int().min(0).default(0),
        accountId: z.number().int().positive().nullable().optional(),
        notes: z.string().max(2000).default(""),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.accountId != null) {
        // Verknüpfungsziel muss existieren und sichtbar sein
        await requireAccountAccess(db, ctx.user, input.accountId, "view");
      }
      const { comment, ...rest } = input;
      const values = { ...rest, accountId: rest.accountId ?? null };
      const inserted = await db
        .insert(pensionPillar3)
        .values({ userId: ctx.user.id, ...values })
        .returning({ id: pensionPillar3.id });
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "pillar3",
        entityId: inserted[0].id,
        comment,
        before: null,
        after: { ...values },
        fieldLabels: PILLAR3_LABELS,
        summary: `3a-Konto „${input.name}“`,
      });
      logAudit(
        db,
        ctx.user.id,
        "pension.pillar3.created",
        "pension",
        inserted[0].id,
        `3a-Konto „${input.name}“`
      );
      return { id: inserted[0].id };
    }),

  updatePillar3: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1, "Name darf nicht leer sein.").optional(),
        institution: z.string().max(200).optional(),
        currentBalance: z.number().int().min(0).optional(),
        yearlyDeposit: z.number().int().min(0).optional(),
        interestRateBp: z.number().int().min(0).optional(),
        // null = Verknüpfung entfernen, undefined = unverändert
        accountId: z.number().int().positive().nullable().optional(),
        notes: z.string().max(2000).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.pensionPillar3.findFirst({
        where: and(
          eq(pensionPillar3.id, input.id),
          eq(pensionPillar3.userId, ctx.user.id)
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "3a-Konto nicht gefunden.",
        });
      }
      if (input.accountId != null) {
        await requireAccountAccess(db, ctx.user, input.accountId, "view");
      }
      const next = {
        name: input.name ?? row.name,
        institution: input.institution ?? row.institution,
        currentBalance: input.currentBalance ?? row.currentBalance,
        yearlyDeposit: input.yearlyDeposit ?? row.yearlyDeposit,
        interestRateBp: input.interestRateBp ?? row.interestRateBp,
        accountId:
          input.accountId === undefined ? row.accountId : input.accountId,
        notes: input.notes ?? row.notes,
      };
      // Konto-Namen für lesbare Diffs auflösen
      const allAccounts = await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts);
      const accountName = (id: number | null) =>
        id === null ? null : (allAccounts.find(a => a.id === id)?.name ?? "?");
      const formatPillar3Field = (
        field: string,
        value: PensionFieldValue
      ): string | number | null => {
        if (field === "accountId") {
          return accountName(typeof value === "number" ? value : null);
        }
        if (value === null || value === undefined) return null;
        if (typeof value === "boolean") return value ? "ja" : "nein";
        return value;
      };
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "pillar3",
        entityId: row.id,
        comment: input.comment,
        before: {
          name: row.name,
          institution: row.institution,
          currentBalance: row.currentBalance,
          yearlyDeposit: row.yearlyDeposit,
          interestRateBp: row.interestRateBp,
          accountId: row.accountId,
          notes: row.notes,
        },
        after: next,
        fieldLabels: PILLAR3_LABELS,
        format: formatPillar3Field,
      });
      if (changed > 0) {
        await db
          .update(pensionPillar3)
          .set(next)
          .where(eq(pensionPillar3.id, row.id));
        logAudit(
          db,
          ctx.user.id,
          "pension.pillar3.updated",
          "pension",
          row.id,
          `3a-Konto „${next.name}“`
        );
      }
      return { ok: true };
    }),

  deletePillar3: authedQuery
    .input(z.object({ id: z.number().int().positive(), comment: commentInput }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.pensionPillar3.findFirst({
        where: and(
          eq(pensionPillar3.id, input.id),
          eq(pensionPillar3.userId, ctx.user.id)
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "3a-Konto nicht gefunden.",
        });
      }
      // Kaskade: zugehörige Anhänge (DB-Zeilen + Dateien) mitlöschen
      await deletePensionAttachmentsFor(db, "pillar3", [row.id]);
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "pillar3",
        entityId: row.id,
        comment: input.comment,
        before: {
          name: row.name,
          institution: row.institution,
          currentBalance: row.currentBalance,
          yearlyDeposit: row.yearlyDeposit,
          interestRateBp: row.interestRateBp,
          accountId: row.accountId,
          notes: row.notes,
        },
        after: null,
        fieldLabels: PILLAR3_LABELS,
        summary: `3a-Konto „${row.name}“`,
      });
      await db.delete(pensionPillar3).where(eq(pensionPillar3.id, row.id));
      logAudit(
        db,
        ctx.user.id,
        "pension.pillar3.deleted",
        "pension",
        row.id,
        `3a-Konto „${row.name}“`
      );
      return { ok: true };
    }),

  /* --------------------------------- Prognose ------------------------------- */

  forecast: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const profile = await db.query.pensionProfiles.findFirst({
      where: eq(pensionProfiles.userId, ctx.user.id),
    });
    if (!profile) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          "Vorsorgeprofil fehlt — bitte zuerst das Geburtsdatum hinterlegen.",
      });
    }
    const [funds, pillar3Rows, ahvRow, salaryRows, deductionRows] =
      await Promise.all([
        db.query.pensionFunds.findMany({
          where: eq(pensionFunds.userId, ctx.user.id),
        }),
        db.query.pensionPillar3.findMany({
          where: eq(pensionPillar3.userId, ctx.user.id),
        }),
        db.query.pensionAhv.findFirst({
          where: eq(pensionAhv.userId, ctx.user.id),
        }),
        db.query.pensionSalaries.findMany({
          where: eq(pensionSalaries.userId, ctx.user.id),
        }),
        db.query.pensionDeductions.findMany({
          where: eq(pensionDeductions.userId, ctx.user.id),
        }),
      ]);

    // Aktuelles Netto aus der Lohn-Timeline (für die Ersatzrate)
    const gross = salaryForMonth(salaryRows, currentMonth());
    const currentNet = gross === null ? null : computeNet(gross, deductionRows);

    // 3a-Verknüpfungen: Sync-Saldo minus in Sparzielen verplanter Anteile
    const pillar3 = await Promise.all(
      pillar3Rows.map(async row => {
        let sync = null;
        if (row.accountId !== null) {
          try {
            sync = await pillar3AccountSync(db, ctx.user, row.accountId);
          } catch {
            sync = null; // ohne „view"-Recht: manueller Saldo zählt
          }
        }
        return {
          name: row.name,
          currentBalance: row.currentBalance,
          yearlyDeposit: row.yearlyDeposit,
          interestRateBp: row.interestRateBp,
          accountId: row.accountId,
          syncedBalance: sync?.syncedBalance ?? null,
          goalCommitment: sync?.goalCommitment ?? 0,
          goalNames: sync?.goalNames ?? [],
        };
      })
    );

    let calculator;
    try {
      calculator = getPensionCalculator(profile.country);
    } catch (err) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: err instanceof Error ? err.message : "Unbekanntes Land.",
      });
    }
    return calculator.forecast({
      birthDate: profile.birthDate,
      retirementAge: profile.retirementAge,
      funds,
      pillar3,
      ahv: ahvRow
        ? {
            contributionYears: ahvRow.contributionYears,
            expectedMonthlyPension: ahvRow.expectedMonthlyPension,
          }
        : null,
      currentNet,
    });
  }),

  /* ------------------------------ Historie ---------------------------------- */

  listChanges: authedQuery
    .input(
      z.object({
        entity: z.string().max(50).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db.query.pensionChanges.findMany({
        where: input.entity
          ? and(
              eq(pensionChanges.userId, ctx.user.id),
              eq(pensionChanges.entity, input.entity)
            )
          : eq(pensionChanges.userId, ctx.user.id),
        orderBy: (t, { desc: d }) => [d(t.createdAt), d(t.id)],
        limit: input.limit,
      });
      return rows.map(row => ({
        ...row,
        changes: JSON.parse(row.changes) as {
          field: string;
          from: string | number | null;
          to: string | number | null;
        }[],
      }));
    }),

  /* ------------------------------ Anhänge ---------------------------------- */

  /**
   * Listet die Anhänge (Metadaten) eines Vorsorge-Datensatzes. Die
   * Besitzprüfung greift über die user_id-Spalte der Anhänge selbst.
   */
  listAttachments: authedQuery
    .input(
      z.object({
        entityType: z.enum(["ahv", "fund", "pillar3"]),
        entityId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      return db.query.pensionAttachments.findMany({
        where: and(
          eq(pensionAttachments.userId, ctx.user.id),
          eq(pensionAttachments.entityType, input.entityType),
          eq(pensionAttachments.entityId, input.entityId)
        ),
        orderBy: (t, { desc: d }) => [d(t.createdAt), d(t.id)],
        columns: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      });
    }),

  /* --------------------------- Nettolohn übernehmen ------------------------- */

  /**
   * Übernimmt das aktuell berechnete Netto als monatliche wiederkehrende
   * Einnahme auf ein Konto (erfordert „edit"). Nächste Fälligkeit: der 1. des
   * Folgemonats.
   */
  transferNetSalary: authedQuery
    .input(
      z.object({
        accountId: z.number().int().positive(),
        categoryId: z.number().int().positive().optional(),
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
      if (input.categoryId !== undefined) {
        const cat = await db.query.categories.findFirst({
          where: eq(categories.id, input.categoryId),
        });
        if (!cat) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Die angegebene Kategorie existiert nicht.",
          });
        }
      }
      const [salaryRows, deductionRows] = await Promise.all([
        db.query.pensionSalaries.findMany({
          where: eq(pensionSalaries.userId, ctx.user.id),
        }),
        db.query.pensionDeductions.findMany({
          where: eq(pensionDeductions.userId, ctx.user.id),
        }),
      ]);
      const gross = salaryForMonth(salaryRows, currentMonth());
      if (gross === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Es ist kein Lohn hinterlegt — bitte zuerst einen Lohn erfassen.",
        });
      }
      const net = computeNet(gross, deductionRows);
      if (net <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Das berechnete Netto ist 0 oder negativ — bitte die Abzüge prüfen.",
        });
      }
      const nextDate = firstOfNextMonth();
      const inserted = await db
        .insert(recurring)
        .values({
          type: "income",
          accountId: input.accountId,
          amount: net,
          categoryId: input.categoryId ?? null,
          userId: ctx.user.id,
          note: "Nettolohn (Vorsorge)",
          interval: "monthly",
          nextDate,
          active: true,
          createdAt: new Date(),
        })
        .returning({ id: recurring.id });
      logAudit(
        db,
        ctx.user.id,
        "pension.salary.transferred",
        "pension",
        inserted[0].id,
        `Nettolohn ${auditAmount(net)} → Konto „${account.name}“, monatlich ab ${nextDate}`
      );
      return { id: inserted[0].id, amount: net, nextDate };
    }),
});
