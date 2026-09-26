import { CHART } from "@/lib/chartColors";
import { currencySymbol, getUserLocale } from "@/lib/finance";

/**
 * Papier-Thema für recharts (docs/design/paper-like): Flächen als Schraffur
 * statt Verlauf, Raster als durchgezogene Hairline, Marker mit Papierring.
 * Die Komponenten dazu (`ChartDefs`, `PaperTooltip`) liegen in
 * `components/ChartParts.tsx`; Achsen-Schrift und Legenden-Farbe kommen aus
 * `index.css` (`.recharts-…`-Regeln), die Farben aus `chartColors.ts`.
 */

/** Blattfarbe – für Marker-Ringe und Fugen zwischen Segmenten */
export const SHEET = "hsl(var(--card))";

/** Waagrechtes Hairline-Raster, keine Strichelung */
export const GRID_PROPS = {
  stroke: "hsl(var(--border))",
  vertical: false,
} as const;

/** Achsen ohne Linie und ohne Tick-Striche; Schrift siehe index.css */
export const AXIS_PROPS = { tickLine: false, axisLine: false } as const;

/** Fadenkreuz des Tooltips in Linien-/Flächendiagrammen */
export const CURSOR_LINE = {
  stroke: "hsl(var(--rule-strong))",
  strokeDasharray: "3 3",
} as const;
/** Spaltenmarkierung des Tooltips in Balkendiagrammen */
export const CURSOR_BAR = {
  fill: "hsl(var(--paper-deep))",
  fillOpacity: 0.6,
} as const;

/** Deckkraft der Schraffur-Flächen */
export const HATCH_OPACITY = 0.35;

/** Marker: gefüllt in Serienfarbe, 2-px-Ring in Blattfarbe (r ≥ 4) */
export function dotFor(color: string) {
  return { r: 4, fill: color, stroke: SHEET, strokeWidth: 2 };
}
export function activeDotFor(color: string) {
  return { r: 5, fill: color, stroke: SHEET, strokeWidth: 2 };
}

/**
 * Schraffuren: 45° für Einnahmen/Ist/Eigenkapital, 135° für Ausgaben/
 * Restschuld – die Richtung trägt das Vorzeichen auch ohne Farbe.
 */
export const HATCHES = [
  ["positive", CHART.positive, 45],
  ["negative", CHART.negative, 135],
  ["pencil-1", CHART.pencil(1), 135],
  ["pencil-7", CHART.pencil(7), 45],
  ["muted", CHART.muted, 45],
] as const;
export type HatchName = (typeof HATCHES)[number][0];

export const hatch = (name: HatchName) => `url(#hatch-${name})`;

/** Betrag in Währungseinheiten (Chart-Werte sind bereits durch 100 geteilt) */
export function moneyLabel(value: number | string) {
  return `${Number(value).toLocaleString(getUserLocale(), { minimumFractionDigits: 2 })} ${currencySymbol()}`;
}

/**
 * Y-Achse für Geldbeträge: kompakt und einzeilig („14k“, „1,2 Mio.“) statt
 * „14000 EUR“, das in der schmalen Achse auf zwei Zeilen umbrach. Die
 * Währung steht im Tooltip; Werte sind bereits durch 100 geteilt.
 */
export function axisMoney(value: number) {
  const abs = Math.abs(value);
  const fmt = (n: number, digits: number) =>
    n.toLocaleString(getUserLocale(), { maximumFractionDigits: digits });
  if (abs >= 1_000_000) return `${fmt(value / 1_000_000, 1)} Mio.`;
  if (abs >= 1_000) return `${fmt(value / 1_000, abs >= 10_000 ? 0 : 1)}k`;
  return fmt(value, 0);
}

/** Breite der Geld-Achse passend zu `axisMoney` */
export const AXIS_MONEY_WIDTH = 52;
