/**
 * CSV-Helfer für Export/Import von Transaktionen.
 * Format abhängig von der Locale: deutsch (de-*) → Semikolon-getrennt mit
 * Dezimalkomma (Excel-DE), sonst → Komma-getrennt mit Dezimalpunkt
 * (Excel-US). Datum YYYY-MM-DD, Zeilenenden CRLF, Quoting nach RFC 4180.
 * Der Import erkennt das Feldtrennzeichen an der Kopfzeile automatisch.
 */

/** Deutsche Locale (de-*) bzw. kein Locale-Parameter → deutsches CSV-Format */
export function isGermanLocale(locale?: string): boolean {
  return !locale || locale.toLowerCase().startsWith("de");
}

/** Feldtrennzeichen je nach Locale: de → ";" (Excel-DE), sonst "," (Excel-US) */
export function csvFieldSeparator(locale?: string): string {
  return isGermanLocale(locale) ? ";" : ",";
}

/** Dezimalzeichen für Beträge je nach Locale: de → ",", sonst "." */
export function csvDecimalSeparator(locale?: string): string {
  return isGermanLocale(locale) ? "," : ".";
}

export const CSV_HEADER = [
  "Datum",
  "Typ",
  "Betrag",
  "Kategorie",
  "Konto",
  "Zielkonto",
  "Notiz",
] as const;

export const TYPE_LABELS = {
  income: "Einnahme",
  expense: "Ausgabe",
  transfer: "Umbuchung",
} as const;

export type TxType = keyof typeof TYPE_LABELS;

/** RFC 4180: Felder mit Trennzeichen, " oder Zeilenumbruch quoten, " darin verdoppeln */
export function csvEscape(value: string, separator: string = ";"): string {
  if (value.includes(separator) || /["\r\n]/.test(value))
    return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Cent → Euro-String mit Dezimalzeichen der Locale (1234 → "12,34" bzw. "12.34") */
export function formatEuroCsv(cents: number, locale?: string): string {
  return (cents / 100).toFixed(2).replace(".", csvDecimalSeparator(locale));
}

/**
 * Euro-String → Cent. Akzeptiert Dezimalkomma und Dezimalpunkt.
 * Liefert null bei ungültigem oder nicht positivem Betrag.
 */
export function parseEuroCsv(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, "");
  if (!/^-?\d+([.,]\d{1,2})?$/.test(s)) return null;
  const value = Number(s.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** Deutsches Typ-Label → interner Typ (case-insensitiv) */
export function typeFromLabel(label: string): TxType | null {
  const l = label.trim().toLowerCase();
  if (l === "einnahme") return "income";
  if (l === "ausgabe") return "expense";
  if (l === "umbuchung") return "transfer";
  return null;
}

/** Strengere Datumsprüfung: Format YYYY-MM-DD und real existierendes Datum */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type CsvRecord = {
  fields: string[];
  /** Physikalische Startzeile des Datensatzes (1-basiert, für Fehlermeldungen) */
  line: number;
};

/**
 * Parser für CSV mit RFC-4180-Quoting (CRLF/LF, eingebettete Umbrüche).
 * Das Feldtrennzeichen wird an der Kopfzeile erkannt: enthält sie ein
 * Semikolon, gilt ";", sonst ",".
 */
export function parseCsv(text: string): CsvRecord[] {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const headerLine = input.split(/\r?\n/, 1)[0] ?? "";
  const separator = headerLine.includes(";") ? ";" : ",";
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let hasContent = false;

  const pushRecord = () => {
    fields.push(field);
    records.push({ fields, line: recordLine });
    fields = [];
    field = "";
    recordLine = line;
    hasContent = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      hasContent = true;
    } else if (ch === separator) {
      fields.push(field);
      field = "";
      hasContent = true;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      line++;
      pushRecord();
    } else {
      field += ch;
      hasContent = true;
    }
  }
  if (hasContent || field.length > 0 || fields.length > 0) pushRecord();
  return records;
}
