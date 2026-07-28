/**
 * Minimaler, defensiver Parser für camt.053-Kontoauszüge (ISO 20022,
 * Standard Schweizer Banken, zunehmend auch deutsche). Bewusst OHNE
 * XML-Bibliothek stringbasiert umgesetzt: die Struktur der Bank-XMLs ist
 * stabil genug dafür. Der Parser arbeitet namespace-agnostisch (Tags werden
 * lokal ohne Namespace-Präfix gematcht) und ist robust gegen CDATA,
 * XML-Entities, Zeilenumbrüche und abweichende Tag-Reihenfolgen.
 * Getestet gegen camt.053.001.02; neuere Varianten (001.04/001.08) nutzen
 * für die hier gelesenen Felder dieselben Tag-Namen.
 */

import { isValidIsoDate } from "./csv";

export type CamtEntry = {
  /** Buchungsdatum (BookgDt, Fallback ValDt) als YYYY-MM-DD */
  date: string;
  /** Betrag in Cent, signed: + Gutschrift (CRDT), - Belastung (DBIT) */
  amountCents: number;
  /** Bankreferenz (AcctSvcrRef), falls vorhanden */
  reference?: string;
  /** Name der Gegenpartei (Cdtr bei Belastung, Dbtr bei Gutschrift) */
  party?: string;
  /** Verwendungszweck (alle Ustrd-Elemente zusammengeführt) */
  note?: string;
};

export type CamtParseResult = {
  entries: CamtEntry[];
  /** Probleme einzelner Buchungen mit Positionshinweis (max. 20) */
  errors: string[];
};

const MAX_ERRORS = 20;

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** XML-Entities decodieren (benannte + numerische); Unbekanntes bleibt stehen */
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (match, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITY_MAP[name] ?? match;
  });
}

/** CDATA-Abschnitte durch ihren Rohinhalt ersetzen */
function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/**
 * Regex für ein Element mit optionalem Namespace-Präfix
 * (z. B. <Ntry> oder <ns2:Ntry ...>), fängt den Elementinhalt ein.
 */
function tagRe(name: string, flags = ""): RegExp {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${name}`;
  return new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`,
    flags
  );
}

/** Roher (undecodierter) Inhalt des ersten passenden Elements, sonst null */
function blockOf(haystack: string, name: string): string | null {
  return tagRe(name).exec(haystack)?.[1] ?? null;
}

/** Textinhalt des ersten passenden Elements (CDATA aufgelöst, Entities decodiert) */
function textOf(haystack: string, name: string): string | null {
  const raw = blockOf(haystack, name);
  if (raw === null) return null;
  const text = decodeEntities(stripCdata(raw)).replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/** Textinhalte ALLER passenden Elemente (z. B. mehrere Ustrd) */
function allTextsOf(haystack: string, name: string): string[] {
  const re = tagRe(name, "g");
  const out: string[] = [];
  for (let m = re.exec(haystack); m !== null; m = re.exec(haystack)) {
    const text = decodeEntities(stripCdata(m[1])).replace(/\s+/g, " ").trim();
    if (text !== "") out.push(text);
  }
  return out;
}

/** Dezimalbetrag (Punkt-Notation) → Cent, null bei ungültigem Format */
function parseAmountCents(raw: string | null): number | null {
  if (raw === null || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Parst ein camt.053-Dokument. Liefert die Buchungen (Ntry) mit Datum,
 * signed Betrag, optional Referenz/Gegenpartei/Verwendungszweck sowie
 * Fehlermeldungen für übersprungene, fehlerhafte Buchungen.
 * Ein Dokument ohne <BkToCstmrStmt> wird als klarer Fehler gemeldet.
 */
export function parseCamt053(xml: string): CamtParseResult {
  const errors: string[] = [];
  const fail = (msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };

  if (!tagRe("BkToCstmrStmt").test(xml)) {
    return {
      entries: [],
      errors: [
        "Die Datei ist kein camt.053-Kontoauszug " +
          "(kein <BkToCstmrStmt> gefunden).",
      ],
    };
  }

  const entries: CamtEntry[] = [];
  const ntryRe = tagRe("Ntry", "g");
  let index = 0;
  for (let m = ntryRe.exec(xml); m !== null; m = ntryRe.exec(xml)) {
    index++;
    const block = m[1];

    // Betrag + Vorzeichen über CdtDbtInd
    const cents = parseAmountCents(textOf(block, "Amt"));
    const indicator = textOf(block, "CdtDbtInd")?.toUpperCase();
    if (cents === null) {
      fail(`Buchung ${index}: fehlender oder ungültiger Betrag (<Amt>)`);
      continue;
    }
    if (indicator !== "CRDT" && indicator !== "DBIT") {
      fail(
        `Buchung ${index}: fehlende oder unbekannte Buchungsrichtung ` +
          `(<CdtDbtInd>)`
      );
      continue;
    }
    if (cents === 0) {
      fail(`Buchung ${index}: Betrag 0 wird nicht importiert`);
      continue;
    }

    // Buchungsdatum: BookgDt bevorzugt, Fallback ValDt; Dt oder DtTm
    const dateBlock = blockOf(block, "BookgDt") ?? blockOf(block, "ValDt");
    const dateRaw = dateBlock
      ? (textOf(dateBlock, "Dt") ?? textOf(dateBlock, "DtTm")?.slice(0, 10))
      : null;
    if (!dateRaw || !isValidIsoDate(dateRaw)) {
      fail(
        `Buchung ${index}: fehlendes oder ungültiges Buchungsdatum ` +
          `(<BookgDt>/<ValDt>)`
      );
      continue;
    }

    // Gegenpartei: bei Belastung der Zahlungsempfänger (Cdtr),
    // bei Gutschrift der Auftraggeber (Dbtr) — jeweils erster <Nm>-Treffer
    const partyBlock = blockOf(block, indicator === "CRDT" ? "Dbtr" : "Cdtr");
    const party = partyBlock ? (textOf(partyBlock, "Nm") ?? undefined) : undefined;

    entries.push({
      date: dateRaw,
      amountCents: indicator === "CRDT" ? cents : -cents,
      reference: textOf(block, "AcctSvcrRef") ?? undefined,
      party,
      note: allTextsOf(block, "Ustrd").join(" ") || undefined,
    });
  }

  return { entries, errors };
}
