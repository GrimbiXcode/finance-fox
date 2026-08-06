/**
 * Minimaler XLSX-Writer für den Berichts-Export — wie `lib/pdf.ts` bewusst
 * ohne Bibliothek. Eine .xlsx ist ein ZIP aus ein paar XML-Teilen; beides
 * braucht keine Abhängigkeit: Das ZIP-Format wird hier direkt geschrieben,
 * komprimiert wird mit `deflateRawSync` aus dem eingebauten `node:zlib`.
 *
 * Der springende Punkt gegenüber dem vorhandenen CSV-Export ist, dass
 * **Beträge als Zahlen** in der Datei landen, nicht als Text: Nur so lässt
 * sich in Excel über eine Spalte summieren, filtern und weiterrechnen — und
 * genau dafür nimmt man die Mappe mit ins Bankgespräch. Deshalb nimmt
 * `money()` Cent entgegen und teilt selbst durch 100; kein Aufrufer kann die
 * Umrechnung vergessen.
 *
 * Anders als im PDF wird hier **nicht** locale-formatiert: Die Zahl steht roh
 * in der Zelle, die Darstellung übernimmt Excel über das Zahlenformat und die
 * Region des Lesers. Ein „1'234.56" als Text wäre in einer Tabelle ein Fehler,
 * kein Feature.
 */

import { deflateRawSync } from "node:zlib";

/* --------------------------------- Zellen -------------------------------- */

/** Zahlenformat einer Zelle (Index in `cellXfs` der styles.xml) */
const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_MONEY = 2;
const STYLE_PERCENT = 3;
const STYLE_INT = 4;

export type XlsxCell =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number; style: number }
  | null;

/** Textzelle */
export function text(value: string | null | undefined): XlsxCell {
  const s = (value ?? "").trim();
  return s.length === 0 ? null : { kind: "text", value: s };
}

/** Betragszelle — Eingabe in **Cent**, in der Datei steht die Währungseinheit */
export function money(cents: number | null | undefined): XlsxCell {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return null;
  }
  return { kind: "number", value: cents / 100, style: STYLE_MONEY };
}

/** Prozentzelle — Eingabe in **Basispunkten** (10000 = 100 %) */
export function percentBp(bp: number | null | undefined): XlsxCell {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return null;
  return { kind: "number", value: bp / 100, style: STYLE_PERCENT };
}

/** Prozentzelle aus einem fertigen Prozentwert (z. B. 75 für 75 %) */
export function percent(value: number | null | undefined): XlsxCell {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return { kind: "number", value, style: STYLE_PERCENT };
}

/** Ganzzahlige Zelle (Anzahlen, Jahre) */
export function int(value: number | null | undefined): XlsxCell {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return { kind: "number", value: Math.round(value), style: STYLE_INT };
}

/* --------------------------------- Blätter ------------------------------- */

export interface XlsxColumn {
  header: string;
  /** Spaltenbreite in Zeichen (Excel-Einheit); Default 18 */
  width?: number;
}

export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: XlsxCell[][];
}

/* -------------------------------- Aufbau --------------------------------- */

/** Erzeugt die vollständige .xlsx als Buffer */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  const named = uniqueSheetNames(sheets);
  const entries: ZipEntry[] = [];

  entries.push(entry("[Content_Types].xml", contentTypes(named.length)));
  entries.push(entry("_rels/.rels", rootRels()));
  entries.push(entry("xl/workbook.xml", workbookXml(named)));
  entries.push(entry("xl/_rels/workbook.xml.rels", workbookRels(named.length)));
  entries.push(entry("xl/styles.xml", stylesXml()));
  named.forEach((sheet, i) => {
    entries.push(entry(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)));
  });

  return zip(entries);
}

/* ------------------------------- XML-Teile ------------------------------- */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL_DOC =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_REL_PKG =
  "http://schemas.openxmlformats.org/package/2006/relationships";

function contentTypes(sheetCount: number): string {
  const sheetOverrides = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return (
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheetOverrides +
    `</Types>`
  );
}

