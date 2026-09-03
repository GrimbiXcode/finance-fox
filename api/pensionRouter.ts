import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  accounts,
  categories,
  pensionAhv,
  pensionAhvYears,
  pensionAttachments,
  pensionChanges,
  pensionDeductions,
  pensionFunds,
  pensionFundTiers,
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
import {
  computeNet,
  deductionsForSalary,
  salaryEntryForMonth,
} from "./lib/pension/netSalary";
import { pillar3AccountSync } from "./lib/pension/accountSync";
import { getPensionCalculator } from "./lib/pension";
import { computeAhv, computeAhvVariants } from "./lib/pension/ahvCh";
import {
  ahvMonthlyPensionFor,
  findAhvYear,
  loadAhvInput,
} from "./lib/pension/ahvLoad";
import { users } from "@db/schema";

/**
 * Vorsorge-Modul (Schweizer 3-Säulen-Prinzip) — alle Daten sind strikt
 * privat: jeder Endpunkt ist auf ctx.user.id gescoped, es gibt keine
 * Haushalts-Sichtbarkeit. Jede Mutation schreibt bei echter Änderung einen
 * Eintrag in pension_changes (recordPensionChange) und best effort ins
 * Audit-Log (ohne sensible Werte wie die AHV-Nummer).
 *
 * **Eine einzige Ausnahme** vom userId-Scoping: die Ehepartner-Verknüpfung
 * (`setPartner`) für Plafonierung und Einkommensteilung. Sie wirkt nur bei
 * **gegenseitigem** Eintrag und liest ausschliesslich die dafür nötigen
 * Werte — Details in `lib/pension/ahvLoad.ts`.
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
  deductions: "Abzüge",
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
  firstIkYear: "Erstes IK-Jahr",
  gender: "Geschlecht",
  civilStatus: "Zivilstand",
  marriedFromYear: "Verheiratet seit",
  marriedUntilYear: "Verheiratet bis",
  withdrawalMode: "Rentenbezug",
  withdrawalMonths: "Monate Vorbezug/Aufschub",
  withdrawalSharePct: "Bezogener Anteil (%)",
  notes: "Notizen",
};
const AHV_YEAR_LABELS = {
  year: "Jahr",
  income: "Erwerbseinkommen",
  status: "Status",
  parentingCredit: "Erziehungsgutschrift",
  careCredit: "Betreuungsgutschrift",
  note: "Notiz",
};
const FUND_LABELS = {
  name: "Name",
  kind: "Art",
  currentCapital: "Guthaben",
  yearlySavings: "Jährliches Sparen",
  interestRateBp: "Zinssatz (Bp)",
  conversionRateBp: "Umwandlungssatz (Bp)",
  notes: "Notizen",
  employer: "Arbeitgeber",
  insuredSalary: "Versicherter Jahreslohn",
  coordinationDeduction: "Koordinationsabzug",
  buyInPotential: "Einkaufspotenzial",
  disabilityPension: "Invalidenrente/Jahr",
  deathBenefit: "Todesfallkapital",
  valueDate: "Stichtag der Angaben",
  tiers: "Abstufungen",
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

/** Sparbeitrags-Abstufung nach Alter (AN/AG-Sätze in Basispunkten) */
const tierInput = z.object({
  ageFrom: z.number().int().min(18).max(75),
  employeeRateBp: z.number().int().min(0).max(10000),
  employerRateBp: z.number().int().min(0).max(10000),
});
type TierInput = z.infer<typeof tierInput>;

/** Optionale Cent-Beträge des Versicherungsausweises (null = entfernen) */
const nullableAmount = z.number().int().min(0).nullable().optional();

/** Duplikate bei ageFrom sind nicht sinnvoll — pro Alter genau eine Stufe */
function assertTiers(tiers: TierInput[]) {
  if (new Set(tiers.map(t => t.ageFrom)).size !== tiers.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Pro Alter nur eine Stufe.",
    });
  }
}

