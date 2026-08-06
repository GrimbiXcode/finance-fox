/**
 * Schriftmetrik und Zeichenkodierung für den PDF-Writer (`lib/pdf.ts`).
 *
 * Der Bericht kommt ohne Font-Embedding aus: Helvetica und Helvetica-Bold
 * gehören zu den 14 Standardschriften, die jeder PDF-Betrachter mitbringt.
 * Nötig sind dafür nur zwei Dinge, die hier liegen — die Zeichenbreiten
 * (für Rechtsbündigkeit, Umbruch und Truncation) und die Umsetzung von
 * JavaScript-Strings (UTF-16) nach **WinAnsiEncoding**, der Ein-Byte-
 * Kodierung, mit der die Schrift im Dokument deklariert wird.
 *
 * WinAnsi ist praktisch Latin-1 mit einem eigenen Block bei 0x80–0x9F. Damit
 * sind Umlaute, ß und € abgedeckt — und ebenso das typografische Apostroph,
 * das `Intl.NumberFormat` für de-CH als Tausendertrennzeichen einsetzt
 * (`1’234.56`). Genau daran scheitert eine naive Latin-1-Umsetzung.
 */

/** Zeichenbreiten in 1/1000 em, Index 0 = Zeichencode 32 (Leerzeichen) */
type WidthTable = { ascii: number[]; upper: number[] };

/** Helvetica, Codes 32–126 */
const HELVETICA_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];

/** Helvetica, Codes 128–255 (0 = in WinAnsi nicht belegt) */
const HELVETICA_UPPER = [
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737,
  333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834,
  834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278,
  278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722,
  722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556,
  556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556,
  556, 556, 556, 500, 556, 500,
];

/** Helvetica-Bold, Codes 32–126 */
const HELVETICA_BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];

/** Helvetica-Bold, Codes 128–255 */
const HELVETICA_BOLD_UPPER = [
  556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 889, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737,
  333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834,
  834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278,
  278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722,
  722, 667, 667, 556, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556,
  556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611,
  611, 611, 611, 556, 611, 556,
];

const REGULAR: WidthTable = { ascii: HELVETICA_ASCII, upper: HELVETICA_UPPER };
const BOLD: WidthTable = {
  ascii: HELVETICA_BOLD_ASCII,
  upper: HELVETICA_BOLD_UPPER,
};

/** Breite eines unbekannten Zeichens (entspricht dem Ersatzzeichen „?") */
const FALLBACK_WIDTH = 556;

/**
 * Der WinAnsi-Sonderblock 0x80–0x9F. Alles außerhalb davon ist Latin-1, also
 * codepunktgleich — deshalb steht hier nur, was davon abweicht.
 */
const WIN_ANSI_SPECIALS: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // ' — Tausendertrennzeichen in de-CH
  0x201c: 0x93, // "
  0x201d: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

/**
 * Leerzeichen-Varianten, die Intl je nach Region einstreut (schmales und
 * schmales geschütztes Leerzeichen). WinAnsi kennt sie nicht — sie werden
 * zum normalen Leerzeichen, nicht zum Fragezeichen. `fr-CH` gruppiert
 * beispielsweise mit U+202F.
 */
const SPACE_LIKE = new Set([0x2009, 0x202f, 0x2007, 0x2060]);

/**
 * Striche, die WinAnsi nicht kennt, aber optisch dem Bindestrich entsprechen —
 * allen voran **U+2212 MINUS SIGN**: Je nach ICU-Version setzt ihn
 * `Intl.NumberFormat` vor negative Beträge. Ohne diese Zeile stünde im
 * Bericht „CHF ?450.35" statt „CHF -450.35".
 */
const HYPHEN_LIKE = new Set([0x2212, 0x2010, 0x2011, 0x2012, 0x2015]);

/**
 * Zeichen, für die es in WinAnsi keine Entsprechung gibt, die sich aber
 * sinnvoll umschreiben lassen. Der Pfeil kommt im Bericht bei
 * Dauer-Umbuchungen vor („Giro → Sparkonto") — als „?" wäre die Zeile
 * schlicht unverständlich.
 */
const TRANSLITERATIONS: Record<number, string> = {
  0x2192: "->", // →
  0x2190: "<-", // ←
  0x2194: "<->", // ↔
  0x21d2: "=>", // ⇒
  0x2260: "!=", // ≠
  0x2264: "<=", // ≤
  0x2265: ">=", // ≥
};