function rootRels(): string {
  return (
    `${XML_HEADER}<Relationships xmlns="${NS_REL_PKG}">` +
    `<Relationship Id="rId1" Type="${NS_REL_DOC}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  );
}

function workbookXml(sheets: XlsxSheet[]): string {
  const list = sheets
    .map(
      (s, i) =>
        `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join("");
  return (
    `${XML_HEADER}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    `<sheets>${list}</sheets></workbook>`
  );
}

function workbookRels(sheetCount: number): string {
  const sheetRels = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${NS_REL_DOC}/worksheet" ` +
      `Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  return (
    `${XML_HEADER}<Relationships xmlns="${NS_REL_PKG}">${sheetRels}` +
    `<Relationship Id="rId${sheetCount + 1}" Type="${NS_REL_DOC}/styles" Target="styles.xml"/>` +
    `</Relationships>`
  );
}

/**
 * Fünf Zellformate, in derselben Reihenfolge wie die STYLE_*-Konstanten:
 * Standard, Kopfzeile (fett auf grau), Betrag, Prozent, Ganzzahl.
 * numFmtId 1 ist das eingebaute Ganzzahlformat, 164/165 sind eigene.
 */
function stylesXml(): string {
  return (
    `${XML_HEADER}<styleSheet xmlns="${NS_MAIN}">` +
    `<numFmts count="2">` +
    `<numFmt numFmtId="164" formatCode="#,##0.00"/>` +
    `<numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/>` +
    `</numFmts>` +
    `<fonts count="2">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="3">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="5">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`
    )
    .join("");

  const headerRow =
    `<row r="1">` +
    sheet.columns
      .map(
        (c, i) =>
          `<c r="${cellRef(i, 1)}" s="${STYLE_HEADER}" t="inlineStr">` +
          `<is><t>${escapeXml(c.header)}</t></is></c>`
      )
      .join("") +
    `</row>`;

  const bodyRows = sheet.rows
    .map((row, r) => {
      const rowNumber = r + 2;
      const cells = row
        .map((cell, c) => cellXml(cell, cellRef(c, rowNumber)))
        .filter(Boolean)
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return (
    `${XML_HEADER}<worksheet xmlns="${NS_MAIN}">` +
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${headerRow}${bodyRows}</sheetData></worksheet>`
  );
}

function cellXml(cell: XlsxCell, ref: string): string {
  if (cell === null) return "";
  if (cell.kind === "text") {
    return (
      `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">` +
      `${escapeXml(cell.value)}</t></is></c>`
    );
  }
  const style = cell.style === STYLE_DEFAULT ? "" : ` s="${cell.style}"`;
  return `<c r="${ref}"${style}><v>${numberXml(cell.value)}</v></c>`;
}

/**
 * Zahl ohne Exponentialschreibweise — `1e+21` liest Excel nicht als Zahl.
 * Sechs Nachkommastellen reichen: Beträge sind Cent/100, Prozente Bp/100.
 */
function numberXml(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** Spaltenindex (0-basiert) + Zeilennummer → „A1" */
function cellRef(column: number, row: number): string {
  let name = "";
  let n = column;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${name}${row}`;
}

function escapeXml(text: string): string {
  return (
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // Steuerzeichen sind in XML 1.0 nicht erlaubt — Excel meldet die Mappe
      // dann als beschädigt, statt sie zu öffnen
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

/**
 * Excel verbietet in Blattnamen `[]:*?/\`, begrenzt sie auf 31 Zeichen und
 * verlangt Eindeutigkeit — ein Verstoß macht die Mappe unlesbar, nicht nur
 * unschön. Doppelte Namen bekommen ein Zahlensuffix.
 */
function uniqueSheetNames(sheets: XlsxSheet[]): XlsxSheet[] {
  const used = new Set<string>();
  return sheets.map(sheet => {
    const base =
      sheet.name
        .replace(/[[\]:*?/\\]/g, " ")
        .trim()
        .slice(0, 31) || "Blatt";
    let name = base;
    let i = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` ${i++}`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return { ...sheet, name };
  });
}

/* ---------------------------------- ZIP ---------------------------------- */

interface ZipEntry {
  name: string;
  data: Buffer;
  compressed: Buffer;
  crc: number;
}

function entry(name: string, content: string): ZipEntry {
  const data = Buffer.from(content, "utf-8");
  return { name, data, compressed: deflateRawSync(data), crc: crc32(data) };
}

/**
 * Schreibt das ZIP: je Eintrag ein Local File Header, danach das Central
 * Directory und der End-of-Central-Directory-Record. Zeitstempel sind
 * bewusst fix (1980-01-01) — damit ist die Ausgabe reproduzierbar und in
 * Tests vergleichbar; Excel wertet sie nicht aus.
 */
function zip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf-8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // benötigte Version
    header.writeUInt16LE(0, 6); // Flags
    header.writeUInt16LE(8, 8); // Deflate
    header.writeUInt16LE(0, 10); // Uhrzeit
    header.writeUInt16LE(33, 12); // Datum: 1980-01-01
    header.writeUInt32LE(e.crc, 14);
    header.writeUInt32LE(e.compressed.length, 18);
    header.writeUInt32LE(e.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // Extra-Feld
    offsets.push(offset);
    chunks.push(header, name, e.compressed);
    offset += header.length + name.length + e.compressed.length;
  }

  const centralStart = offset;
  entries.forEach((e, i) => {
    const name = Buffer.from(e.name, "utf-8");
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // erzeugende Version
    header.writeUInt16LE(20, 6); // benötigte Version
    header.writeUInt16LE(0, 8); // Flags
    header.writeUInt16LE(8, 10); // Deflate
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(33, 14);
    header.writeUInt32LE(e.crc, 16);
    header.writeUInt32LE(e.compressed.length, 20);
    header.writeUInt32LE(e.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30); // Extra
    header.writeUInt16LE(0, 32); // Kommentar
    header.writeUInt16LE(0, 34); // Datenträger
    header.writeUInt16LE(0, 36); // interne Attribute
    header.writeUInt32LE(0, 38); // externe Attribute
    header.writeUInt32LE(offsets[i], 42);
    chunks.push(header, name);
    offset += header.length + name.length;
  });

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

/** CRC-32 (IEEE 802.3), tabellengetrieben — die Tabelle entsteht einmalig */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
