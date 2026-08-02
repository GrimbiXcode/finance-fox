import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  accounts,
  insuranceAttachments,
  insuranceChanges,
  insuranceCoverages,
  insuranceGapDismissals,
  insurancePolicies,
  insurancePolicyPersons,
  properties,
  recurring,
  users,
} from "@db/schema";
import { MONTHS_PER_INTERVAL, RECURRING_INTERVALS } from "@contracts/types";
import {
  INSURANCE_BRANCH_KEYS,
  INSURANCE_BRANCH_LABELS,
  INSURANCE_RENEWALS,
  INSURANCE_STATUS,
  INSURANCE_STATUS_LABELS,
  type InsuranceBranch,
} from "@contracts/insurance";
import { requireAccountAccess } from "./lib/accountAccess";
import { auditAmount, logAudit } from "./lib/audit";
import { recordInsuranceChange } from "./lib/insurance/history";
import { getInsuranceRules } from "./lib/insurance";
import { computeNotice } from "./lib/insurance/notice";
import { deleteInsuranceAttachmentsFor } from "./lib/attachments";
import { localISO } from "./lib/recurringSchedule";
import type { FieldValue } from "./lib/changeHistory";
import type { GapPolicy } from "./lib/insurance/gaps";

/**
 * Versicherungs-Modul — wie die Hypotheken **haushaltsweit**: kein
 * user_id-Scoping, jedes Mitglied sieht und bearbeitet die Policen des
 * Haushalts. Die Verknüpfung zu Personen sagt nur, **wer versichert ist**.
 * Verknüpfte Finanz-Konten werden weiterhin über die Konto-Rechte geprüft.
 *
 * Jede Mutation schreibt bei echter Änderung einen Eintrag in
 * insurance_changes und best effort ins Audit-Log.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");
const commentInput = z.string().max(500).optional();
/** Wöchentliche Prämien gibt es fachlich nicht */
type PremiumInterval = Exclude<
  (typeof RECURRING_INTERVALS)[number],
  "weekly"
>;
const premiumInterval = z.enum(
  RECURRING_INTERVALS.filter(i => i !== "weekly") as [
    PremiumInterval,
    ...PremiumInterval[],
  ]
);
const branchInput = z.enum(INSURANCE_BRANCH_KEYS);
const statusInput = z.enum(INSURANCE_STATUS);
const renewalInput = z.enum(INSURANCE_RENEWALS);
const centInput = z.number().int().min(0);

/* --------------------------- Historien-Labels ------------------------------ */

const POLICY_LABELS: Record<string, string> = {
  name: "Name",
  branch: "Sparte",
  insurer: "Versicherer",
  policyNumber: "Policennummer",
  status: "Status",
  premium: "Prämie",
  premiumInterval: "Zahlungsintervall",
  deductible: "Selbstbehalt",
  startDate: "Vertragsbeginn",
  renewal: "Verlängerung",
  mainDueDate: "Hauptverfall",
  endDate: "Vertragsende",
  noticePeriodMonths: "Kündigungsfrist (Monate)",
  accountId: "Belastungskonto",
  persons: "Versicherte Personen",
  notes: "Notizen",
};

const COVERAGE_LABELS: Record<string, string> = {
  label: "Bezeichnung",
  sumInsured: "Deckungssumme",
  deductible: "Selbstbehalt",
  notes: "Notiz",
};

const RENEWAL_LABELS: Record<string, string> = {
  auto: "verlängert sich automatisch",
  fixed: "befristet",
};

const INTERVAL_LABELS: Record<string, string> = {
  monthly: "monatlich",
  quarterly: "vierteljährlich",
  semiannual: "halbjährlich",
  yearly: "jährlich",
};

/** Enum-Werte im Verlauf lesbar machen (Beträge bleiben roh in Cent) */
function formatPolicyField(
  field: string,
  value: FieldValue
): string | number | null {
  if (value === null) return null;
  if (field === "branch")
    return INSURANCE_BRANCH_LABELS[value as InsuranceBranch] ?? String(value);
  if (field === "status")
    return INSURANCE_STATUS_LABELS[value as never] ?? String(value);
  if (field === "renewal") return RENEWAL_LABELS[String(value)] ?? String(value);
  if (field === "premiumInterval")
    return INTERVAL_LABELS[String(value)] ?? String(value);
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
}

