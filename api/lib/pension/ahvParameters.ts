/**
 * Kennzahlen der schweizerischen AHV, ein Satz je **Rentenfall-Jahr**.
 *
 * Quelle sind die Merkblätter der Informationsstelle AHV/IV (www.ahv-iv.ch);
 * die Nummer steht bei jedem Block. Die Werte gehören bewusst in den Code und
 * nicht in `app_settings`: Sie tragen Logik (die Rentenformel hängt an der
 * Mindestrente, das Tabellenraster ebenso), sie ändern sich zentral gesteuert
 * alle zwei Jahre, und eine falsch gepflegte Mindestrente fiele in der
 * Oberfläche niemandem auf. Dieselbe Trennlinie wie beim fixen Sparten-Katalog
 * in `contracts/insurance.ts`.
 *
 * **Beim jährlichen Update zu prüfen** (Merkblatt 3.01, Anhang):
 * 1. Mindest-/Maximalrente und daraus Raster, Plafonierungsgrenze, Gutschrift.
 * 2. Die Tabelle der **Aufwertungsfaktoren** — sie ist auf das Jahr des
 *    Versicherungsfalls bezogen und verschiebt sich jedes Jahr um eine Zeile.
 *    Wird sie vergessen, rechnet die Engine still zu tief.
 *
 * Alle Geldbeträge in Cent, alle Sätze in Basispunkten (10000 = 100 %).
 */

export type AhvGender = "female" | "male";

export interface AhvParameters {
  /** Jahr des Rentenfalls, für das dieser Satz gilt */
  year: number;
  /** Monatliche Mindestrente bei voller Beitragsdauer (Cent) */
  minPensionMonthly: number;
  /** Monatliche Maximalrente bei voller Beitragsdauer (Cent) */
  maxPensionMonthly: number;
  /**
   * Raster der amtlichen Rententabelle (Cent). Das massgebende
   * durchschnittliche Jahreseinkommen wird auf das nächste Vielfache
   * aufgerundet — die Tabelle in Merkblatt 3.01 führt genau diese Stufen.
   */
  incomeStep: number;
  /** Plafonierungsgrenze für Ehepaare: 150 % der Maximalrente (Cent) */
  couplesCapMonthly: number;
  /**
   * Erziehungs- bzw. Betreuungsgutschrift pro Jahr = dreifache **jährliche**
   * Mindestrente (Cent). Bei Verheirateten hälftig geteilt.
   */
  creditAnnual: number;
  /**
   * Erstes IK-Eintragsjahr → Aufwertungsfaktor in Basispunkten
   * (10900 = 1,090). Jahre ohne Eintrag werden mit 10000 gerechnet.
   */
  revaluationFactorsBp: Record<number, number>;
}

/* --------------------------- Feste Verhältnisse --------------------------- */

/**
 * Gesetzlich feste Anteile der abgeleiteten Renten, bezogen auf die
 * Altersrente. Abgelesen an der Tabelle „Skala 44" in Merkblatt 3.01, in der
 * jede Spalte ein konstantes Vielfaches der Altersrente ist
 * (1'008/1'260 = 0,8 usw.) — deshalb Konstanten und keine zweite Tabelle.
 */
export const AHV_RATIOS_BP = {
  /** Witwen-/Witwerrente: 80 % der Altersrente */
  survivorSpouse: 8000,
  /** Waisen- und Kinderrente: 40 % */
  orphan: 4000,
  /** Alters-/Invalidenrente für Verwitwete: +20 %, gedeckelt bei der Maximalrente */
  widowedSupplement: 12000,
  /** Zusatzrente: 30 % */
  supplementary: 3000,
  /**
   * Deckel, wenn für dasselbe Kind zwei Waisen-/Kinderrenten zusammentreffen:
   * 60 % der maximalen Altersrente (Merkblatt 3.03 Ziffer 21).
   */
  orphanCombinedCap: 6000,
} as const;

/** Volle Beitragsdauer: Rentenskala 44 (Merkblatt 3.01 Ziffer 12) */
export const AHV_FULL_SCALE = 44;

/* ------------------------------ Referenzalter ----------------------------- */

/**
 * Referenzalter in Monaten. Männer 65; für Frauen steigt das bisherige
 * Referenzalter 64 ab 2025 schrittweise um drei Monate pro Jahrgang, ab
 * Jahrgang 1964 gilt einheitlich 65 (Merkblatt 3.01, „Auf einen Blick").
 */
export function referenceAgeMonths(
  birthYear: number,
  gender: AhvGender
): number {
  if (gender === "male") return 65 * 12;
  if (birthYear <= 1960) return 64 * 12;
  if (birthYear >= 1964) return 65 * 12;
  // 1961 → 64+3, 1962 → 64+6, 1963 → 64+9
  return 64 * 12 + (birthYear - 1960) * 3;
}

/**
 * Frauen der Jahrgänge 1961–1969 sind die „Übergangsgeneration": Sie können
 * die Rente schon ab 62 vorbeziehen, es gelten eigene günstigere
 * Kürzungssätze, und ohne Vorbezug besteht Anspruch auf einen Rentenzuschlag.
 * Beides hängt vom individuellen Einkommen ab und ist **nicht publiziert**
 * (Merkblatt 3.04 verweist auf einen Online-Rechner) — die Engine rechnet
 * deshalb mit den Standardsätzen und warnt.
 */