/** Lesbare Kurzform der Abstufungen für die Änderungshistorie (AN/AG in %) */
function tiersToText(
  tiers: { ageFrom: number; employeeRateBp: number; employerRateBp: number }[]
): string | null {
  if (tiers.length === 0) return null;
  const pct = (bp: number) => (bp / 100).toFixed(2);
  return [...tiers]
    .sort((a, b) => a.ageFrom - b.ageFrom)
    .map(
      t =>
        `ab ${t.ageFrom}: ${pct(t.employeeRateBp)} %/${pct(t.employerRateBp)} %`
    )
    .join(" · ");
}

/** Eintragsbezogener Abzug eines Lohns (Validierung wie addDeduction) */
const salaryDeductionInput = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein."),
  mode: z.enum(["percent", "absolute"]),
  value: z.number().int(),
  active: z.boolean().default(true),
});
type SalaryDeductionInput = z.infer<typeof salaryDeductionInput>;

/**
 * Lesbare Kurzform der Abzüge eines Lohneintrags für die Änderungshistorie
 * (Prozent aus Basispunkten, absolute Beträge aus Cent — je 2 Dezimalstellen).
 */
function deductionsToText(
  deductions: { name: string; mode: "percent" | "absolute"; value: number }[]
): string | null {
  if (deductions.length === 0) return null;
  const fmt = (v: number) => (v / 100).toFixed(2).replace(".", ",");
  return deductions
    .map(d =>
      d.mode === "percent"
        ? `${d.name} ${fmt(d.value)} %`
        : `${d.name} ${fmt(d.value)}`
    )
    .join(" · ");
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

/** Werte eintragsbezogener Abzüge validieren (Regeln wie addDeduction) */
function assertSalaryDeductions(deductions: SalaryDeductionInput[]) {
  for (const d of deductions) assertDeductionValue(d.mode, d.value);
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
    const rows = await db.query.pensionSalaries.findMany({
      where: eq(pensionSalaries.userId, ctx.user.id),
      orderBy: (t, { asc }) => [asc(t.validFrom)],
    });
    // Eintragsbezogene Abzüge gebatcht laden und anhängen
    const ids = rows.map(r => r.id);
    const deductionRows = ids.length
      ? await db.query.pensionDeductions.findMany({
          where: and(
            eq(pensionDeductions.userId, ctx.user.id),
            inArray(pensionDeductions.salaryId, ids)
          ),
          orderBy: (t, { asc }) => [asc(t.id)],
        })
      : [];
    return rows.map(row => ({
      ...row,
      deductions: deductionRows
        .filter(d => d.salaryId === row.id)
        .map(d => ({
          id: d.id,
          name: d.name,
          mode: d.mode,
          value: d.value,
          active: d.active,
        })),
    }));
  }),

  addSalary: authedQuery
    .input(
      z.object({
        validFrom: isoMonth,
        grossMonthly: z.number().int().positive(),
        note: z.string().max(500).default(""),
        // Abzüge nur für diesen Lohneintrag (globale gelten zusätzlich)
        deductions: z.array(salaryDeductionInput).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertSalaryDeductions(input.deductions ?? []);
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
      const salaryId = inserted[0].id;
      for (const d of input.deductions ?? []) {
        await db.insert(pensionDeductions).values({
          userId: ctx.user.id,
          salaryId,
          name: d.name,
          mode: d.mode,
          value: d.value,
          active: d.active,
          createdAt: new Date(),
        });
      }
      const summary = `Lohn ab ${input.validFrom}: ${input.grossMonthly}`;
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "salary",
        entityId: salaryId,
        comment: input.comment,
        before: null,
        after: {
          validFrom: input.validFrom,
          grossMonthly: input.grossMonthly,
          note: input.note,
          deductions: deductionsToText(input.deductions ?? []),
        },
        fieldLabels: SALARY_LABELS,
      });
      logAudit(
        db,
        ctx.user.id,
        "pension.salary.created",
        "pension",
        salaryId,
        summary
      );
      return { id: salaryId };
    }),

  updateSalary: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        validFrom: isoMonth.optional(),
        grossMonthly: z.number().int().positive().optional(),
        note: z.string().max(500).optional(),
        // Eintragsbezogene Abzüge: mitgegeben = ersetzen, weggelassen =
        // unverändert, leere Liste = alle des Eintrags löschen
        deductions: z.array(salaryDeductionInput).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertSalaryDeductions(input.deductions ?? []);
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
      const oldDeductions = await db.query.pensionDeductions.findMany({
        where: and(
          eq(pensionDeductions.salaryId, row.id),
          eq(pensionDeductions.userId, ctx.user.id)
        ),
        orderBy: (t, { asc }) => [asc(t.id)],
      });
      const newDeductions = input.deductions ?? oldDeductions;
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "salary",
        entityId: row.id,
        comment: input.comment,
        before: {
          validFrom: row.validFrom,
          grossMonthly: row.grossMonthly,
          note: row.note,
          deductions: deductionsToText(oldDeductions),
        },
        after: { ...next, deductions: deductionsToText(newDeductions) },
        fieldLabels: SALARY_LABELS,
      });
      // Abzüge: Ersetzen-Semantik (nur wenn mitgegeben)
      if (input.deductions !== undefined) {
        await db
          .delete(pensionDeductions)
          .where(
            and(
              eq(pensionDeductions.salaryId, row.id),
              eq(pensionDeductions.userId, ctx.user.id)
            )
          );
        for (const d of input.deductions) {
          await db.insert(pensionDeductions).values({
            userId: ctx.user.id,
            salaryId: row.id,
            name: d.name,
            mode: d.mode,
            value: d.value,
            active: d.active,
            createdAt: new Date(),
          });
        }
      }
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
      const salaryDeductions = await db.query.pensionDeductions.findMany({
        where: and(
          eq(pensionDeductions.salaryId, row.id),
          eq(pensionDeductions.userId, ctx.user.id)
        ),
        orderBy: (t, { asc }) => [asc(t.id)],
      });
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "salary",
        entityId: row.id,
        comment: input.comment,
        before: {
          validFrom: row.validFrom,
          grossMonthly: row.grossMonthly,
          note: row.note,
          deductions: deductionsToText(salaryDeductions),
        },
        after: null,
        fieldLabels: SALARY_LABELS,
      });
      // Kaskade: eintragsbezogene Abzüge mitlöschen (globale bleiben)
      await db
        .delete(pensionDeductions)
        .where(
          and(
            eq(pensionDeductions.salaryId, row.id),
            eq(pensionDeductions.userId, ctx.user.id)
          )
        );
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
        firstIkYear: z.number().int().min(1930).max(2100).nullable().optional(),
        gender: z.enum(["female", "male"]).nullable().optional(),
        civilStatus: z
          .enum(["single", "married", "divorced", "widowed"])
          .optional(),
        marriedFromYear: z
          .number()
          .int()
          .min(1930)
          .max(2100)
          .nullable()
          .optional(),
        marriedUntilYear: z
          .number()
          .int()
          .min(1930)
          .max(2100)
          .nullable()
          .optional(),
        withdrawalMode: z.enum(["none", "early", "deferral"]).optional(),
        withdrawalMonths: z.number().int().min(0).max(60).optional(),
        // 100 = ganze Rente; ein Teilbezug liegt zwischen 20 und 80 %
        withdrawalSharePct: z.number().int().min(20).max(100).optional(),
        notes: z.string().max(2000).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.pensionAhv.findFirst({
        where: eq(pensionAhv.userId, ctx.user.id),
      });

      /** Feldwerte für Historie und UPDATE — undefined = unverändert */
      const merge = (base: Partial<typeof pensionAhv.$inferSelect> | null) => ({
        ahvNumber: input.ahvNumber ?? base?.ahvNumber ?? null,
        contributionYears:
          input.contributionYears === undefined
            ? (base?.contributionYears ?? null)
            : input.contributionYears,
        expectedMonthlyPension:
          input.expectedMonthlyPension === undefined
            ? (base?.expectedMonthlyPension ?? null)
            : input.expectedMonthlyPension,
        firstIkYear:
          input.firstIkYear === undefined
            ? (base?.firstIkYear ?? null)
            : input.firstIkYear,
        gender:
          input.gender === undefined ? (base?.gender ?? null) : input.gender,
        civilStatus: input.civilStatus ?? base?.civilStatus ?? "single",
        marriedFromYear:
          input.marriedFromYear === undefined
            ? (base?.marriedFromYear ?? null)
            : input.marriedFromYear,
        marriedUntilYear:
          input.marriedUntilYear === undefined
            ? (base?.marriedUntilYear ?? null)
            : input.marriedUntilYear,
        withdrawalMode: input.withdrawalMode ?? base?.withdrawalMode ?? "none",
        withdrawalMonths:
          input.withdrawalMonths ?? base?.withdrawalMonths ?? 0,
        withdrawalSharePct:
          input.withdrawalSharePct ?? base?.withdrawalSharePct ?? 100,
        notes: input.notes ?? base?.notes ?? "",
      });

      // Audit-Detail bewusst ohne AHV-Nummer (sensibler Wert)
      if (!existing) {
        const values = merge(null);
        const inserted = await db
          .insert(pensionAhv)
          .values({ userId: ctx.user.id, ...values })
          .returning({ id: pensionAhv.id });
        await recordPensionChange(db, {
          userId: ctx.user.id,
          entity: "ahv",
          entityId: inserted[0].id,
          comment: input.comment,
          before: null,
          after: values,
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

      const next = merge(existing);
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "ahv",
        entityId: existing.id,
        comment: input.comment,
        before: {
          ahvNumber: existing.ahvNumber,
          contributionYears: existing.contributionYears,
          expectedMonthlyPension: existing.expectedMonthlyPension,
          firstIkYear: existing.firstIkYear,
          gender: existing.gender,
          civilStatus: existing.civilStatus,
          marriedFromYear: existing.marriedFromYear,
          marriedUntilYear: existing.marriedUntilYear,
          withdrawalMode: existing.withdrawalMode,
          withdrawalMonths: existing.withdrawalMonths,
          withdrawalSharePct: existing.withdrawalSharePct,
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

  /* ------------------- Beitragsdauer: Jahreszeilen (IK) --------------------- */

  listAhvYears: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(pensionAhvYears)
      .where(eq(pensionAhvYears.userId, ctx.user.id));
    return rows.sort((a, b) => a.year - b.year);
  }),

  /**
   * Anlegen oder Ändern einer Jahreszeile (Ersetzen-Semantik pro Jahr —
   * ein Kalenderjahr kommt im individuellen Konto genau einmal vor).
   */
  upsertAhvYear: authedQuery
    .input(
      z.object({
        year: z.number().int().min(1930).max(2100),
        income: z.number().int().min(0).default(0),
        status: z
          .enum(["employed", "non_employed", "gap", "youth"])
          .default("employed"),
        parentingCredit: z.enum(["none", "full", "half"]).default("none"),
        careCredit: z.enum(["none", "full", "half"]).default("none"),
        note: z.string().max(500).default(""),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { comment, ...values } = input;
      const existing = await findAhvYear(db, ctx.user.id, input.year);

      if (!existing) {
        const inserted = await db
          .insert(pensionAhvYears)
          .values({ userId: ctx.user.id, ...values })
          .returning({ id: pensionAhvYears.id });
        await recordPensionChange(db, {
          userId: ctx.user.id,
          entity: "ahv",
          entityId: inserted[0].id,
          comment,
          before: null,
          after: values,
          fieldLabels: AHV_YEAR_LABELS,
          summary: `Beitragsjahr ${input.year} erfasst`,
        });
        logAudit(
          db,
          ctx.user.id,
          "pension.ahvYear.created",
          "pension",
          inserted[0].id,
          `Beitragsjahr ${input.year} erfasst`
        );
        return { id: inserted[0].id };
      }

      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "ahv",
        entityId: existing.id,
        comment,
        before: {
          year: existing.year,
          income: existing.income,
          status: existing.status,
          parentingCredit: existing.parentingCredit,
          careCredit: existing.careCredit,
          note: existing.note,
        },
        after: values,
        fieldLabels: AHV_YEAR_LABELS,
      });
      if (changed > 0) {
        await db
          .update(pensionAhvYears)
          .set(values)
          .where(eq(pensionAhvYears.id, existing.id));
        logAudit(
          db,
          ctx.user.id,
          "pension.ahvYear.updated",
          "pension",
          existing.id,
          `Beitragsjahr ${input.year} geändert`
        );
      }
      return { id: existing.id };
    }),

  deleteAhvYear: authedQuery
    .input(z.object({ year: z.number().int().min(1930).max(2100) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await findAhvYear(db, ctx.user.id, input.year);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Beitragsjahr nicht gefunden.",
        });
      }
      await db
        .delete(pensionAhvYears)
        .where(eq(pensionAhvYears.id, existing.id));
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "ahv",
        entityId: existing.id,
        before: { year: existing.year, income: existing.income },
        after: null,
        fieldLabels: AHV_YEAR_LABELS,
        summary: `Beitragsjahr ${input.year} gelöscht`,
      });
      logAudit(
        db,
        ctx.user.id,
        "pension.ahvYear.deleted",
        "pension",
        existing.id,
        `Beitragsjahr ${input.year} gelöscht`
      );
      return { ok: true };
    }),

  /* --------------------- Ehepartner-Verknüpfung ---------------------------- */

  /**
   * Setzt oder löst den Verweis auf den Ehepartner. Wirksam wird er **erst,
   * wenn die andere Person ihn erwidert** — bis dahin werden keine fremden
   * Vorsorgedaten gelesen. Das ist bewusst die einzige Zustimmung im Modul
   * und ersetzt ein eigenes Freigabe-Konzept.
   */
  setPartner: authedQuery
    .input(z.object({ partnerUserId: z.number().int().positive().nullable() }))
    .mutation(async ({ ctx, input }) => {
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
      if (input.partnerUserId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Du kannst dich nicht mit dir selbst verknüpfen.",
        });
      }
      if (input.partnerUserId !== null) {
        const partner = await db.query.users.findFirst({
          where: eq(users.id, input.partnerUserId),
        });
        if (!partner || !partner.active) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Person nicht gefunden.",
          });
        }
      }
      await db
        .update(pensionProfiles)
        .set({ partnerUserId: input.partnerUserId })
        .where(eq(pensionProfiles.id, profile.id));
      logAudit(
        db,
        ctx.user.id,
        input.partnerUserId === null
          ? "pension.partner.unlinked"
          : "pension.partner.linked",
        "pension",
        profile.id,
        input.partnerUserId === null
          ? "Ehepartner-Verknüpfung gelöst"
          : "Ehepartner-Verknüpfung gesetzt"
      );
      return { ok: true };
    }),

  /* ------------------------ AHV-Rentenberechnung --------------------------- */

  /**
   * Die Rentenberechnung nach Merkblatt 3.01 — mit Aufschlüsselung, damit
   * im UI nachvollziehbar bleibt, woher die Zahl kommt. Der Rentenbezug
   * lässt sich als Was-wäre-wenn übersteuern (Muster: `retirementAge` in
   * `forecast`).
   */
  ahvDetail: authedQuery
    .input(
      z
        .object({
          withdrawalMode: z.enum(["none", "early", "deferral"]).optional(),
          withdrawalMonths: z.number().int().min(0).max(60).optional(),
          withdrawalSharePct: z.number().int().min(20).max(100).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const loaded = await loadAhvInput(
        db,
        ctx.user.id,
        input?.withdrawalMode
          ? {
              withdrawal: {
                mode: input.withdrawalMode,
                months: input.withdrawalMonths ?? 0,
                sharePct: input.withdrawalSharePct ?? 100,
              },
            }
          : undefined
      );
      if (!loaded) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Vorsorgeprofil fehlt — bitte zuerst das Geburtsdatum hinterlegen.",
        });
      }
      return {
        ...computeAhv(loaded.input),
        partnerLinked: loaded.partnerLinked,
        partnerPending: loaded.partnerPending,
      };
    }),

  /** Gegenüberstellung der Bezugsvarianten (Vorbezug … Aufschub) */
  ahvVariants: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const loaded = await loadAhvInput(db, ctx.user.id);
    if (!loaded) return [];
    return computeAhvVariants(loaded.input);
  }),

  /* --------------------------- Säule 2 (Pensionskasse) ---------------------- */

  listFunds: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.query.pensionFunds.findMany({
      where: eq(pensionFunds.userId, ctx.user.id),
      orderBy: (t, { asc }) => [asc(t.id)],
    });
    // Abstufungen gebatcht laden und aufsteigend nach Alter anhängen
    const ids = rows.map(r => r.id);
    const tierRows = ids.length
      ? await db.query.pensionFundTiers.findMany({
          where: inArray(pensionFundTiers.fundId, ids),
          orderBy: (t, { asc }) => [asc(t.ageFrom)],
        })
      : [];
    return rows.map(row => ({
      ...row,
      tiers: tierRows
        .filter(t => t.fundId === row.id)
        .map(t => ({
          ageFrom: t.ageFrom,
          employeeRateBp: t.employeeRateBp,
          employerRateBp: t.employerRateBp,
        })),
    }));
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
        employer: z.string().trim().max(200).nullable().optional(),
        insuredSalary: nullableAmount,
        coordinationDeduction: nullableAmount,
        buyInPotential: nullableAmount,
        disabilityPension: nullableAmount,
        deathBenefit: nullableAmount,
        // Stichtag der Angaben (YYYY-MM-DD) — Prognose akkumuliert ab diesem Datum
        valueDate: isoDate.nullable().optional(),
        tiers: z.array(tierInput).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertTiers(input.tiers ?? []);
      const db = getDb();
      const { comment, tiers, ...rest } = input;
      const values = {
        ...rest,
        employer: rest.employer ?? null,
        insuredSalary: rest.insuredSalary ?? null,
        coordinationDeduction: rest.coordinationDeduction ?? null,
        buyInPotential: rest.buyInPotential ?? null,
        disabilityPension: rest.disabilityPension ?? null,
        deathBenefit: rest.deathBenefit ?? null,
        valueDate: rest.valueDate ?? null,
      };
      const inserted = await db
        .insert(pensionFunds)
        .values({ userId: ctx.user.id, ...values })
        .returning({ id: pensionFunds.id });
      const fundId = inserted[0].id;
      for (const tier of [...(tiers ?? [])].sort(
        (a, b) => a.ageFrom - b.ageFrom
      )) {
        await db.insert(pensionFundTiers).values({
          fundId,
          ageFrom: tier.ageFrom,
          employeeRateBp: tier.employeeRateBp,
          employerRateBp: tier.employerRateBp,
          createdAt: new Date(),
        });
      }
      await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "fund",
        entityId: fundId,
        comment,
        before: null,
        after: { ...values, tiers: tiersToText(tiers ?? []) },
        fieldLabels: FUND_LABELS,
        format: formatFundField,
        summary: `Vorsorgekonto „${input.name}“`,
      });
      logAudit(
        db,
        ctx.user.id,
        "pension.fund.created",
        "pension",
        fundId,
        `Vorsorgekonto „${input.name}“`
      );
      return { id: fundId };
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
        // Versicherungsausweis-Felder: undefined = unverändert, null = entfernen
        employer: z.string().trim().max(200).nullable().optional(),
        insuredSalary: nullableAmount,
        coordinationDeduction: nullableAmount,
        buyInPotential: nullableAmount,
        disabilityPension: nullableAmount,
        deathBenefit: nullableAmount,
        valueDate: isoDate.nullable().optional(),
        // Abstufungen: mitgegeben = ersetzen, weggelassen = unverändert
        tiers: z.array(tierInput).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertTiers(input.tiers ?? []);
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
        employer: input.employer === undefined ? row.employer : input.employer,
        insuredSalary:
          input.insuredSalary === undefined
            ? row.insuredSalary
            : input.insuredSalary,
        coordinationDeduction:
          input.coordinationDeduction === undefined
            ? row.coordinationDeduction
            : input.coordinationDeduction,
        buyInPotential:
          input.buyInPotential === undefined
            ? row.buyInPotential
            : input.buyInPotential,
        disabilityPension:
          input.disabilityPension === undefined
            ? row.disabilityPension
            : input.disabilityPension,
        deathBenefit:
          input.deathBenefit === undefined
            ? row.deathBenefit
            : input.deathBenefit,
        valueDate:
          input.valueDate === undefined ? row.valueDate : input.valueDate,
      };
      // Abstufungen: Ersetzen-Semantik (nur wenn mitgegeben)
      const oldTiers = await db.query.pensionFundTiers.findMany({
        where: eq(pensionFundTiers.fundId, row.id),
        orderBy: (t, { asc }) => [asc(t.ageFrom)],
      });
      const newTiers = input.tiers ?? oldTiers;
      const before = {
        name: row.name,
        kind: row.kind,
        currentCapital: row.currentCapital,
        yearlySavings: row.yearlySavings,
        interestRateBp: row.interestRateBp,
        conversionRateBp: row.conversionRateBp,
        notes: row.notes,
        employer: row.employer,
        insuredSalary: row.insuredSalary,
        coordinationDeduction: row.coordinationDeduction,
        buyInPotential: row.buyInPotential,
        disabilityPension: row.disabilityPension,
        deathBenefit: row.deathBenefit,
        valueDate: row.valueDate,
        tiers: tiersToText(oldTiers),
      };
      const changed = await recordPensionChange(db, {
        userId: ctx.user.id,
        entity: "fund",
        entityId: row.id,
        comment: input.comment,
        before,
        after: { ...next, tiers: tiersToText(newTiers) },
        fieldLabels: FUND_LABELS,
        format: formatFundField,
      });
      if (input.tiers !== undefined) {
        await db
          .delete(pensionFundTiers)
          .where(eq(pensionFundTiers.fundId, row.id));
        for (const tier of [...input.tiers].sort(
          (a, b) => a.ageFrom - b.ageFrom
        )) {
          await db.insert(pensionFundTiers).values({
            fundId: row.id,
            ageFrom: tier.ageFrom,
            employeeRateBp: tier.employeeRateBp,
            employerRateBp: tier.employerRateBp,
            createdAt: new Date(),
          });
        }
      }
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
      // Kaskade: Abstufungen der Kasse mitlöschen
      await db
        .delete(pensionFundTiers)
        .where(eq(pensionFundTiers.fundId, row.id));
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

  forecast: authedQuery
    .input(
      z
        .object({
          // Hypothetisches Rentenalter für Was-wäre-wenn-Rechnungen in der
          // Übersicht (Default: das im Profil hinterlegte)
          retirementAge: z.number().int().min(50).max(75).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
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
      // Die AHV lädt und rechnet ahvMonthlyPensionFor selbst (Merkblatt-
      // Rentenformel), deshalb steht pension_ahv hier nicht mehr dabei.
      const [funds, pillar3Rows, salaryRows, deductionRows] =
        await Promise.all([
          db.query.pensionFunds.findMany({
            where: eq(pensionFunds.userId, ctx.user.id),
          }),
          db.query.pensionPillar3.findMany({
            where: eq(pensionPillar3.userId, ctx.user.id),
          }),
          db.query.pensionSalaries.findMany({
            where: eq(pensionSalaries.userId, ctx.user.id),
          }),
          db.query.pensionDeductions.findMany({
            where: eq(pensionDeductions.userId, ctx.user.id),
          }),
        ]);

      // Abstufungen der eigenen Kassen (rateBp = AN+AG vorsummiert fürs Modell)
      const fundIds = funds.map(f => f.id);
      const tierRows = fundIds.length
        ? await db.query.pensionFundTiers.findMany({
            where: inArray(pensionFundTiers.fundId, fundIds),
            orderBy: (t, { asc }) => [asc(t.ageFrom)],
          })
        : [];
      const fundInputs = funds.map(f => ({
        kind: f.kind,
        name: f.name,
        currentCapital: f.currentCapital,
        yearlySavings: f.yearlySavings,
        interestRateBp: f.interestRateBp,
        conversionRateBp: f.conversionRateBp,
        insuredSalary: f.insuredSalary,
        valueDate: f.valueDate,
        tiers: tierRows
          .filter(t => t.fundId === f.id)
          .map(t => ({
            ageFrom: t.ageFrom,
            rateBp: t.employeeRateBp + t.employerRateBp,
          })),
      }));

      // Aktuelles Netto aus der Lohn-Timeline (für die Ersatzrate) —
      // globale Abzüge plus die Abzüge des gültigen Lohneintrags
      const currentSalary = salaryEntryForMonth(salaryRows, currentMonth());
      const currentNet =
        currentSalary === null
          ? null
          : computeNet(
              currentSalary.grossMonthly,
              deductionsForSalary(deductionRows, currentSalary.id)
            );

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
        retirementAge: input?.retirementAge ?? profile.retirementAge,
        funds: fundInputs,
        pillar3,
        // Erste Säule aus der eigenen Engine (Merkblatt-Rentenformel);
        // eine hinterlegte amtliche Vorausberechnung hat Vorrang.
        ahv: await ahvMonthlyPensionFor(db, ctx.user.id),
        currentNet,
      });
    }),

  /* ------------------------------ Historie ---------------------------------- */

  listChanges: authedQuery
    .input(
      z.object({
        entity: z.string().max(50).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        // Offset-Cursor für die Pagination („Mehr laden" im UI)
        cursor: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const where = input.entity
        ? and(
            eq(pensionChanges.userId, ctx.user.id),
            eq(pensionChanges.entity, input.entity)
          )
        : eq(pensionChanges.userId, ctx.user.id);
      const [rows, countRow] = await Promise.all([
        db.query.pensionChanges.findMany({
          where,
          orderBy: (t, { desc: d }) => [d(t.createdAt), d(t.id)],
          limit: input.limit,
          offset: input.cursor,
        }),
        db
          .select({ total: sql<number>`count(*)` })
          .from(pensionChanges)
          .where(where),
      ]);
      const total = countRow[0]?.total ?? 0;
      const nextCursor =
        input.cursor + rows.length < total ? input.cursor + rows.length : null;
      return {
        entries: rows.map(row => ({
          ...row,
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
      const currentSalary = salaryEntryForMonth(salaryRows, currentMonth());
      if (currentSalary === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Es ist kein Lohn hinterlegt — bitte zuerst einen Lohn erfassen.",
        });
      }
      const net = computeNet(
        currentSalary.grossMonthly,
        deductionsForSalary(deductionRows, currentSalary.id)
      );
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