/**
 * Wie formatPolicyField, aber `sumInsured: null` heißt **unbegrenzt** und
 * nicht „nicht gesetzt" — sonst schriebe der Diff beim Wechsel ein
 * irreführendes „→ —".
 */
function formatCoverageField(
  field: string,
  value: FieldValue
): string | number | null {
  if (field === "sumInsured" && value === null) return "unbegrenzt";
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "ja" : "nein";
  return value;
}

/* ------------------------------- Helfer ------------------------------------ */

/** Police laden oder NOT_FOUND werfen */
async function loadPolicy(id: number) {
  const row = await getDb().query.insurancePolicies.findFirst({
    where: eq(insurancePolicies.id, id),
  });
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Police nicht gefunden." });
  }
  return row;
}

/** Deckung laden oder NOT_FOUND werfen */
async function loadCoverage(id: number) {
  const row = await getDb().query.insuranceCoverages.findFirst({
    where: eq(insuranceCoverages.id, id),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Deckung nicht gefunden.",
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

/** Wöchentliche Prämien gibt es fachlich nicht — defensiv auf monthly */
function asPremiumInterval(interval: string): PremiumInterval {
  return interval === "weekly" ? "monthly" : (interval as PremiumInterval);
}

/** Prämie auf einen Monatswert normalisieren (Cent) */
function premiumPerMonth(premium: number, interval: string): number {
  return Math.round(premium / MONTHS_PER_INTERVAL[asPremiumInterval(interval)]);
}

/** Prämie auf einen Jahreswert normalisieren (Cent) */
function premiumPerYear(premium: number, interval: string): number {
  return Math.round(
    (premium * 12) / MONTHS_PER_INTERVAL[asPremiumInterval(interval)]
  );
}

/** Erster Tag des Folgemonats als YYYY-MM-DD (wie transferInterestToRecurring) */
function firstOfNextMonth(): string {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Selbstheilende Prüfung des Rückverweises auf eine Dauerbuchung */
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

/** Versicherte Personen einer Police (leer = gemeinsam) */
async function personIdsOf(policyId: number): Promise<number[]> {
  const rows = await getDb()
    .select({ userId: insurancePolicyPersons.userId })
    .from(insurancePolicyPersons)
    .where(eq(insurancePolicyPersons.policyId, policyId));
  return rows.map(r => r.userId).sort((a, b) => a - b);
}

/** Namensliste für die Historie („Anna, Ben"; leer = „Gemeinsam") */
function personsToText(
  ids: number[],
  names: Map<number, string>
): string {
  if (ids.length === 0) return "Gemeinsam";
  return ids
    .map(id => names.get(id) ?? `#${id}`)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

/** Prüft, dass alle IDs zu existierenden Benutzern gehören */
async function assertKnownUsers(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, ids));
  if (rows.length !== new Set(ids).size) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Mindestens eine versicherte Person existiert nicht.",
    });
  }
}

/** Ersetzt die Personen-Zuordnung einer Police */
async function setPolicyPersons(
  policyId: number,
  ids: number[]
): Promise<void> {
  const db = getDb();
  await db
    .delete(insurancePolicyPersons)
    .where(eq(insurancePolicyPersons.policyId, policyId));
  const unique = [...new Set(ids)];
  if (unique.length > 0) {
    await db
      .insert(insurancePolicyPersons)
      .values(unique.map(userId => ({ policyId, userId })));
  }
}

/** Fachliche Prüfung der Vertragsdaten */
function assertDateOrder(startDate: string, endDate: string | null): void {
  if (endDate !== null && endDate < startDate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Das Vertragsende darf nicht vor dem Beginn liegen.",
    });
  }
}

