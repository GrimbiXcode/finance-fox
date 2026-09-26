import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { formatBp, formatCents, formatDate } from "@/lib/finance";

/** Hinweis aus `mortgage.forecast` (strukturiert, siehe `MortgageWarning`) */
export type MortgageWarning =
  inferRouterOutputs<AppRouter>["mortgage"]["forecast"]["warnings"][number];

/**
 * Hinweise kommen als strukturierte Daten vom Server — Beträge, Prozente
 * und Datumsangaben werden erst hier locale-konform formatiert.
 */
export function warningText(w: MortgageWarning): string {
  switch (w.kind) {
    case "no_market_value":
      return "Ohne Verkehrswert lassen sich Belehnung und Tragbarkeit nicht berechnen.";
    case "ltv_exceeded":
      return `Die Belehnung liegt bei ${formatBp(w.ltvBp)} % und übersteigt die Grenze von ${formatBp(w.maxLtvBp)} %.`;
    case "no_income":
      return "Ohne Bruttojahreseinkommen lässt sich die Tragbarkeit nicht berechnen.";
    case "affordability_exceeded":
      return `Die Tragbarkeit liegt bei ${formatBp(w.ratioBp)} % des Bruttoeinkommens (Richtwert: höchstens 33 %).`;
    case "amortization_uncovered":
      return `Die Amortisationspflicht der 2. Hypothek von ${formatCents(w.required)} pro Jahr ist nicht gedeckt — erfasst sind ${formatCents(w.actual)}.`;
    case "maturity_due":
      return `Die Zinsbindung von „${w.tranche}“ läuft am ${formatDate(w.date)} ab.`;
    case "maturity_passed":
      return `Die Zinsbindung von „${w.tranche}“ ist am ${formatDate(w.date)} abgelaufen.`;
    case "stale_balance":
      return `Die Restschuld von „${w.tranche}“ ist per ${formatDate(w.date)} erfasst — bitte aktualisieren.`;
  }
}
