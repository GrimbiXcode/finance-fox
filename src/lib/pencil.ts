import { PENCIL_COLORS } from "@contracts/types";

export { PENCIL_COLORS };

const SLOT_BY_HEX = new Map<string, number>(
  PENCIL_COLORS.map((hex, i) => [hex.toLowerCase(), i + 1])
);

/**
 * Gespeicherte Farbe → CSS-Farbe fürs Papier-Design.
 *
 * - Ein Buntstift aus `PENCIL_COLORS` wird zum Token `hsl(var(--pencil-n))`
 *   und folgt damit dem Hell-/Dunkelmodus (eigene, geprüfte Stufe im Dunkeln).
 * - Jede andere Farbe (alte Neon-Palette, frei gewählt) wird mit der
 *   Tintenfarbe abgetönt: hell dunkler und gedeckter, dunkel heller – ohne
 *   Migration der Datenbank, und ohne dass zwei verschiedene Farben
 *   zusammenfallen. Die gespeicherten Hex-Werte bleiben unverändert.
 *
 * Funktioniert in Inline-Styles wie in SVG-Attributen (recharts `fill`).
 */
export function pencil(color: string): string;
export function pencil(color: string | null | undefined): string | undefined;
export function pencil(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const slot = SLOT_BY_HEX.get(color.toLowerCase());
  if (slot) return `hsl(var(--pencil-${slot}))`;
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return `color-mix(in srgb, ${color} 72%, hsl(var(--foreground)))`;
  }
  return color;
}

/** Buntstift n (1-basiert, zyklisch) als CSS-Token – für Reihen ohne gespeicherte Farbe */
export function pencilSlot(index: number): string {
  return `hsl(var(--pencil-${((((index - 1) % PENCIL_COLORS.length) + PENCIL_COLORS.length) % PENCIL_COLORS.length) + 1}))`;
}
