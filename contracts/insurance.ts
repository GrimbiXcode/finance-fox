/**
 * Sparten-Katalog des Versicherungs-Moduls — geteilt zwischen Backend
 * (Drizzle-Enum, Zod-Eingaben, Lückenanalyse) und Frontend (Auswahl, Labels,
 * Deckungs-Vorschläge).
 *
 * Der Katalog ist **fix und nicht benutzererweiterbar**: Eine Sparte trägt
 * Logik (`scope`, `severity`, `trigger`) und nicht nur ein Label. Eine
 * selbst angelegte Sparte wäre für den Deckungs-Check tot („warum prüft er
 * meine Sparte nicht?") oder bräuchte einen Scope-Picker im UI — Komplexität
 * für alle wegen eines Randfalls. Die Trennlinie zieht das Projekt schon
 * bei den Kontotypen: `account_types` IST erweiterbar, weil Kontotypen reine
 * Labels sind. Der Long Tail ist über die Sparte `sonstige` plus freien
 * Namen und freie Deckungs-Zeilen vollständig erfassbar.
 */

/* --------------------------------- Sparten -------------------------------- */

/**
 * Reichweite einer Sparte in der Lückenanalyse:
 * - `person`    für JEDE aktive Person des Haushalts empfohlen
 * - `household` EINMAL pro Haushalt genügt
 * - `context`   nur bei passendem `trigger` sinnvoll; ohne `trigger` meldet
 *               die Analyse nie von selbst (die Sparte existiert dann nur,
 *               damit sich die Police korrekt einordnen lässt)
 */
export type InsuranceScope = "person" | "household" | "context";

export interface InsuranceBranchDef {
  key: string;
  label: string;
  scope: InsuranceScope;
  /** Gewicht der gemeldeten Lücke */
  severity: "warn" | "info";
  /** Auslöser für `scope: "context"` — derzeit ist nur "property" auswertbar */
  trigger?: "property";
  /** Ein deutscher Satz für Lücken-Meldung und Tooltip */
  hint: string;
  /** Vorschläge für Deckungs-Zeilen (Chips im Deckungs-Dialog) */
  coverageSuggestions: readonly string[];
}

export const INSURANCE_BRANCHES = [
  {
    key: "krankenkasse_grund",
    label: "Krankenversicherung (Grund)",
    scope: "person",
    severity: "warn",
    hint: "Die Grundversicherung ist obligatorisch — jede Person im Haushalt braucht eine.",
    coverageSuggestions: [
      "Franchise",
      "Selbstbehalt-Maximum",
      "Spitalabteilung",
      "Freie Arztwahl",
      "Versicherungsmodell",
    ],
  },
  {
    key: "krankenkasse_zusatz",
    label: "Krankenzusatz",
    scope: "context",
    severity: "info",
    hint: "Zusatzversicherungen decken, was die Grundversicherung auslässt.",
    coverageSuggestions: [
      "Ambulant",
      "Alternativmedizin",
      "Brille & Kontaktlinsen",
      "Fitness-Beitrag",
      "Auslandschutz",
      "Spital halbprivat",
      "Spital privat",
      "Transport & Rettung",
      "Zahnbehandlung",
    ],
  },
  {
    key: "unfall",
    label: "Unfallversicherung",
    scope: "person",
    severity: "warn",
    hint: "Wer weniger als 8 Stunden pro Woche angestellt ist, muss Unfall über die Krankenkasse einschließen.",
    coverageSuggestions: [
      "Heilungskosten",
      "Invaliditätskapital",
      "Todesfallkapital",
      "Taggeld",
    ],
  },
  {
    key: "privathaftpflicht",
    label: "Privathaftpflicht",
    scope: "household",
    severity: "warn",
    hint: "Deckt Schäden, die du anderen zufügst — der wichtigste Basisschutz überhaupt.",
    coverageSuggestions: [
      "Personen- & Sachschäden",
      "Mieterschäden",
      "Schlüsselverlust",
      "Selbstbehalt",
    ],
  },
  {
    key: "hausrat",
    label: "Hausrat",
    scope: "household",
    severity: "warn",
    hint: "Deckt dein bewegliches Eigentum bei Feuer, Wasser und Diebstahl.",
    coverageSuggestions: [
      "Feuer & Elementar",
      "Diebstahl zu Hause",
      "Einfacher Diebstahl auswärts",
      "Wasser",
      "Glasbruch",
      "Wertsachen",
    ],
  },
  {
    key: "rechtsschutz",
    label: "Rechtsschutz",
    scope: "household",
    severity: "info",
    hint: "Übernimmt Anwalts- und Gerichtskosten bei Streitigkeiten.",
    coverageSuggestions: [
      "Privatrechtsschutz",
      "Verkehrsrechtsschutz",
      "Deckungssumme pro Fall",
      "Freie Anwaltswahl",
    ],
  },
  {
    key: "gebaeude",
    label: "Gebäudeversicherung",
    scope: "context",
    severity: "warn",
    trigger: "property",
    hint: "Für Wohneigentum obligatorisch bzw. von der Bank verlangt.",
    coverageSuggestions: [
      "Feuer & Elementar",
      "Wasser",
      "Glas Gebäude",
      "Gebäudehaftpflicht",
      "Neuwertentschädigung",
    ],
  },
  {
    key: "motorfahrzeug",
    label: "Motorfahrzeug",
    scope: "context",
    severity: "info",
    hint: "Haftpflicht ist für jedes Fahrzeug Pflicht, Kasko freiwillig.",
    coverageSuggestions: [
      "Haftpflicht",
      "Teilkasko",
      "Vollkasko",
      "Insassenunfall",
      "Parkschaden",
      "Grobfahrlässigkeit",
    ],
  },
  {
    key: "reise",
    label: "Reiseversicherung",
    scope: "context",
    severity: "info",
    hint: "Annullierung und Assistance sind die beiden Deckungen, die im Ernstfall zählen.",
    coverageSuggestions: [
      "Annullierungskosten",
      "Reiseabbruch",
      "Assistance & Rückführung",
      "Heilungskosten Ausland",
      "Reisegepäck",
    ],
  },
  {
    key: "leben",
    label: "Lebensversicherung",
    scope: "context",
    severity: "info",
    hint: "Sichert Angehörige oder eine Hypothek im Todesfall ab.",
    coverageSuggestions: [
      "Todesfallkapital",
      "Erlebensfallkapital",
      "Prämienbefreiung",
    ],
  },
  {
    key: "erwerbsunfaehigkeit",
    label: "Erwerbsunfähigkeit",
    scope: "context",
    severity: "info",
    hint: "Ersetzt Einkommen, wenn du längerfristig nicht mehr arbeiten kannst.",
    coverageSuggestions: ["Jahresrente", "Wartefrist", "Leistungsdauer"],
  },
  {
    key: "zahn",
    label: "Zahnversicherung",
    scope: "context",
    severity: "info",
    hint: "Zahnbehandlungen sind in der Grundversicherung nicht gedeckt.",
    coverageSuggestions: [
      "Zahnbehandlung",
      "Kieferorthopädie",
      "Jahreslimite",
      "Selbstbehalt",
    ],
  },
  {
    key: "tier",
    label: "Tierversicherung",
    scope: "context",
    severity: "info",
    hint: "Tierhalterhaftpflicht ist in manchen Kantonen für Hunde Pflicht.",
    coverageSuggestions: [
      "Tierhalterhaftpflicht",
      "Tierkrankenkosten",
      "Jahreslimite",
    ],
  },
  {
    key: "sonstige",
    label: "Sonstige",
    scope: "context",
    severity: "info",
    hint: "Alles, was in keine der übrigen Sparten passt.",
    coverageSuggestions: [],
  },
] as const satisfies readonly InsuranceBranchDef[];

