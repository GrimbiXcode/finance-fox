import { getUserLocale } from "@/lib/finance";

/**
 * „Zuletzt abgeglichen"-Angaben in deutschem Klartext.
 *
 * Die UI-Sprache ist Deutsch (siehe AGENTS.md), Zahlen- und Datumsformate
 * richten sich nach der Systemregion — deshalb feste deutsche Wörter, aber
 * `toLocaleString` für das Datum älterer Zeitpunkte.
 */
export function formatSyncTime(at: number | null): string {
  if (at === null) return "noch nie";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 45) return "gerade eben";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Minute${minutes === 1 ? "" : "n"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Stunde${hours === 1 ? "" : "n"}`;
  return new Date(at).toLocaleString(getUserLocale(), {
    dateStyle: "short",
    timeStyle: "short",
  });
}
