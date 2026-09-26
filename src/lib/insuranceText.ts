import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { INSURANCE_BRANCH_LABELS } from "@contracts/insurance";
import { formatDate } from "@/lib/finance";

/** Hinweis aus `insurance.gapAnalysis` (strukturiert, siehe `InsuranceGap`) */
export type InsuranceGap =
  inferRouterOutputs<AppRouter>["insurance"]["gapAnalysis"]["gaps"][number];

/* ------------------------------- Lückentexte ------------------------------ */

/**
 * Hinweise kommen als strukturierte Daten vom Server — Beträge und
 * Datumsangaben werden erst hier locale-konform formatiert.
 */
export function gapText(g: InsuranceGap): string {
  switch (g.kind) {
    case "missing_person":
      return `${g.personName} hat keine ${INSURANCE_BRANCH_LABELS[g.branch]} erfasst.`;
    case "missing_household":
      return `Für den Haushalt ist keine ${INSURANCE_BRANCH_LABELS[g.branch]} erfasst.`;
    case "missing_building":
      return g.propertyName
        ? `Für „${g.propertyName}“ ist keine Gebäudeversicherung erfasst.`
        : "Es ist Wohneigentum erfasst, aber keine Gebäudeversicherung.";
    case "coverage_ending":
      return `Die Deckung von „${g.policy}“ (${INSURANCE_BRANCH_LABELS[g.branch]}) endet am ${formatDate(g.endDate)} — in ${g.days} Tagen — und es gibt keine Nachfolge.`;
    case "notice_soon":
      return `„${g.policy}“ muss bis zum ${formatDate(g.cancelBy)} gekündigt werden (in ${g.days} Tagen), sonst verlängert sie sich.`;
    case "notice_missed":
      return g.nextCancelBy
        ? `Die Kündigungsfrist von „${g.policy}“ für den ${formatDate(g.dueDate)} ist verstrichen — nächste Möglichkeit: kündigen bis ${formatDate(g.nextCancelBy)}.`
        : `Die Kündigungsfrist von „${g.policy}“ für den ${formatDate(g.dueDate)} ist verstrichen.`;
    case "expiring":
      return `„${g.policy}“ läuft am ${formatDate(g.dueDate)} aus (in ${g.days} Tagen).`;
    case "no_end_date":
      return `„${g.policy}“ ist als befristet markiert, hat aber kein Vertragsende.`;
    case "no_premium":
      return `Für „${g.policy}“ ist keine Prämie erfasst.`;
    case "no_coverage":
      return `Für „${g.policy}“ sind keine Deckungen erfasst — dann lässt sich nicht nachschlagen, wofür sie aufkommt.`;
    case "quote_pending":
      return `Das Angebot „${g.policy}“ liegt seit ${g.days} Tagen unentschieden herum.`;
  }
}

/* ------------------------------- Gruppierung ------------------------------ */

/**
 * Drei Gruppen statt einer flachen Liste: was jetzt dringend ist, was man
 * prüfen sollte, und was nur an den erfassten Daten fehlt. So gehen die
 * wichtigen drei nicht in dreizehn Hinweisen unter.
 */
export type GapGroup = "act" | "check" | "data";
export const GAP_GROUP_LABELS: Record<GapGroup, string> = {
  act: "Jetzt handeln",
  check: "Prüfen",
  data: "Datenqualität",
};
const DATA_KINDS = new Set(["no_end_date", "no_premium", "no_coverage"]);

export function gapGroup(g: InsuranceGap): GapGroup {
  if (DATA_KINDS.has(g.kind)) return "data";
  return g.severity === "warn" ? "act" : "check";
}

/** Sammeltext für mehrere gleichartige Hinweise („4 Policen ohne Deckungen“) */
export function gapBundleText(
  kind: InsuranceGap["kind"],
  count: number
): string {
  switch (kind) {
    case "no_coverage":
      return `${count} Policen ohne erfasste Deckungen`;
    case "no_premium":
      return `${count} Policen ohne Prämie`;
    case "no_end_date":
      return `${count} befristete Policen ohne Vertragsende`;
    case "missing_person":
      return `${count} fehlende persönliche Versicherungen`;
    case "missing_household":
      return `${count} fehlende Haushaltsversicherungen`;
    case "notice_soon":
      return `${count} Kündigungsfristen stehen an`;
    case "notice_missed":
      return `${count} verstrichene Kündigungsfristen`;
    case "expiring":
      return `${count} Policen laufen bald aus`;
    case "coverage_ending":
      return `${count} Deckungen enden ohne Nachfolge`;
    case "quote_pending":
      return `${count} unentschiedene Angebote`;
    default:
      return `${count} ähnliche Hinweise`;
  }
}
