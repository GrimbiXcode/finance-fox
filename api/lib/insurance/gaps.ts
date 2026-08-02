/**
 * Lückenanalyse („Deckungs-Check") — rein, ohne DB-Zugriff.
 *
 * Ergebnis sind **strukturierte** Hinweise, keine fertigen Sätze: Beträge und
 * Daten formatiert erst das Frontend locale-konform (`gapText` in
 * `pages/Insurances.tsx`). Gleiche Begründung wie bei `MortgageWarning`.
 */

import {
  INSURANCE_BRANCHES,
  type InsuranceBranch,
  type InsuranceRenewal,
  type InsuranceStatus,
} from "@contracts/insurance";
import { computeNotice, daysBetween } from "./notice";

/* --------------------------------- Typen ---------------------------------- */

export interface GapPolicy {
  id: number;
  name: string;
  branch: InsuranceBranch;
  status: InsuranceStatus;
  premium: number;
  renewal: InsuranceRenewal;
  startDate: string;
  mainDueDate: string | null;
  endDate: string | null;
  noticePeriodMonths: number;
  coverageCount: number;
  /** Erfassungszeitpunkt (ms) — nur für das Alter von Angeboten */
  createdAt: number;
}

export interface GapInput {
  policies: GapPolicy[];
  /** Nur **aktive** Haushaltsmitglieder */
  persons: { id: number; name: string }[];
  /** Zuordnung Police → versicherte Person (leer für eine Police = gemeinsam) */
  personLinks: { policyId: number; userId: number }[];
  /** Auslöser aus anderen Modulen (haushaltsweit, kein Rechte-Problem) */
  context: { propertyCount: number; propertyName: string | null };
  dismissedKeys: string[];
  today: string;
}

export type InsuranceGap = {
  /** Stabile Identität fürs Ausblenden — überlebt das Umbenennen einer Police */
  key: string;
  severity: "warn" | "info";
  /** false bei zeitgebundenen Hinweisen, die sich von selbst erledigen */
  dismissible: boolean;
} & (
  | { kind: "missing_household"; branch: InsuranceBranch }
  | {
      kind: "missing_person";
      branch: InsuranceBranch;
      personId: number;
      personName: string;
    }
  | {
      kind: "missing_building";
      propertyName: string | null;
      propertyCount: number;
    }
  | {
      kind: "coverage_ending";
      policyId: number;
      policy: string;
      branch: InsuranceBranch;
      endDate: string;
      days: number;
    }
  | {
      kind: "notice_soon";
      policyId: number;
      policy: string;
      cancelBy: string;
      days: number;
    }
  | {
      kind: "notice_missed";
      policyId: number;
      policy: string;
      dueDate: string;
      nextCancelBy: string | null;
    }
  | {
      kind: "expiring";
      policyId: number;
      policy: string;
      dueDate: string;
      days: number;
    }
  | { kind: "no_end_date"; policyId: number; policy: string }
  | { kind: "no_premium"; policyId: number; policy: string }
  | { kind: "no_coverage"; policyId: number; policy: string }
  | { kind: "quote_pending"; policyId: number; policy: string; days: number }
);

export interface GapResult {
  gaps: InsuranceGap[];
  dismissed: InsuranceGap[];
}

/* ------------------------------- Schwellen -------------------------------- */

/** Ab wann eine auslaufende Deckung bzw. ein Ablauf gemeldet wird */
const ENDING_DAYS = 60;
/** Ab wann an eine Kündigungsfrist erinnert wird */
const NOTICE_DAYS = 90;
/** Ab wann ein Hinweis von „info" auf „warn" hochgestuft wird */
const URGENT_DAYS = 30;
/** Ab wann ein unerledigtes Angebot als vergessen gilt */
const QUOTE_STALE_DAYS = 60;

/* -------------------------------- Regelwerk ------------------------------- */

/**
 * Deckt die Police heute? Eine **gekündigte, aber noch laufende** Police
 * deckt sehr wohl — wer das übersieht, baut eine Analyse, die entweder
 * ständig falsch Alarm schlägt oder die echte Lücke („Deckung endet in drei
 * Wochen, keine Nachfolge") nie findet. Angebote decken nie.
 */
function covers(p: GapPolicy, today: string): boolean {
  if (p.status === "active") return true;
  if (p.status === "cancelled") return p.endDate === null || p.endDate >= today;
  return false;
}

/** Effektives Deckungsende (NULL = offen) */
function coverageEnd(p: GapPolicy): string | null {
  return p.endDate;
}