/** Eingabe der Lückenanalyse aus der DB zusammenstellen */
async function gapInputFor(dismissedKeys: string[]) {
  const db = getDb();
  const [policyRows, coverageRows, personRows, userRows, propertyRows] =
    await Promise.all([
      db.select().from(insurancePolicies),
      db
        .select({ policyId: insuranceCoverages.policyId })
        .from(insuranceCoverages),
      db.select().from(insurancePolicyPersons),
      db
        .select({ id: users.id, name: users.name, active: users.active })
        .from(users),
      db
        .select({ id: properties.id, name: properties.name })
        .from(properties),
    ]);

  const coverageCounts = new Map<number, number>();
  for (const c of coverageRows) {
    coverageCounts.set(c.policyId, (coverageCounts.get(c.policyId) ?? 0) + 1);
  }

  const policies: GapPolicy[] = policyRows.map(p => ({
    id: p.id,
    name: p.name,
    branch: p.branch,
    status: p.status,
    premium: p.premium,
    renewal: p.renewal,
    startDate: p.startDate,
    mainDueDate: p.mainDueDate,
    endDate: p.endDate,
    noticePeriodMonths: p.noticePeriodMonths,
    coverageCount: coverageCounts.get(p.id) ?? 0,
    createdAt: p.createdAt.getTime(),
  }));

  return {
    policies,
    // Deaktivierte Mitglieder brauchen keine Deckung mehr
    persons: userRows
      .filter(u => u.active)
      .map(u => ({ id: u.id, name: u.name })),
    personLinks: personRows.map(r => ({
      policyId: r.policyId,
      userId: r.userId,
    })),
    context: {
      propertyCount: propertyRows.length,
      propertyName: propertyRows[0]?.name ?? null,
    },
    dismissedKeys,
    today: localISO(new Date()),
  };
}

async function dismissedKeysOf(): Promise<string[]> {
  const rows = await getDb()
    .select({ gapKey: insuranceGapDismissals.gapKey })
    .from(insuranceGapDismissals);
  return rows.map(r => r.gapKey);
}

/** Kurzform je Hinweis-Art für Historie und Audit-Log */
const GAP_KIND_LABELS: Record<string, string> = {
  coverage_ending: "Auslaufende Deckung",
  notice_soon: "Kündigungsfrist",
  notice_missed: "Verstrichene Kündigungsfrist",
  expiring: "Ablauf",
  no_end_date: "Fehlendes Vertragsende",
  no_premium: "Fehlende Prämie",
  no_coverage: "Fehlende Deckungen",
  quote_pending: "Offenes Angebot",
};

/**
 * Menschenlesbare Bezeichnung eines Lücken-Schlüssels — für Historie und
 * Audit-Log. Der Schlüssel ist strukturiert (`branch:<b>`,
 * `branch:<b>:person:<id>`, `policy:<id>:<kind>`), deshalb lässt er sich
 * ohne die Analyse-Engine auflösen: Das funktioniert auch dann noch, wenn
 * der Hinweis inzwischen gar nicht mehr feuert.
 */
async function describeGapKey(key: string): Promise<string> {
  const db = getDb();
  const parts = key.split(":");

  if (parts[0] === "branch") {
    const branch = parts[1] as InsuranceBranch;
    const label = INSURANCE_BRANCH_LABELS[branch] ?? branch;
    if (parts[2] === "person") {
      const id = Number(parts[3]);
      const user = await db.query.users.findFirst({ where: eq(users.id, id) });
      return `Fehlende ${label} (${user?.name ?? `#${id}`})`;
    }
    return `Fehlende ${label}`;
  }

  if (parts[0] === "policy") {
    const id = Number(parts[1]);
    const policy = await db.query.insurancePolicies.findFirst({
      where: eq(insurancePolicies.id, id),
    });
    const kind = GAP_KIND_LABELS[parts[2]] ?? parts[2];
    return policy ? `${kind} — „${policy.name}“` : `${kind} (Police #${id})`;
  }

  return key;
}

/* --------------------------------- Router --------------------------------- */

