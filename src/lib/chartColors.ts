/**
 * Diagramm- und SVG-Farben aus den Papier-Tokens (src/index.css).
 *
 * recharts und Inline-Styles nehmen jeden CSS-Farbausdruck – auch
 * `hsl(var(--positive))`. So folgen Linien, Flächen und Farbpunkte dem
 * Hell-/Dunkel-Modus, ohne dass irgendwo ein Hex-Wert steht.
 *
 * Bedeutung: `positive` = Einnahme, Ist, Eigenkapital · `negative` = Ausgabe,
 * Restschuld · `warning` = Fristen, Ablauf · `muted` = Vorjahr, Nulllinie,
 * Fallback für fehlende Kategorie-/Personenfarbe · `pencil(n)` = Buntstift-
 * Slot n für Serien ohne Vorzeichen (Prognose, Säulen, Stufen).
 */
export const CHART = {
  positive: "hsl(var(--positive))",
  negative: "hsl(var(--negative))",
  warning: "hsl(var(--warning))",
  muted: "hsl(var(--muted-foreground))",
  ink: "hsl(var(--foreground))",
  pencil: (slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => `hsl(var(--pencil-${slot}))`,
} as const;
