import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import {
  buildXlsx,
  int,
  money,
  percentBp,
  text,
  type XlsxSheet,
} from "./lib/xlsx";

/**
 * Liest die erzeugte Mappe wieder auseinander — Gegenprobe über das ZIP-
 * Format: Zeigt das Central Directory auf die richtigen Stellen, findet der
 * Parser die Einträge; stimmt die Kompression nicht, scheitert `inflateRaw`.
 */
function unzip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  // End of Central Directory steht am Dateiende (ohne Kommentar: 22 Bytes)
  const eocd = buffer.length - 22;
  expect(buffer.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf-8");

    expect(buffer.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + extraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    files.set(name, inflateRawSync(raw).toString("utf-8"));
    offset += 46 + nameLength;
  }
  return files;
}

const sample: XlsxSheet[] = [
  {
    name: "Konten",
    columns: [{ header: "Konto" }, { header: "Saldo" }, { header: "Anteil" }],
    rows: [
      [text("Gemeinschaftskonto"), money(123456), percentBp(6500)],
      [text("Sparkonto"), money(-4550), null],
    ],
  },
  {
    name: "Kennzahlen",
    columns: [{ header: "Kennzahl" }, { header: "Wert" }],
    rows: [[text("Anzahl Konten"), int(2)]],
  },
];

describe("XLSX-Writer", () => {
  it("schreibt ein lesbares ZIP mit allen Pflichtteilen", () => {
    const files = unzip(buildXlsx(sample));
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(buildXlsx(sample).subarray(0, 4).toString("latin1")).toBe(
      "PK\x03\x04"
    );
  });

  it("legt Beträge als Zahl ab, nicht als Text", () => {
    const sheet = unzip(buildXlsx(sample)).get("xl/worksheets/sheet1.xml")!;
    // 123456 Cent → 1234.56 Währungseinheiten, mit Betragsformat (s="2")
    expect(sheet).toContain('<c r="B2" s="2"><v>1234.56</v></c>');
    expect(sheet).toContain('<c r="B3" s="2"><v>-45.5</v></c>');
    // 6500 Basispunkte → 65 %
    expect(sheet).toContain('<c r="C2" s="3"><v>65</v></c>');
    expect(sheet).not.toContain('<c r="B2" t="inlineStr"');
  });

  it("lässt leere Zellen weg, statt sie als Nullwert zu schreiben", () => {
    const sheet = unzip(buildXlsx(sample)).get("xl/worksheets/sheet1.xml")!;
    expect(sheet).not.toContain('r="C3"');
  });

  it("friert die Kopfzeile ein und setzt Spaltenbreiten", () => {
    const sheet = unzip(buildXlsx(sample)).get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<col min="1" max="1" width="18"');
    expect(sheet).toContain(`<c r="A1" s="1" t="inlineStr"><is><t>Konto</t>`);
  });

  it("meldet jedes Blatt in Workbook, Rels und Content-Types an", () => {
    const files = unzip(buildXlsx(sample));
    expect(files.get("xl/workbook.xml")).toContain('name="Konten"');
    expect(files.get("xl/workbook.xml")).toContain('name="Kennzahlen"');
    expect(files.get("xl/_rels/workbook.xml.rels")).toContain(
      "worksheets/sheet2.xml"
    );
    // Styles bekommen die nächste freie rId, sonst findet Excel sie nicht
    expect(files.get("xl/_rels/workbook.xml.rels")).toContain(
      'Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"'
    );
    expect(files.get("[Content_Types].xml")).toContain(
      "/xl/worksheets/sheet2.xml"
    );
  });

  it("escaped Sonderzeichen und entschärft unerlaubte Blattnamen", () => {
    const files = unzip(
      buildXlsx([
        {
          name: "Konten/Salden [2026] mit einem sehr langen Namen",
          columns: [{ header: "Name & Zweck" }],
          rows: [[text('Konto "A" <privat> & Co')]],
        },
        {
          name: "Konten/Salden [2026] mit einem sehr langen Namen",
          columns: [],
          rows: [],
        },
      ])
    );
    const workbook = files.get("xl/workbook.xml")!;
    const names = [...workbook.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
    expect(names[0]).toHaveLength(31);
    expect(names[0]).not.toMatch(/[[\]/]/);
    expect(names[1]).not.toBe(names[0]); // Eindeutigkeit erzwungen
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain("Name &amp; Zweck");
    expect(sheet).toContain("Konto &quot;A&quot; &lt;privat&gt; &amp; Co");
  });
});