export const insuranceRouter = createRouter({
  /* -------------------------------- Policen ------------------------------- */

  listPolicies: authedQuery
    .input(
      z
        .object({
          branch: branchInput.optional(),
          status: statusInput.optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const filters = [
        input?.branch ? eq(insurancePolicies.branch, input.branch) : undefined,
        input?.status ? eq(insurancePolicies.status, input.status) : undefined,
      ].filter(Boolean);
      const where =
        filters.length > 0
          ? and(...(filters as NonNullable<(typeof filters)[number]>[]))
          : undefined;

      const [rows, personRows, coverageRows, attachmentRows, accountRows] =
        await Promise.all([
          db.select().from(insurancePolicies).where(where),
          db.select().from(insurancePolicyPersons),
          db
            .select({ policyId: insuranceCoverages.policyId })
            .from(insuranceCoverages),
          db
            .select({ policyId: insuranceAttachments.policyId })
            .from(insuranceAttachments),
          db.select({ id: accounts.id, name: accounts.name }).from(accounts),
        ]);

      const personsByPolicy = new Map<number, number[]>();
      for (const r of personRows) {
        const list = personsByPolicy.get(r.policyId);
        if (list) list.push(r.userId);
        else personsByPolicy.set(r.policyId, [r.userId]);
      }
      const countBy = (list: { policyId: number }[]) => {
        const map = new Map<number, number>();
        for (const r of list) map.set(r.policyId, (map.get(r.policyId) ?? 0) + 1);
        return map;
      };
      const coverageCounts = countBy(coverageRows);
      const attachmentCounts = countBy(attachmentRows);
      const accountNames = new Map(accountRows.map(a => [a.id, a.name]));
      const liveRecurring = await existingRecurringIds(
        rows.map(r => r.premiumRecurringId ?? 0)
      );
      const today = localISO(new Date());

      return rows
        .map(p => ({
          ...p,
          personIds: (personsByPolicy.get(p.id) ?? []).sort((a, b) => a - b),
          coverageCount: coverageCounts.get(p.id) ?? 0,
          attachmentCount: attachmentCounts.get(p.id) ?? 0,
          premiumMonthly: premiumPerMonth(p.premium, p.premiumInterval),
          premiumYearly: premiumPerYear(p.premium, p.premiumInterval),
          notice: computeNotice(p, today),
          accountName:
            p.accountId !== null ? (accountNames.get(p.accountId) ?? null) : null,
          // Tote Rückverweise als „keine Dauerbuchung" ausweisen
          premiumRecurringId:
            p.premiumRecurringId !== null &&
            liveRecurring.has(p.premiumRecurringId)
              ? p.premiumRecurringId
              : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }),

  addPolicy: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(1, "Name darf nicht leer sein."),
        branch: branchInput,
        insurer: z.string().trim().max(120).default(""),
        policyNumber: z.string().trim().max(80).default(""),
        status: statusInput.default("active"),
        premium: centInput.default(0),
        premiumInterval: premiumInterval.default("yearly"),
        deductible: centInput.nullish(),
        startDate: isoDate,
        renewal: renewalInput.default("auto"),
        mainDueDate: isoDate.nullish(),
        endDate: isoDate.nullish(),
        noticePeriodMonths: z.number().int().min(0).max(60).default(3),
        accountId: z.number().int().positive().nullish(),
        notes: z.string().max(2000).default(""),
        personIds: z.array(z.number().int().positive()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      assertDateOrder(input.startDate, input.endDate ?? null);
      if (input.accountId) {
        await requireAccountAccess(db, ctx.user, input.accountId, "view");
      }
      await assertKnownUsers(input.personIds);

      const values = {
        name: input.name,
        branch: input.branch,
        insurer: input.insurer,
        policyNumber: input.policyNumber,
        status: input.status,
        premium: input.premium,
        premiumInterval: input.premiumInterval,
        deductible: input.deductible ?? null,
        startDate: input.startDate,
        renewal: input.renewal,
        // Ein befristeter Vertrag hat keinen Hauptverfall
        mainDueDate:
          input.renewal === "fixed" ? null : (input.mainDueDate ?? null),
        endDate: input.endDate ?? null,
        noticePeriodMonths: input.noticePeriodMonths,
        accountId: input.accountId ?? null,
        notes: input.notes,
      };

      const inserted = await db
        .insert(insurancePolicies)
        .values({ ...values, createdAt: new Date() })
        .returning({ id: insurancePolicies.id });
      const id = inserted[0].id;
      await setPolicyPersons(id, input.personIds);

      await recordInsuranceChange(db, {
        userId: ctx.user.id,
        entity: "policy",
        entityId: id,
        before: null,
        after: values,
        fieldLabels: POLICY_LABELS,
        format: formatPolicyField,
        summary: `Police „${input.name}“ (${INSURANCE_BRANCH_LABELS[input.branch]})`,
      });
      logAudit(
        db,
        ctx.user.id,
        "insurance.policy.created",
        "insurance",
        id,
        // Policennummer bewusst nicht ins Audit-Log
        `Police „${input.name}“ (${INSURANCE_BRANCH_LABELS[input.branch]})`
      );
      return { id };
    }),

  updatePolicy: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).optional(),
        branch: branchInput.optional(),
        insurer: z.string().trim().max(120).optional(),
        policyNumber: z.string().trim().max(80).optional(),
        status: statusInput.optional(),
        premium: centInput.optional(),
        premiumInterval: premiumInterval.optional(),
        deductible: centInput.nullish(),
        startDate: isoDate.optional(),
        renewal: renewalInput.optional(),
        mainDueDate: isoDate.nullish(),
        endDate: isoDate.nullish(),
        noticePeriodMonths: z.number().int().min(0).max(60).optional(),
        accountId: z.number().int().positive().nullish(),
        notes: z.string().max(2000).optional(),
        /** undefined = unverändert; [] = gemeinsame Police */
        personIds: z.array(z.number().int().positive()).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadPolicy(input.id);

      const renewal = input.renewal ?? row.renewal;
      const next = {
        name: input.name ?? row.name,
        branch: input.branch ?? row.branch,
        insurer: input.insurer ?? row.insurer,
        policyNumber: input.policyNumber ?? row.policyNumber,
        status: input.status ?? row.status,
        premium: input.premium ?? row.premium,
        premiumInterval: input.premiumInterval ?? row.premiumInterval,
        deductible:
          input.deductible === undefined ? row.deductible : input.deductible,
        startDate: input.startDate ?? row.startDate,
        renewal,
        mainDueDate:
          renewal === "fixed"
            ? null
            : input.mainDueDate === undefined
              ? row.mainDueDate
              : input.mainDueDate,
        endDate: input.endDate === undefined ? row.endDate : input.endDate,
        noticePeriodMonths: input.noticePeriodMonths ?? row.noticePeriodMonths,
        accountId:
          input.accountId === undefined ? row.accountId : input.accountId,
        notes: input.notes ?? row.notes,
      };

      assertDateOrder(next.startDate, next.endDate);
      if (next.accountId !== null && next.accountId !== row.accountId) {
        await requireAccountAccess(db, ctx.user, next.accountId, "view");
      }

      // Personen als Kurzform ins Diff — nicht als eigene Entity
      const beforeIds = await personIdsOf(row.id);
      const afterIds =
        input.personIds === undefined
          ? beforeIds
          : [...new Set(input.personIds)].sort((a, b) => a - b);
      if (input.personIds !== undefined) await assertKnownUsers(afterIds);
      const userRows = await db
        .select({ id: users.id, name: users.name })
        .from(users);
      const names = new Map(userRows.map(u => [u.id, u.name]));

      const changed = await recordInsuranceChange(db, {
        userId: ctx.user.id,
        entity: "policy",
        entityId: row.id,
        comment: input.comment,
        before: {
          name: row.name,
          branch: row.branch,
          insurer: row.insurer,
          policyNumber: row.policyNumber,
          status: row.status,
          premium: row.premium,
          premiumInterval: row.premiumInterval,
          deductible: row.deductible,
          startDate: row.startDate,
          renewal: row.renewal,
          mainDueDate: row.mainDueDate,
          endDate: row.endDate,
          noticePeriodMonths: row.noticePeriodMonths,
          accountId: row.accountId,
          notes: row.notes,
          persons: personsToText(beforeIds, names),
        },
        after: { ...next, persons: personsToText(afterIds, names) },
        fieldLabels: POLICY_LABELS,
        format: formatPolicyField,
      });

      if (changed > 0) {
        await db
          .update(insurancePolicies)
          .set(next)
          .where(eq(insurancePolicies.id, row.id));
        if (input.personIds !== undefined) {
          await setPolicyPersons(row.id, afterIds);
        }
        logAudit(
          db,
          ctx.user.id,
          "insurance.policy.updated",
          "insurance",
          row.id,
          `Police „${next.name}“`
        );
      }
      return { ok: true as const };
    }),

  deletePolicy: authedQuery
    .input(
      z.object({ id: z.number().int().positive(), comment: commentInput })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadPolicy(input.id);

      // Dateien vor den DB-Zeilen — sonst sind die storedName-Verweise weg
      await deleteInsuranceAttachmentsFor(db, [row.id]);
      await db
        .delete(insuranceCoverages)
        .where(eq(insuranceCoverages.policyId, row.id));
      await db
        .delete(insurancePolicyPersons)
        .where(eq(insurancePolicyPersons.policyId, row.id));
      await db
        .delete(insurancePolicies)
        .where(eq(insurancePolicies.id, row.id));

      await recordInsuranceChange(db, {
        userId: ctx.user.id,
        entity: "policy",
        entityId: row.id,
        comment: input.comment,
        before: { name: row.name },
        after: null,
        fieldLabels: POLICY_LABELS,
        format: formatPolicyField,
        summary: `Police „${row.name}“ (${INSURANCE_BRANCH_LABELS[row.branch]})`,
      });
      logAudit(
        db,
        ctx.user.id,
        "insurance.policy.deleted",
        "insurance",
        row.id,
        `Police „${row.name}“`
      );
      return { ok: true as const };
    }),

  /* ------------------------------- Deckungen ------------------------------ */

  listCoverages: authedQuery
    .input(
      z.object({ policyId: z.number().int().positive().optional() }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(insuranceCoverages)
        .where(
          input?.policyId
            ? eq(insuranceCoverages.policyId, input.policyId)
            : undefined
        );
      return rows.sort((a, b) => a.id - b.id);
    }),

  addCoverage: authedQuery
    .input(
      z.object({
        policyId: z.number().int().positive(),
        label: z.string().trim().min(1, "Bezeichnung darf nicht leer sein."),
        /** null = unbegrenzt */
        sumInsured: centInput.nullish(),
        deductible: centInput.nullish(),
        notes: z.string().max(500).default(""),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const policy = await loadPolicy(input.policyId);
      const values = {
        policyId: policy.id,
        label: input.label,
        sumInsured: input.sumInsured ?? null,
        deductible: input.deductible ?? null,
        notes: input.notes,
      };
      const inserted = await db
        .insert(insuranceCoverages)
        .values({ ...values, createdAt: new Date() })
        .returning({ id: insuranceCoverages.id });
      const id = inserted[0].id;

      await recordInsuranceChange(db, {
        userId: ctx.user.id,
        entity: "coverage",
        entityId: id,
        before: null,
        after: values,
        fieldLabels: COVERAGE_LABELS,
        format: formatCoverageField,
        summary: `Deckung „${input.label}“ zu „${policy.name}“`,
      });
      logAudit(
        db,
        ctx.user.id,
        "insurance.coverage.created",
        "insurance",
        id,
        `Deckung „${input.label}“ zu „${policy.name}“`
      );
      return { id };
    }),

  updateCoverage: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        label: z.string().trim().min(1).optional(),
        sumInsured: centInput.nullish(),
        deductible: centInput.nullish(),
        notes: z.string().max(500).optional(),
        comment: commentInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadCoverage(input.id);
      const next = {
        label: input.label ?? row.label,
        sumInsured:
          input.sumInsured === undefined ? row.sumInsured : input.sumInsured,
        deductible:
          input.deductible === undefined ? row.deductible : input.deductible,
        notes: input.notes ?? row.notes,
      };

      const changed = await recordInsuranceChange(db, {
        userId: ctx.user.id,
        entity: "coverage",
        entityId: row.id,
        comment: input.comment,
        before: {
          label: row.label,
          sumInsured: row.sumInsured,
          deductible: row.deductible,
          notes: row.notes,
        },
        after: next,
        fieldLabels: COVERAGE_LABELS,
        format: formatCoverageField,
      });

      if (changed > 0) {
        await db
          .update(insuranceCoverages)
          .set(next)
          .where(eq(insuranceCoverages.id, row.id));
        logAudit(
          db,
          ctx.user.id,
          "insurance.coverage.updated",
          "insurance",
          row.id,
          `Deckung „${next.label}“`
        );
      }
      return { ok: true as const };
    }),

  deleteCoverage: authedQuery
    .input(
      z.object({ id: z.number().int().positive(), comment: commentInput })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await loadCoverage(input.id);
      await db
        .delete(insuranceCoverages)
        .where(eq(insuranceCoverages.id, row.id));

      await recordInsuranceChange(db, {
        userId: ctx.user.id,
        entity: "coverage",
        entityId: row.id,
        comment: input.comment,
        before: { label: row.label },
        after: null,
        fieldLabels: COVERAGE_LABELS,
        format: formatCoverageField,
        summary: `Deckung „${row.label}“`,
      });
      logAudit(
        db,
        ctx.user.id,
        "insurance.coverage.deleted",
        "insurance",
        row.id,
        `Deckung „${row.label}“`
      );
      return { ok: true as const };
    }),

  /* -------------------------------- Dokumente ----------------------------- */

  listAttachments: authedQuery
    .input(z.object({ policyId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: insuranceAttachments.id,
          originalName: insuranceAttachments.originalName,
          mimeType: insuranceAttachments.mimeType,
          sizeBytes: insuranceAttachments.sizeBytes,
          createdAt: insuranceAttachments.createdAt,
        })
        .from(insuranceAttachments)
        .where(eq(insuranceAttachments.policyId, input.policyId));
    }),

  /* ------------------------------- Historie ------------------------------- */

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
        ? eq(insuranceChanges.entity, input.entity)
        : undefined;
      const [rows, countRow, userRows] = await Promise.all([
        db.query.insuranceChanges.findMany({
          where,
          orderBy: (t, { desc: d }) => [d(t.createdAt), d(t.id)],
          limit: input.limit,
          offset: input.cursor,
        }),
        db
          .select({ total: sql<number>`count(*)` })
          .from(insuranceChanges)
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

  /* ----------------------------- Lückenanalyse ---------------------------- */

  gapAnalysis: authedQuery.query(async () => {
    const db = getDb();
    const [rows, userRows] = await Promise.all([
      db.select().from(insuranceGapDismissals),
      db
        .select({ id: users.id, name: users.name, color: users.color })
        .from(users),
    ]);
    const byId = new Map(userRows.map(u => [u.id, u]));
    const input = await gapInputFor(rows.map(r => r.gapKey));
    const result = getInsuranceRules().analyzeGaps(input);

    // Begründung, Autor und Zeitpunkt gehören ans ausgeblendete Element —
    // sonst ist die Notiz erfasst, aber nirgends sichtbar.
    const byKey = new Map(rows.map(r => [r.gapKey, r]));
    const dismissed = result.dismissed.map(g => {
      const row = byKey.get(g.key);
      return {
        ...g,
        dismissal: row
          ? {
              note: row.note,
              userName: byId.get(row.userId)?.name ?? null,
              userColor: byId.get(row.userId)?.color ?? null,
              createdAt: row.createdAt,
            }
          : null,
      };
    });

    return {
      gaps: result.gaps,
      dismissed,
      personCount: input.persons.length,
    };
  }),

  dismissGap: authedQuery
    .input(
      z.object({
        key: z.string().trim().min(1).max(120),
        note: z.string().max(300).default(""),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.insuranceGapDismissals.findFirst({
        where: eq(insuranceGapDismissals.gapKey, input.key),
      });
      if (existing) return { ok: true as const };
      const inserted = await db
        .insert(insuranceGapDismissals)
        .values({
          gapKey: input.key,
          userId: ctx.user.id,
          note: input.note,
          createdAt: new Date(),
        })
        .returning({ id: insuranceGapDismissals.id });

      // Der Hinweis-Name steht als Feld-Label im Diff — so liest sich der
      // Eintrag als „Fehlende Hausrat: eingeblendet → ausgeblendet".
      const label = await describeGapKey(input.key);
      await recordInsuranceChange(db, {
        userId: ctx.user.id,
        entity: "gap",
        entityId: inserted[0].id,
        // Leere Begründung als null, nicht "" — sonst zeigt der Verlauf eine
        // Begründungs-Zeile ohne Inhalt
        before: { state: "eingeblendet", note: null },
        after: { state: "ausgeblendet", note: input.note.trim() || null },
        fieldLabels: { state: label, note: "Begründung" },
      });
      logAudit(
        db,
        ctx.user.id,
        "insurance.gap.dismissed",
        "insurance",
        null,
        `${label} ausgeblendet`
      );
      return { ok: true as const };
    }),

  restoreGap: authedQuery
    .input(z.object({ key: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      // Zeile vor dem Löschen lesen — sie liefert Id und Begründung für die
      // Historie
      const row = await db.query.insuranceGapDismissals.findFirst({
        where: eq(insuranceGapDismissals.gapKey, input.key),
      });
      if (!row) return { ok: true as const };
      await db
        .delete(insuranceGapDismissals)
        .where(eq(insuranceGapDismissals.gapKey, input.key));

      const label = await describeGapKey(input.key);
      await recordInsuranceChange(db, {
        userId: ctx.user.id,
        entity: "gap",
        entityId: row.id,
        before: { state: "ausgeblendet", note: row.note || null },
        after: { state: "eingeblendet", note: null },
        fieldLabels: { state: label, note: "Begründung" },
      });
      logAudit(
        db,
        ctx.user.id,
        "insurance.gap.restored",
        "insurance",
        null,
        `${label} wieder eingeblendet`
      );
      return { ok: true as const };
    }),

  /* -------------------------------- Übersicht ----------------------------- */

  summary: authedQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(insurancePolicies);
    const today = localISO(new Date());

    // Angebote zählen nie in die Prämiensummen
    const paying = rows.filter(p => p.status === "active");
    const premiumMonthly = paying.reduce(
      (sum, p) => sum + premiumPerMonth(p.premium, p.premiumInterval),
      0
    );
    const premiumYearly = paying.reduce(
      (sum, p) => sum + premiumPerYear(p.premium, p.premiumInterval),
      0
    );

    let nextCancelBy: string | null = null;
    let nextCancelPolicy: string | null = null;
    // Die Restlaufzeit rechnet der Server mit — sonst müsste das UI während
    // des Renderns die Uhr lesen (unreine Funktion).
    let nextCancelDays: number | null = null;
    for (const p of rows) {
      const notice = computeNotice(p, today);
      if (notice.cancelBy === null) continue;
      if (nextCancelBy === null || notice.cancelBy < nextCancelBy) {
        nextCancelBy = notice.cancelBy;
        nextCancelPolicy = p.name;
        nextCancelDays = notice.daysUntilCancel;
      }
    }

    const gapResult = getInsuranceRules().analyzeGaps(
      await gapInputFor(await dismissedKeysOf())
    );
    const liveRecurring = await existingRecurringIds(
      rows.map(r => r.premiumRecurringId ?? 0)
    );

    return {
      count: rows.length,
      activeCount: paying.length,
      quoteCount: rows.filter(p => p.status === "quote").length,
      premiumMonthly,
      premiumYearly,
      nextCancelBy,
      nextCancelPolicy,
      nextCancelDays,
      gapCount: gapResult.gaps.length,
      warnCount: gapResult.gaps.filter(g => g.severity === "warn").length,
      missingRecurringCount: paying.filter(
        p =>
          p.premium > 0 &&
          (p.premiumRecurringId === null ||
            !liveRecurring.has(p.premiumRecurringId))
      ).length,
    };
  }),

  /* ------------------------ Übernahme als Dauerbuchung -------------------- */

  /**
   * Legt die Prämie einer Police als wiederkehrende Ausgabe an.
   * Kopie, kein Live-Sync (wie `mortgage.transferInterestToRecurring`):
   * Ändert sich später die Prämie, muss die Dauerbuchung angepasst werden.
   */
  transferPremiumToRecurring: authedQuery
    .input(
      z.object({
        policyId: z.number().int().positive(),
        accountId: z.number().int().positive(),
        categoryId: z.number().int().positive().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const policy = await loadPolicy(input.policyId);
      await assertNoLiveRecurring(
        policy.premiumRecurringId,
        "Für diese Police ist bereits eine Dauerbuchung hinterlegt."
      );
      if (policy.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Nur aktive Policen lassen sich als Dauerbuchung übernehmen.",
        });
      }
      if (policy.premium <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Für diese Police ist keine Prämie erfasst.",
        });
      }
      await requireAccountAccess(db, ctx.user, input.accountId, "edit");

      const interval = asPremiumInterval(policy.premiumInterval);
      const nextDate = firstOfNextMonth();
      const inserted = await db
        .insert(recurring)
        .values({
          type: "expense",
          accountId: input.accountId,
          toAccountId: null,
          amount: policy.premium,
          categoryId: input.categoryId ?? null,
          userId: ctx.user.id,
          note: `Versicherungsprämie „${policy.name}“`,
          interval,
          nextDate,
          // Befristete Police → befristete Dauerbuchung
          endDate: policy.endDate,
          active: true,
          createdAt: new Date(),
        })
        .returning({ id: recurring.id });
      const recurringId = inserted[0].id;
      await db
        .update(insurancePolicies)
        .set({ premiumRecurringId: recurringId })
        .where(eq(insurancePolicies.id, policy.id));
      logAudit(
        db,
        ctx.user.id,
        "insurance.premium.transferred",
        "insurance",
        policy.id,
        `Prämie „${policy.name}“ ${auditAmount(policy.premium)} ${INTERVAL_LABELS[interval]}`
      );
      return { id: recurringId, amount: policy.premium, interval, nextDate };
    }),
});
