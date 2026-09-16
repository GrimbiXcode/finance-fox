export * from "./errors";

/* --------------------------------- Währungen ------------------------------- */

/**
 * Die 20 häufigsten Währungen der Welt (inkl. Schweizer Franken).
 * Codes nach ISO 4217, Namen auf Deutsch.
 */
export const CURRENCIES = [
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "US-Dollar" },
  { code: "CHF", name: "Schweizer Franken" },
  { code: "GBP", name: "Britisches Pfund" },
  { code: "JPY", name: "Japanischer Yen" },
  { code: "CNY", name: "Chinesischer Yuan" },
  { code: "CAD", name: "Kanadischer Dollar" },
  { code: "AUD", name: "Australischer Dollar" },
  { code: "HKD", name: "Hongkong-Dollar" },
  { code: "SGD", name: "Singapur-Dollar" },
  { code: "SEK", name: "Schwedische Krone" },
  { code: "NOK", name: "Norwegische Krone" },
  { code: "DKK", name: "Dänische Krone" },
  { code: "INR", name: "Indische Rupie" },
  { code: "BRL", name: "Brasilianischer Real" },
  { code: "MXN", name: "Mexikanischer Peso" },
  { code: "ZAR", name: "Südafrikanischer Rand" },
  { code: "KRW", name: "Südkoreanischer Won" },
  { code: "PLN", name: "Polnischer Zloty" },
  { code: "TRY", name: "Türkische Lira" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const CURRENCY_CODES = CURRENCIES.map(c => c.code) as [
  CurrencyCode,
  ...CurrencyCode[],
];

export const DEFAULT_CURRENCY: CurrencyCode = "EUR";

/* ------------------------------ Dauerbuchungen ----------------------------- */

/**
 * Intervalle der Dauerbuchungen — geteilt zwischen Backend (Zod-Eingaben,
 * Drizzle-Enum, Terminrechnung) und Frontend (Auswahl, Sortierung,
 * Geldfluss-Normalisierung). Reihenfolge = Sortierreihenfolge (kurz → lang).
 *
 * `quarterly`/`semiannual` sind vor allem für Hypothekarzinsen nötig, die in
 * der Schweiz üblicherweise vierteljährlich belastet werden.
 */
export const RECURRING_INTERVALS = [
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "yearly",
] as const;

export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

export const RECURRING_INTERVAL_LABELS: Record<RecurringInterval, string> = {
  weekly: "Wöchentlich",
  monthly: "Monatlich",
  quarterly: "Vierteljährlich",
  semiannual: "Halbjährlich",
  yearly: "Jährlich",
};

/**
 * Monate pro Intervall — für Hochrechnungen auf Monatswerte.
 * `weekly` hat keine ganzzahlige Entsprechung (52/12 Wochen pro Monat) und
 * steht deshalb bewusst nicht in dieser Tabelle.
 */
export const MONTHS_PER_INTERVAL: Record<
  Exclude<RecurringInterval, "weekly">,
  number
> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

/* -------------------------------- Prognosen -------------------------------- */

/**
 * Aggregationsgröße der Prognose-Tabelle (Spaltenbreite in Monaten).
 * Bewusst eine Teilmenge von RECURRING_INTERVALS ohne `weekly`, damit die
 * Monatszahl je Periode aus MONTHS_PER_INTERVAL kommt und es keine zweite
 * Zahlentabelle gibt. Reihenfolge = Auswahlreihenfolge (kurz → lang).
 */
export const FORECAST_GRANULARITIES = [
  "monthly",
  "quarterly",
  "semiannual",
  "yearly",
] as const;

export type ForecastGranularity = (typeof FORECAST_GRANULARITIES)[number];

/**
 * Eigene Labels statt RECURRING_INTERVAL_LABELS: eine Spalte ist ein
 * „Halbjahr", nicht „Halbjährlich".
 */
export const FORECAST_GRANULARITY_LABELS: Record<ForecastGranularity, string> =
  {
    monthly: "Monat",
    quarterly: "Quartal",
    semiannual: "Halbjahr",
    yearly: "Jahr",
  };

/* ----------------------------------- Tags ---------------------------------- */

/**
 * Buntstift-Palette des Papier-Designs (docs/design/paper-like) — die eine
 * Farbauswahl für Kategorien, Tags, Projekte, Personen und Sparziele.
 * Reihenfolge fest und auf Unterscheidbarkeit bei Farbsehschwäche geprüft;
 * Slot n entspricht dem CSS-Token `--pencil-n` (hell) mit eigener Stufe im
 * Dunkelmodus. Gespeichert wird der Hex-Wert, dargestellt über
 * `src/lib/pencil.ts` (`pencil()`), das den Slot wieder auf das Token
 * abbildet und fremde Farben papiertauglich abtönt.
 */
export const PENCIL_COLORS = [
  "#2F6FC4", // Blau
  "#D9692C", // Orange
  "#1E9B73", // Grün
  "#D99A12", // Ocker
  "#D5688F", // Rosa
  "#2E8B2E", // Laubgrün
  "#6A4FB8", // Violett
  "#C9403C", // Rot
] as const;

/**
 * Farbpalette für Tags — die Farbe wird serverseitig automatisch vergeben
 * (am seltensten verwendete).
 */
export const TAG_COLORS = PENCIL_COLORS;