export function analyzeGaps(input: GapInput): GapResult {
  const { policies, persons, personLinks, context, today } = input;
  const all: InsuranceGap[] = [];

  const covering = policies.filter(p => covers(p, today));
  const personsByPolicy = new Map<number, number[]>();
  for (const link of personLinks) {
    const list = personsByPolicy.get(link.policyId);
    if (list) list.push(link.userId);
    else personsByPolicy.set(link.policyId, [link.userId]);
  }

  /** Deckt die Sparte diese Person? Police ohne Personen-Links deckt alle. */
  const coversPerson = (branch: InsuranceBranch, userId: number): boolean =>
    covering.some(p => {
      if (p.branch !== branch) return false;
      const linked = personsByPolicy.get(p.id) ?? [];
      return linked.length === 0 || linked.includes(userId);
    });

  const coversBranch = (branch: InsuranceBranch): boolean =>
    covering.some(p => p.branch === branch);

  // R1/R2 — pro Person empfohlene Sparten
  for (const def of INSURANCE_BRANCHES) {
    if (def.scope !== "person") continue;
    for (const person of persons) {
      if (coversPerson(def.key, person.id)) continue;
      all.push({
        kind: "missing_person",
        key: `branch:${def.key}:person:${person.id}`,
        severity: def.severity,
        dismissible: true,
        branch: def.key,
        personId: person.id,
        personName: person.name,
      });
    }
  }

  // R3 — einmal pro Haushalt empfohlene Sparten
  for (const def of INSURANCE_BRANCHES) {
    if (def.scope !== "household") continue;
    if (coversBranch(def.key)) continue;
    all.push({
      kind: "missing_household",
      key: `branch:${def.key}`,
      severity: def.severity,
      dismissible: true,
      branch: def.key,
    });
  }

  // R4 — kontextabhängig: Wohneigentum ohne Gebäudeversicherung
  if (context.propertyCount > 0 && !coversBranch("gebaeude")) {
    all.push({
      kind: "missing_building",
      key: "branch:gebaeude",
      severity: "warn",
      dismissible: true,
      propertyName: context.propertyName,
      propertyCount: context.propertyCount,
    });
  }

  for (const p of policies) {
    const notice = computeNotice(p, today);

    // R5 — die eigentliche Deckungslücke: läuft aus und niemand springt ein
    const end = coverageEnd(p);
    if (covers(p, today) && end !== null && end >= today) {
      const days = daysBetween(today, end);
      const successor = covering.some(
        o => o.id !== p.id && o.branch === p.branch && (o.endDate === null || o.endDate > end)
      );
      if (days <= ENDING_DAYS && !successor) {
        all.push({
          kind: "coverage_ending",
          key: `policy:${p.id}:coverage_ending`,
          severity: days <= URGENT_DAYS ? "warn" : "info",
          dismissible: false,
          policyId: p.id,
          policy: p.name,
          branch: p.branch,
          endDate: end,
          days,
        });
      }
    }

    // R6 — Kündigungsfrist rückt näher
    if (notice.cancelBy !== null && notice.daysUntilCancel !== null) {
      const days = notice.daysUntilCancel;
      if (days >= 0 && days <= NOTICE_DAYS) {
        all.push({
          kind: "notice_soon",
          key: `policy:${p.id}:notice_soon`,
          severity: days <= URGENT_DAYS ? "warn" : "info",
          dismissible: false,
          policyId: p.id,
          policy: p.name,
          cancelBy: notice.cancelBy,
          days,
        });
      }
    }

    // R7 — Frist der laufenden Periode ist durch
    if (notice.currentPeriodMissed && notice.dueDate !== null) {
      all.push({
        kind: "notice_missed",
        key: `policy:${p.id}:notice_missed`,
        severity: "info",
        dismissible: false,
        policyId: p.id,
        policy: p.name,
        dueDate: notice.dueDate,
        nextCancelBy: notice.cancelBy,
      });
    }

    // R8 — befristete Police läuft demnächst ab
    if (
      p.status === "active" &&
      p.renewal === "fixed" &&
      notice.dueDate !== null &&
      notice.daysUntilDue !== null &&
      notice.daysUntilDue >= 0 &&
      notice.daysUntilDue <= ENDING_DAYS
    ) {
      all.push({
        kind: "expiring",
        key: `policy:${p.id}:expiring`,
        severity: "info",
        dismissible: false,
        policyId: p.id,
        policy: p.name,
        dueDate: notice.dueDate,
        days: notice.daysUntilDue,
      });
    }

    // R9–R11 — Datenqualität aktiver Policen
    if (p.status === "active") {
      if (p.renewal === "fixed" && p.endDate === null) {
        all.push({
          kind: "no_end_date",
          key: `policy:${p.id}:no_end_date`,
          severity: "info",
          dismissible: true,
          policyId: p.id,
          policy: p.name,
        });
      }
      if (p.premium === 0) {
        all.push({
          kind: "no_premium",
          key: `policy:${p.id}:no_premium`,
          severity: "info",
          dismissible: true,
          policyId: p.id,
          policy: p.name,
        });
      }
      if (p.coverageCount === 0) {
        // Untergräbt genau den Zweck des Moduls: schnell nachschauen können,
        // wofür man versichert ist.
        all.push({
          kind: "no_coverage",
          key: `policy:${p.id}:no_coverage`,
          severity: "info",
          dismissible: true,
          policyId: p.id,
          policy: p.name,
        });
      }
    }

    // R12 — vergessenes Angebot
    if (p.status === "quote") {
      const days = daysBetween(isoOf(p.createdAt), today);
      if (days >= QUOTE_STALE_DAYS) {
        all.push({
          kind: "quote_pending",
          key: `policy:${p.id}:quote_pending`,
          severity: "info",
          dismissible: true,
          policyId: p.id,
          policy: p.name,
          days,
        });
      }
    }
  }

  // Deterministische Sortierung: warn vor info, dann nach Regel-Reihenfolge —
  // sonst springt die Liste bei jedem Reload.
  const order = KIND_ORDER;
  all.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "warn" ? -1 : 1;
    const byKind = order.indexOf(a.kind) - order.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    return a.key.localeCompare(b.key);
  });

  const dismissedSet = new Set(input.dismissedKeys);
  return {
    gaps: all.filter(g => !dismissedSet.has(g.key)),
    dismissed: all.filter(g => dismissedSet.has(g.key)),
  };
}

const KIND_ORDER: InsuranceGap["kind"][] = [
  "missing_person",
  "missing_household",
  "missing_building",
  "coverage_ending",
  "notice_soon",
  "notice_missed",
  "expiring",
  "no_end_date",
  "no_premium",
  "no_coverage",
  "quote_pending",
];

/** Zeitstempel (ms) als lokales YYYY-MM-DD */
function isoOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
