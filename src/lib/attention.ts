import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { formatCents, formatDate } from "@/lib/finance";
import { warningText } from "@/lib/mortgageText";
import { gapText } from "@/lib/insuranceText";

/** Hinweis aus `dashboard.attention` (strukturiert, Sätze entstehen hier) */
export type AttentionItem =
  inferRouterOutputs<AppRouter>["dashboard"]["attention"][number];

/**
 * Ein Hinweis als Satz plus Ziel — Beträge und Daten locale-konform, wie
 * bei den Modul-Hinweisen (`warningText`, `gapText`). `names` löst
 * Personen-IDs auf (Ausgleichszahlungen).
 */
export function attentionEntry(
  item: AttentionItem,
  names: Map<number, string>
): { text: string; to: string; action?: string } {
  switch (item.kind) {
    case "budget_over":
      return {
        text: `Budget „${item.categoryName}“ ist um ${formatCents(item.spent - item.limit)} überschritten.`,
        to: "/budgets",
      };
    case "budget_fast":
      return {
        text: `Budget „${item.categoryName}“ ist zu schnell unterwegs: ${formatCents(item.aheadOfPlan)} über Plan (${formatCents(item.spent)} von ${formatCents(item.limit)}).`,
        to: "/budgets",
      };
    case "recurring_due": {
      const parts = [
        item.expense > 0 ? `−${formatCents(item.expense)}` : null,
        item.income > 0 ? `+${formatCents(item.income)}` : null,
      ].filter(Boolean);
      return {
        text: `${item.count === 1 ? "1 Dauerbuchung" : `${item.count} Dauerbuchungen`} in den nächsten ${item.days} Tagen, ab ${formatDate(item.firstDate)}${parts.length ? ` (${parts.join(", ")})` : ""}.`,
        to: "/wiederkehrend",
      };
    }
    case "settlement":
      return {
        text: `${names.get(item.fromId) ?? "?"} schuldet ${names.get(item.toId) ?? "?"} ${formatCents(item.amount)} aus geteilten Ausgaben.`,
        to: "/aufteilung",
        action: "Ausgleichen",
      };
    case "negative_cash":
      return {
        text: `„${item.accountName}“ steht bei ${formatCents(item.balance)} — vermutlich fehlt eine Bargeld-Abhebung.`,
        to: "/konten",
      };
    case "goal_behind":
      return {
        text: `Sparziel „${item.name}“: bis ${formatDate(item.deadline)} sind ${formatCents(item.required)} pro Monat nötig${item.current > 0 ? ` (heute +${formatCents(item.current)})` : ""}.`,
        to: "/sparziele",
      };
    case "mortgage":
      return { text: warningText(item.warning), to: "/hypotheken" };
    case "mortgage_missing_recurring":
      return {
        text: `${item.count === 1 ? "1 Hypotheken-Posten ist" : `${item.count} Hypotheken-Posten sind`} nicht als Dauerbuchung erfasst — Prognosen fallen zu optimistisch aus.`,
        to: "/hypotheken",
      };
    case "insurance":
      return { text: gapText(item.gap), to: "/versicherungen" };
    case "section_failed":
      return {
        text: `Hinweise aus „${item.area}“ konnten nicht geprüft werden: ${item.message}`,
        to: "/",
      };
  }
}