export type InsuranceBranch = (typeof INSURANCE_BRANCHES)[number]["key"];

/**
 * Enum-Tupel für Drizzle und Zod — abgeleitet aus dem Katalog, damit beide
 * nicht auseinanderlaufen (Muster: CURRENCY_CODES in types.ts).
 */
export const INSURANCE_BRANCH_KEYS = INSURANCE_BRANCHES.map(b => b.key) as [
  InsuranceBranch,
  ...InsuranceBranch[],
];

function branchMaps() {
  const byKey = {} as Record<InsuranceBranch, InsuranceBranchDef>;
  const labels = {} as Record<InsuranceBranch, string>;
  for (const b of INSURANCE_BRANCHES) {
    byKey[b.key] = b;
    labels[b.key] = b.label;
  }
  return { byKey, labels };
}

export const INSURANCE_BRANCH_BY_KEY = branchMaps().byKey;
export const INSURANCE_BRANCH_LABELS = branchMaps().labels;

/* --------------------------------- Status --------------------------------- */

/**
 * `quote` = Angebot/Offerte: zählt NICHT in die Prämiensummen und NICHT als
 * Deckung in der Lückenanalyse, erscheint aber in der Vergleichsansicht —
 * genau dafür vergleicht man ja: die neue Offerte neben der laufenden Police.
 *
 * Werte englisch wie überall im Projekt; die deutsche Beschriftung läuft über
 * INSURANCE_STATUS_LABELS (Muster: USAGE_LABELS, TRANCHE_KIND_LABELS).
 */
export const INSURANCE_STATUS = [
  "active",
  "cancelled",
  "expired",
  "quote",
] as const;

export type InsuranceStatus = (typeof INSURANCE_STATUS)[number];

export const INSURANCE_STATUS_LABELS: Record<InsuranceStatus, string> = {
  active: "Aktiv",
  cancelled: "Gekündigt",
  expired: "Abgelaufen",
  quote: "Angebot",
};

/* ------------------------------ Verlängerung ------------------------------ */

/**
 * `auto`  verlängert sich stillschweigend, Termin ist der Hauptverfall
 * `fixed` läuft zu einem festen Datum aus (Reise, befristete Verträge)
 */
export const INSURANCE_RENEWALS = ["auto", "fixed"] as const;

export type InsuranceRenewal = (typeof INSURANCE_RENEWALS)[number];

export const INSURANCE_RENEWAL_LABELS: Record<InsuranceRenewal, string> = {
  auto: "Verlängert sich automatisch",
  fixed: "Befristet",
};
