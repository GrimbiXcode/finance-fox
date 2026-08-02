/**
 * Fachlogik des Versicherungs-Moduls.
 *
 * Die Regeln der Lückenanalyse hängen am Land (Obligatorien unterscheiden
 * sich), deshalb dieselbe Factory-Form wie `getMortgageCalculator` und
 * `getPensionCalculator` — derzeit ist nur „CH" implementiert. Die Länderwahl
 * gehört später nach `app_settings` (haushaltsweit); bewusst **kein**
 * country-Feld auf der Police: die Analyse ist ein Haushalts-, kein
 * Policenthema.
 */

import { analyzeGaps, type GapInput, type GapResult } from "./gaps";

export type { GapInput, GapPolicy, GapResult, InsuranceGap } from "./gaps";
export type { NoticeInput, NoticeResult } from "./notice";
export { computeNotice, daysBetween } from "./notice";

export interface InsuranceRules {
  analyzeGaps(input: GapInput): GapResult;
}

const chRules: InsuranceRules = { analyzeGaps };

export function getInsuranceRules(country = "CH"): InsuranceRules {
  switch (country) {
    case "CH":
    default:
      return chRules;
  }
}
