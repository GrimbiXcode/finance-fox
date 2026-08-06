/**
 * Minimaler PDF-Writer für den Berichts-Export — bewusst ohne Bibliothek,
 * im selben Geist wie `lib/totp.ts` (RFC 6238 von Hand) und `lib/camt.ts`
 * (ISO-20022 ohne XML-Parser). Eine PDF-Bibliothek wäre für die paar
 * Bausteine, die ein Bericht braucht, die schwerere Lösung: Sie zieht
 * Font-Dateien und ein Rendering-Modell ins Server-Bundle, von dem hier
 * nichts gebraucht wird.
 *
 * Erzeugt wird PDF 1.4 mit den Standardschriften Helvetica/Helvetica-Bold/
 * Helvetica-Oblique in WinAnsiEncoding (Metrik und Kodierung: `pdfFont.ts`).
 * Content-Streams bleiben **unkomprimiert** — ein Bericht besteht aus
 * Aggregaten, nicht aus Rohdaten, und bleibt damit klein genug, dass sich
 * Debuggen und Testen gegen lesbaren Inhalt mehr lohnt als ein paar
 * gesparte Kilobyte.
 *
 * Zwei Ebenen: `PdfDocument` kennt Seiten, Cursor und Satzspiegel und bietet
 * `heading`/`keyValues`/`table`/… an; die PDF-Syntax selbst steckt in den
 * privaten `op*`-Methoden und in `build()`.
 */

import { fitBytes, pdfLiteral, toWinAnsi, widthOf, wrapBytes } from "./pdfFont";

/* ------------------------------ Seitenmaße ------------------------------- */

/** A4 in Punkt (72 dpi) */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
/** Unterkante des Satzspiegels — darunter beginnt die Fußzeile */
const CONTENT_BOTTOM = MARGIN + 28;

const FONT_REGULAR = "F1";
const FONT_BOLD = "F2";
const FONT_ITALIC = "F3";

/* ------------------------------- Öffentlich ------------------------------ */

export type PdfAlign = "left" | "right";

export interface PdfColumn {
  header: string;
  align?: PdfAlign;
}

interface TextOptions {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  /** Graustufe 0 (schwarz) bis 1 (weiß) */
  gray?: number;
  align?: PdfAlign;
}

export class PdfDocument {
  /** Fertige Seiten (Content-Stream-Operatoren, ohne Fußzeile) */
  private pages: string[][] = [];
  private current: string[] = [];
  /** Cursor: Abstand von der Seitenoberkante in Punkt */
  private y = MARGIN;
  private readonly footerLeft: string;

  constructor(footerLeft: string) {
    this.footerLeft = footerLeft;
    this.pages.push(this.current);
  }

  /* ------------------------------ Bausteine ------------------------------ */

  /** Dokumenttitel (einmal ganz oben) */
  title(text: string): void {
    this.ensureSpace(34);
    this.drawText(text, MARGIN, { size: 22, bold: true });
    this.y += 30;
  }

  /** Abschnittsüberschrift mit Trennlinie darunter */
  heading(text: string): void {
    this.ensureSpace(40);
    this.y += 6;
    this.drawText(text, MARGIN, { size: 14, bold: true });
    this.y += 18;
    this.rule();
    this.y += 10;
  }

  /** Unterüberschrift innerhalb eines Abschnitts */
  subheading(text: string): void {
    this.ensureSpace(26);
    this.y += 4;
    this.drawText(text, MARGIN, { size: 11, bold: true });
    this.y += 16;
  }

  /** Fließtext mit automatischem Umbruch */
  paragraph(text: string, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const lines = wrapBytes(
      toWinAnsi(text),
      CONTENT_WIDTH,
      size,
      options.bold ?? false
    );
    for (const line of lines) {
      this.ensureSpace(size + 4);
      this.drawBytes(line, MARGIN, { ...options, size });
      this.y += size + 3;
    }
    this.y += 3;
  }

  /** Kleingedruckter, gedämpfter Hinweis (kursiv) */
  note(text: string): void {
    this.paragraph(text, { size: 8.5, italic: true, gray: 0.45 });
  }

  /**
   * Kennzahlenblock: Label links, Wert rechtsbündig am Satzspiegelrand.
   *
   * Der Wert bekommt den Platz, den das Label übrig lässt — eine feste
   * Aufteilung (etwa 60/40) würde erklärende Werte wie „ohne Wohneigentum
   * identisch mit den Kontoständen" mitten im Satz abschneiden.
   */
  keyValues(rows: [string, string][]): void {
    const gap = 12;
    for (const [label, value] of rows) {
      this.ensureSpace(16);
      const labelBytes = fitBytes(
        toWinAnsi(label),
        CONTENT_WIDTH * 0.6,
        10,
        false
      );
      this.drawBytes(labelBytes, MARGIN, { size: 10, gray: 0.35 });
      const valueMax = CONTENT_WIDTH - widthOf(labelBytes, 10, false) - gap;
      this.drawBytes(
        fitBytes(toWinAnsi(value), valueMax, 10, true),
        MARGIN + CONTENT_WIDTH,
        { size: 10, bold: true, align: "right" }
      );
      this.y += 15;
    }
    this.y += 4;
  }

