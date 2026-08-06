/**
 * Abschnitts-Katalog des Berichts-Exports — geteilt zwischen Backend
 * (Validierung der Query-Parameter, Reihenfolge im Dokument) und Frontend
 * (Checkbox-Liste auf der Bericht-Seite).
 *
 * Der Katalog ist fix: Ein Abschnitt ist kein Label, sondern ein Stück
 * Sammel- und Renderlogik — dieselbe Begründung wie beim Sparten-Katalog in
 * `insurance.ts`.
 *
 * Die Reihenfolge des Arrays ist die Reihenfolge im PDF und die Blattfolge in
 * der Excel-Mappe: Konten zuerst, weil sie der Anker sind — alles Weitere
 * beschreibt ihre Verwendung.
 */

export const REPORT_SECTIONS = [
  "accounts",
  "goals",
  "mortgages",
  "pension",
  "insurances",
  "cashflow",
  "recurring",
  "netWorth",
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const REPORT_SECTION_LABELS: Record<ReportSection, string> = {
  accounts: "Konten & Salden",
  goals: "Sparziele",
  mortgages: "Hypotheken",
  pension: "Vorsorge",
  insurances: "Versicherungen",
  cashflow: "Cashflow (12 Monate)",
  recurring: "Fixkosten (Dauerbuchungen)",
  netWorth: "Nettovermögens-Prognose",
};

/** Kurztext unter der Checkbox — was der Abschnitt konkret zeigt */
export const REPORT_SECTION_HINTS: Record<ReportSection, string> = {
  accounts: "Alle für dich sichtbaren Konten mit Typ, Bank, IBAN und Saldo.",
  goals: "Sparziele mit Fortschritt und den verknüpften Konten.",
  mortgages: "Liegenschaften, Tranchen, Belehnung und Tragbarkeit je Objekt.",
  pension:
    "Deine private 3-Säulen-Übersicht mit Altersprognose (nur deine eigenen Daten).",
  insurances: "Policen mit Prämie, Deckungen und nächster Kündigungsfrist.",
  cashflow:
    "Einnahmen und Ausgaben der letzten 12 Monate, dazu Ausgaben je Oberkategorie.",
  recurring:
    "Wiederkehrende Ein- und Ausgaben mit Intervall und Monatsäquivalent.",
  netWorth:
    "Entwicklung von Kontoständen, Hypothekarschuld und Nettovermögen über den gewählten Horizont.",
};

/** Auswählbare Horizonte der Nettovermögens-Prognose (Grenze: forecast.balance) */
export const REPORT_MONTHS = [12, 24, 36] as const;
export type ReportMonths = (typeof REPORT_MONTHS)[number];

export const REPORT_MONTHS_LABELS: Record<ReportMonths, string> = {
  12: "1 Jahr",
  24: "2 Jahre",
  36: "3 Jahre",
};

export function isReportSection(value: string): value is ReportSection {
  return (REPORT_SECTIONS as readonly string[]).includes(value);
}

/**
 * Parst die `sections`-Query („accounts,goals") in eine sortierte, doppelte
 * Einträge entfernende Liste. Unbekannte Werte werden still verworfen — der
 * Aufrufer entscheidet, was eine leere Liste bedeutet.
 */
export function parseReportSections(raw: string | null): ReportSection[] {
  if (!raw) return [];
  const wanted = new Set(
    raw
      .split(",")
      .map(s => s.trim())
      .filter(isReportSection)
  );
  return REPORT_SECTIONS.filter(s => wanted.has(s));
}