export function isTransitionGeneration(
  birthYear: number,
  gender: AhvGender
): boolean {
  return gender === "female" && birthYear >= 1961 && birthYear <= 1969;
}

/** Frühestmöglicher Vorbezug in Jahren vor dem Referenzalter */
export function earliestWithdrawalAgeMonths(
  birthYear: number,
  gender: AhvGender
): number {
  return isTransitionGeneration(birthYear, gender) ? 62 * 12 : 63 * 12;
}

/** Längster Aufschub: fünf Jahre (Merkblatt 3.04 Ziffer 11) */
export const MAX_DEFERRAL_MONTHS = 60;

/** Teilrente: der bezogene bzw. aufgeschobene Anteil in Prozent */
export const PARTIAL_SHARE_MIN_PCT = 20;
export const PARTIAL_SHARE_MAX_PCT = 80;

/* ------------------------- Vorbezug und Aufschub -------------------------- */

/**
 * Kürzung beim Vorbezug in Basispunkten, Index = volle Monate Vorbezug
 * (0–24). Merkblatt 3.04 Ziffer 4, Tabelle „Prozentuale Kürzung bei einem
 * Vorbezug von Jahr und Monaten".
 */
export const EARLY_REDUCTION_BP: number[] = [
  // 0 Jahre, 0–11 Monate
  0, 60, 110, 170, 230, 280, 340, 400, 450, 510, 570, 620,
  // 1 Jahr, 0–11 Monate
  680, 740, 790, 850, 910, 960, 1020, 1080, 1130, 1190, 1250, 1300,
  // 2 Jahre
  1360,
];

/**
 * Erhöhung beim Aufschub in Basispunkten. Die amtliche Tabelle (Merkblatt
 * 3.04 Ziffer 14) staffelt nach vollen Jahren und einem Monatsband
 * (0–2, 3–5, 6–8, 9–11) — deshalb hier bewusst als Matrix und nicht als
 * Monatsreihe: Zwischen Monat 0 und 2 ändert sich nichts.
 */
export const DEFERRAL_INCREASE_BP: number[][] = [
  [520, 660, 800, 940], // 1 Jahr
  [1080, 1230, 1390, 1550], // 2 Jahre
  [1710, 1880, 2050, 2220], // 3 Jahre
  [2400, 2580, 2770, 2960], // 4 Jahre
  [3150, 3150, 3150, 3150], // 5 Jahre (Maximum)
];

/* --------------------------- Parametersätze ------------------------------- */

/**
 * Stand 1. Januar 2026 (Merkblätter 3.01 und 3.04, Ausgabe November 2025).
 * Mindestrente CHF 1'260, Maximalrente CHF 2'520 — daraus folgen:
 * jährliche Mindestrente 15'120, Raster 1'512 (ein Zehntel davon),
 * Plafonierung 3'780 (150 %), Gutschrift 45'360 (dreifache Jahresmindestrente).
 */
const PARAMETERS_2026: AhvParameters = {
  year: 2026,
  minPensionMonthly: 126_000,
  maxPensionMonthly: 252_000,
  incomeStep: 151_200,
  couplesCapMonthly: 378_000,
  creditAnnual: 4_536_000,
  // Merkblatt 3.01, Anhang „Eintrittsabhängige pauschale Aufwertungsfaktoren",
  // Eintritt des Versicherungsfalles im Jahre 2026. Ab erstem IK-Eintrag 1986
  // beträgt der Faktor 1,000 und wird deshalb nicht mehr aufgeführt.
  revaluationFactorsBp: {
    1977: 10_900,
    1978: 10_790,
    1979: 10_670,
    1980: 10_560,
    1981: 10_450,
    1982: 10_350,
    1983: 10_250,
    1984: 10_160,
    1985: 10_070,
  },
};

/** Bekannte Parametersätze, absteigend nach Gültigkeitsjahr */
const PARAMETER_SETS: AhvParameters[] = [PARAMETERS_2026];

/**
 * Parametersatz für das Jahr des Rentenfalls. Für Jahre nach dem letzten
 * gepflegten Satz gilt dieser weiter — die Rente wird dann mit den heute
 * bekannten Zahlen gerechnet, was für eine Prognose richtig ist: Künftige
 * Anpassungen an Lohn- und Preisentwicklung sind nicht vorhersehbar.
 * Für Jahre davor gilt der älteste Satz.
 */
export function ahvParametersFor(year: number): AhvParameters {
  const sorted = [...PARAMETER_SETS].sort((a, b) => b.year - a.year);
  return sorted.find(p => p.year <= year) ?? sorted[sorted.length - 1];
}

/** Jährliche Mindestrente (Cent) — Basis von Raster und Gutschriften */
export function minPensionAnnual(params: AhvParameters): number {
  return params.minPensionMonthly * 12;
}

/**
 * Wendepunkt der Rentenformel: 36 × monatliche Mindestrente
 * (Art. 34 AHVG; bei einer Mindestrente von 1'260 also 45'360).
 */
export function formulaBreakpoint(params: AhvParameters): number {
  return params.minPensionMonthly * 36;
}