  /**
   * Tabelle mit Kopfzeile. Nach einem Seitenumbruch wird die Kopfzeile
   * wiederholt — ohne sie wäre eine Betragsspalte auf Seite 2 nicht mehr
   * zuzuordnen.
   */
  table(columns: PdfColumn[], rows: string[][]): void {
    if (columns.length === 0) return;
    const widths = columnWidths(columns, rows);
    this.ensureSpace(40);
    this.tableHeader(columns, widths);
    for (const row of rows) {
      if (this.y + 16 > PAGE_HEIGHT - CONTENT_BOTTOM) {
        this.newPage();
        this.tableHeader(columns, widths);
      }
      let x = MARGIN;
      for (let i = 0; i < columns.length; i++) {
        const align = columns[i].align ?? "left";
        const bytes = fitBytes(
          toWinAnsi(row[i] ?? ""),
          widths[i] - 8,
          9,
          false
        );
        this.drawBytes(bytes, align === "right" ? x + widths[i] - 4 : x + 4, {
          size: 9,
          align,
        });
        x += widths[i];
      }
      this.y += 14;
      this.rule(0.93);
    }
    this.y += 8;
  }

  /** Leerraum */
  spacer(height = 10): void {
    this.y += height;
  }

  /** Erzwungener Seitenumbruch (z. B. vor einem großen Abschnitt) */
  pageBreak(): void {
    if (this.current.length > 0) this.newPage();
  }

  /** Ist auf der aktuellen Seite noch mindestens `height` Platz? */
  hasSpace(height: number): boolean {
    return this.y + height <= PAGE_HEIGHT - CONTENT_BOTTOM;
  }

  /* ------------------------------ Serialisierung ------------------------- */