/** Ersatzzeichen für alles, was WinAnsi nicht abbilden kann */
const REPLACEMENT = 0x3f; // "?"

/** Byte des Auslassungszeichens „…" — für Truncation zu breiter Texte */
export const ELLIPSIS_BYTE = 0x85;

/** UTF-16-String → WinAnsi-Bytes */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x0d) {
      out.push(0x20);
    } else if (cp < 0x20) {
      continue; // Steuerzeichen fliegen raus
    } else if (cp <= 0x7e) {
      out.push(cp);
    } else if (SPACE_LIKE.has(cp)) {
      out.push(0x20);
    } else if (HYPHEN_LIKE.has(cp)) {
      out.push(0x2d);
    } else if (WIN_ANSI_SPECIALS[cp] !== undefined) {
      out.push(WIN_ANSI_SPECIALS[cp]);
    } else if (cp >= 0xa0 && cp <= 0xff) {
      out.push(cp);
    } else if (TRANSLITERATIONS[cp] !== undefined) {
      for (const c of TRANSLITERATIONS[cp]) out.push(c.charCodeAt(0));
    } else {
      out.push(REPLACEMENT);
    }
  }
  return out;
}

/** Breite eines einzelnen WinAnsi-Bytes in 1/1000 em */
function byteWidth(code: number, bold: boolean): number {
  const table = bold ? BOLD : REGULAR;
  if (code >= 32 && code <= 126) return table.ascii[code - 32];
  if (code >= 128 && code <= 255) {
    return table.upper[code - 128] || FALLBACK_WIDTH;
  }
  return FALLBACK_WIDTH;
}

/** Breite einer WinAnsi-Bytefolge in Punkt */
export function widthOf(bytes: number[], size: number, bold: boolean): number {
  let sum = 0;
  for (const b of bytes) sum += byteWidth(b, bold);
  return (sum * size) / 1000;
}

/** Breite eines Strings in Punkt (kodiert intern nach WinAnsi) */
export function textWidth(text: string, size: number, bold = false): number {
  return widthOf(toWinAnsi(text), size, bold);
}

/**
 * Kürzt eine Bytefolge auf `maxWidth` und hängt „…" an, wenn gekürzt wurde.
 * Passt der Text, kommt er unverändert zurück.
 */
export function fitBytes(
  bytes: number[],
  maxWidth: number,
  size: number,
  bold: boolean
): number[] {
  if (widthOf(bytes, size, bold) <= maxWidth) return bytes;
  const ellipsis = widthOf([ELLIPSIS_BYTE], size, bold);
  const out: number[] = [];
  let width = 0;
  for (const b of bytes) {
    const next = width + (byteWidth(b, bold) * size) / 1000;
    if (next + ellipsis > maxWidth) break;
    out.push(b);
    width = next;
  }
  out.push(ELLIPSIS_BYTE);
  return out;
}

/**
 * Bricht eine Bytefolge an Leerzeichen auf `maxWidth` um. Ein einzelnes Wort,
 * das schon zu breit ist, wird hart gekürzt — sonst liefe es aus dem Satz-
 * spiegel (Kontonamen und IBANs können beliebig lang sein).
 */
export function wrapBytes(
  bytes: number[],
  maxWidth: number,
  size: number,
  bold: boolean
): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  const words = splitWords(bytes);
  for (const word of words) {
    const candidate = line.length === 0 ? word : [...line, 0x20, ...word];
    if (widthOf(candidate, size, bold) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    line =
      widthOf(word, size, bold) > maxWidth
        ? fitBytes(word, maxWidth, size, bold)
        : word;
  }
  if (line.length > 0) lines.push(line);
  return lines.length > 0 ? lines : [[]];
}

/** Zerlegt an Leerzeichen (0x20) und verwirft Leerfelder */
function splitWords(bytes: number[]): number[][] {
  const words: number[][] = [];
  let current: number[] = [];
  for (const b of bytes) {
    if (b === 0x20) {
      if (current.length > 0) words.push(current);
      current = [];
    } else {
      current.push(b);
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

/**
 * WinAnsi-Bytes → PDF-Literalstring inklusive Klammern. Backslash und
 * Klammern müssen escaped werden, sonst bricht der Content-Stream.
 */
export function pdfLiteral(bytes: number[]): string {
  let out = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\";
    out += String.fromCharCode(b);
  }
  return out + ")";
}
