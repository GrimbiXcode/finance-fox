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