  /** Fertiges Dokument als Buffer */
  build(): Buffer {
    const total = this.pages.length;
    const streams = this.pages.map((ops, index) =>
      [...ops, ...this.footerOps(index + 1, total)].join("\n")
    );

    // Objekt 1 Catalog, 2 Pages, 3–5 Fonts, danach je Seite Page + Content
    const objects: string[] = [];
    const pageObjectIds = streams.map((_, i) => 6 + i * 2);
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(
      `<< /Type /Pages /Kids [${pageObjectIds
        .map(id => `${id} 0 R`)
        .join(" ")}] /Count ${total} >>`
    );
    objects.push(font("Helvetica"));
    objects.push(font("Helvetica-Bold"));
    objects.push(font("Helvetica-Oblique"));
    streams.forEach((stream, i) => {
      const contentId = pageObjectIds[i] + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R ` +
          `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /${FONT_REGULAR} 3 0 R /${FONT_BOLD} 4 0 R ` +
          `/${FONT_ITALIC} 5 0 R >> >> /Contents ${contentId} 0 R >>`
      );
      objects.push(
        `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`
      );
    });

    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((obj, i) => {
      offsets.push(byteLength(body));
      body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefStart = byteLength(body);
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    const trailer =
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;
    return Buffer.from(body + xref + trailer, "latin1");
  }

  /* -------------------------------- Intern ------------------------------- */

  private tableHeader(columns: PdfColumn[], widths: number[]): void {
    this.op(`0.93 0.93 0.93 rg`);
    this.op(`${MARGIN} ${this.pdfY(this.y + 14)} ${CONTENT_WIDTH} 14 re f`);
    this.op(`0 g`);
    let x = MARGIN;
    for (let i = 0; i < columns.length; i++) {
      const align = columns[i].align ?? "left";
      const bytes = fitBytes(
        toWinAnsi(columns[i].header),
        widths[i] - 8,
        9,
        true
      );
      this.drawBytes(bytes, align === "right" ? x + widths[i] - 4 : x + 4, {
        size: 9,
        bold: true,
        align,
      });
      x += widths[i];
    }
    this.y += 14;
    this.rule(0.7);
  }

  /** Waagrechte Trennlinie auf Höhe des Cursors */
  private rule(gray = 0.85): void {
    this.op(`${gray} G 0.5 w`);
    this.op(
      `${MARGIN} ${this.pdfY(this.y)} m ${MARGIN + CONTENT_WIDTH} ${this.pdfY(
        this.y
      )} l S`
    );
    this.y += 3;
  }

  private drawText(text: string, x: number, options: TextOptions): void {
    this.drawBytes(toWinAnsi(text), x, options);
  }

  private drawBytes(bytes: number[], x: number, options: TextOptions): void {
    if (bytes.length === 0) return;
    const size = options.size ?? 10;
    const bold = options.bold ?? false;
    const fontName = bold
      ? FONT_BOLD
      : options.italic
        ? FONT_ITALIC
        : FONT_REGULAR;
    const left = options.align === "right" ? x - widthOf(bytes, size, bold) : x;
    const gray = options.gray ?? 0;
    this.op(`${gray} g`);
    this.op(
      `BT /${fontName} ${size} Tf 1 0 0 1 ${round(left)} ${round(
        this.pdfY(this.y + size)
      )} Tm ${pdfLiteral(bytes)} Tj ET`
    );
    this.op("0 g");
  }

  /**
   * Fußzeile in PDF-Koordinaten (von unten), damit sie unabhängig vom
   * Cursor immer an derselben Stelle sitzt. Die Gesamtseitenzahl steht erst
   * beim `build()` fest — deshalb entsteht die Fußzeile dort und nicht schon
   * beim Anlegen der Seite.
   */
  private footerOps(page: number, total: number): string[] {
    const lineY = MARGIN - 10;
    const textY = lineY - 12;
    const ops: string[] = ["0.85 G 0.5 w"];
    ops.push(`${MARGIN} ${lineY} m ${MARGIN + CONTENT_WIDTH} ${lineY} l S`);
    ops.push("0.45 g");
    const left = toWinAnsi(this.footerLeft);
    ops.push(
      `BT /${FONT_REGULAR} 8 Tf 1 0 0 1 ${MARGIN} ${textY} Tm ` +
        `${pdfLiteral(left)} Tj ET`
    );
    const right = toWinAnsi(`Seite ${page} von ${total}`);
    ops.push(
      `BT /${FONT_REGULAR} 8 Tf 1 0 0 1 ${round(
        MARGIN + CONTENT_WIDTH - widthOf(right, 8, false)
      )} ${textY} Tm ${pdfLiteral(right)} Tj ET`
    );
    ops.push("0 g");
    return ops;
  }

  /** Reicht der Platz nicht, wird umgebrochen */
  private ensureSpace(height: number): void {
    if (!this.hasSpace(height)) this.newPage();
  }

  private newPage(): void {
    this.current = [];
    this.pages.push(this.current);
    this.y = MARGIN;
  }

  private op(operator: string): void {
    this.current.push(operator);
  }

  /** Cursor (von oben) → PDF-Koordinate (von unten) */
  private pdfY(fromTop: number): number {
    return round(PAGE_HEIGHT - fromTop);
  }
}

/* -------------------------------- Helfer --------------------------------- */

/**
 * Spaltenbreiten aus dem tatsächlichen Inhalt.
 *
 * Feste Gewichte pro Tabelle wären hier eine Dauerbaustelle: Wie breit eine
 * Betragsspalte sein muss, hängt an Region und Währung — dieselbe Zahl ist
 * „112.100,00 €" (de-DE) oder „EUR 112'100.00" (de-CH). Deshalb misst die
 * Tabelle ihren Inhalt und verteilt den Satzspiegel per **Max-Min-Fairness**:
 * Spalten, die weniger als ihren gleichen Anteil brauchen, bekommen genau
 * so viel; der Rest wird unter den breiten Spalten aufgeteilt. Bleibt Platz
 * übrig, geht er an die linksbündigen (Text-)Spalten.
 */
function columnWidths(columns: PdfColumn[], rows: string[][]): number[] {
  const PADDING = 10;
  const natural = columns.map((column, i) => {
    let width = widthOf(toWinAnsi(column.header), 9, true);
    for (const row of rows) {
      width = Math.max(width, widthOf(toWinAnsi(row[i] ?? ""), 9, false));
    }
    return width + PADDING;
  });

  const order = natural
    .map((width, i) => ({ width, i }))
    .sort((a, b) => a.width - b.width);
  const out = new Array<number>(columns.length);
  let remaining = CONTENT_WIDTH;
  let left = columns.length;
  for (const { width, i } of order) {
    const fair = remaining / left;
    out[i] = Math.min(width, fair);
    remaining -= out[i];
    left--;
  }

  // Übrig gebliebene Breite auf die Textspalten verteilen, damit die Tabelle
  // den Satzspiegel füllt statt rechts auszufransen
  if (remaining > 0.5) {
    const flexible = columns
      .map((c, i) => ((c.align ?? "left") === "left" ? i : -1))
      .filter(i => i >= 0);
    const targets = flexible.length > 0 ? flexible : columns.map((_, i) => i);
    for (const i of targets) out[i] += remaining / targets.length;
  }
  return out;
}

function font(baseFont: string): string {
  return (
    `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} ` +
    `/Encoding /WinAnsiEncoding >>`
  );
}

/** Byte-Länge in latin1 — Content-Streams werden so geschrieben */
function byteLength(text: string): number {
  return Buffer.byteLength(text, "latin1");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
