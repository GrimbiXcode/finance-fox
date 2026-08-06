import { describe, expect, it } from "vitest";
import { PdfDocument } from "./lib/pdf";
import { fitBytes, textWidth, toWinAnsi, wrapBytes } from "./lib/pdfFont";

/** Rohes PDF als latin1-String — Content-Streams sind unkomprimiert */
function render(build: (doc: PdfDocument) => void): string {
  const doc = new PdfDocument("Finance Fox");
  build(doc);
  return doc.build().toString("latin1");
}

describe("WinAnsi-Kodierung", () => {
  it("bildet Umlaute, ß und € auf ihre WinAnsi-Bytes ab", () => {
    expect(toWinAnsi("äöüÄÖÜß")).toEqual([
      0xe4, 0xf6, 0xfc, 0xc4, 0xd6, 0xdc, 0xdf,
    ]);
    expect(toWinAnsi("€")).toEqual([0x80]);
  });

  it("kennt das Apostroph, das Intl für de-CH als Tausendertrenner nutzt", () => {
    const formatted = new Intl.NumberFormat("de-CH").format(1234.5);
    // Vorbedingung des Tests: de-CH gruppiert mit einem typografischen
    // Apostroph, nicht mit einem ASCII-Zeichen.
    expect(formatted).toMatch(/[’']/);
    expect(toWinAnsi(formatted)).not.toContain(0x3f);
  });

  it("macht aus schmalen Leerzeichen ein normales, aus Unbekanntem ein ?", () => {
    expect(toWinAnsi("a b")).toEqual([0x61, 0x20, 0x62]);
    expect(toWinAnsi("日")).toEqual([0x3f]);
  });

  it("schreibt den Umbuchungs-Pfeil um, statt ihn zu verlieren", () => {
    // „Giro → Sparkonto" als „Giro ? Sparkonto" wäre unverständlich
    expect(toWinAnsi("A→B")).toEqual([0x41, 0x2d, 0x3e, 0x42]);
  });

  it("rettet das echte Minuszeichen (U+2212) auf den Bindestrich", () => {
    // Je nach ICU-Version formatiert Intl negative Beträge damit — als
    // Fragezeichen im Bericht wäre der Betrag schlicht falsch lesbar.
    expect(toWinAnsi("−450")).toEqual([0x2d, 0x34, 0x35, 0x30]);
  });
});

describe("Textmaß", () => {
  it("misst Helvetica nach den AFM-Breiten", () => {
    // "A" = 667/1000 em, bei 10 pt also 6,67 pt
    expect(textWidth("A", 10)).toBeCloseTo(6.67, 2);
    expect(textWidth("A", 10, true)).toBeCloseTo(7.22, 2);
  });

  it("kürzt zu breiten Text mit Auslassungszeichen", () => {
    const bytes = fitBytes(toWinAnsi("Sehr langer Kontoname"), 40, 9, false);
    expect(bytes[bytes.length - 1]).toBe(0x85); // …
    expect(textWidth(String.fromCharCode(...bytes), 9)).toBeLessThanOrEqual(40);
  });

  it("bricht Fließtext an Leerzeichen um", () => {
    const lines = wrapBytes(
      toWinAnsi("Das ist ein längerer Satz für den Umbruch"),
      60,
      9,
      false
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(textWidth(String.fromCharCode(...line), 9)).toBeLessThanOrEqual(
        60
      );
    }
  });
});

describe("PDF-Dokument", () => {
  it("schreibt einen gültigen Rahmen mit xref und Trailer", () => {
    const pdf = render(doc => {
      doc.title("Finanzbericht");
      doc.paragraph("Ein Absatz.");
    });
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    expect(pdf).toContain("/Type /Catalog");
    expect(pdf).toContain("/Encoding /WinAnsiEncoding");
    // startxref muss auf den Beginn der xref-Tabelle zeigen
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("zählt die Seiten korrekt und nummeriert die Fußzeile", () => {
    const pdf = render(doc => {
      doc.title("Bericht");
      for (let i = 0; i < 120; i++) doc.paragraph(`Zeile ${i}`);
    });
    const count = Number(/\/Count (\d+)/.exec(pdf)![1]);
    expect(count).toBeGreaterThan(1);
    expect(pdf).toContain(`Seite 1 von ${count}`);
    expect(pdf).toContain(`Seite ${count} von ${count}`);
    // Je Seite genau ein Page-Objekt
    expect(pdf.match(/\/Type \/Page /g)?.length).toBe(count);
  });

  it("wiederholt die Tabellen-Kopfzeile nach einem Seitenumbruch", () => {
    const pdf = render(doc => {
      doc.table(
        [{ header: "Konto" }, { header: "Saldo", align: "right" }],
        Array.from({ length: 80 }, (_, i) => [`Konto ${i}`, "1'000.00"])
      );
    });
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(1);
    // "Konto" steht als Kopfzeile auf jeder Seite — mehr Treffer als Seiten
    expect(pdf.match(/\(Konto\) Tj/g)?.length).toBeGreaterThan(1);
  });

  it("escaped Klammern und Backslashes im Text", () => {
    const pdf = render(doc => doc.paragraph("Zins (fest) 50\\50"));
    expect(pdf).toContain("(Zins \\(fest\\) 50\\\\50) Tj");
  });

  it("hält die Stream-Länge mit dem tatsächlichen Inhalt synchron", () => {
    const pdf = render(doc => {
      doc.title("Übersicht");
      doc.keyValues([["Nettovermögen", "1'234'567.89"]]);
    });
    const matches = [...pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      const start = match.index! + match[0].length;
      const length = Number(match[1]);
      expect(pdf.slice(start + length, start + length + 10)).toBe(
        "\nendstream"
      );
    }
  });
});
