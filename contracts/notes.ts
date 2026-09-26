/**
 * Notizen so vergleichen, wie Menschen sie meinen: Groß-/Kleinschreibung und
 * Leerraum egal („ Coop “ = „coop“). Geteilt von der Aufschlüsselung nach
 * Empfänger (F7) und dem Filter `note` der Transaktionssuche — nur so zeigt
 * der Klick auf eine Zeile genau die Buchungen, die sie zählt.
 */
export const normalizeNote = (note: string): string =>
  note.trim().replace(/\s+/g, " ").toLowerCase();
