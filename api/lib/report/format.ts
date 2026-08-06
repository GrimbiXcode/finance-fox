/**
 * Locale-Formatierung für den PDF-Bericht.
 *
 * Sonst formatiert im Projekt immer das Frontend (`src/lib/finance.ts`) —
 * hier geht das nicht, weil das PDF serverseitig entsteht. Der Präzedenzfall
 * ist `formatEuroCsv(cents, locale)` in `lib/csv.ts`: Der Client schickt
 * seine Region mit (`getUserLocale()`), der Server formatiert danach. Die
 * Währung kommt dagegen NICHT vom Client, sondern aus `app_settings` — sie
 * ist eine haushaltsweite Einstellung, keine Frage des Browsers.
 *
 * Die Excel-Mappe braucht davon nichts: Dort stehen rohe Zahlen mit
 * Zahlenformat, die Darstellung übernimmt Excel (siehe `lib/xlsx.ts`).
 */

export class ReportFormatter {
  private readonly money: Intl.NumberFormat;
  private readonly plain: Intl.NumberFormat;
  private readonly percentFmt: Intl.NumberFormat;
  private readonly dateFmt: Intl.DateTimeFormat;
  private readonly monthFmt: Intl.DateTimeFormat;

  constructor(locale: string, currency: string) {
    const safeLocale = supportedLocale(locale);
    this.money = new Intl.NumberFormat(safeLocale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    this.plain = new Intl.NumberFormat(safeLocale);
    this.percentFmt = new Intl.NumberFormat(safeLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    this.dateFmt = new Intl.DateTimeFormat(safeLocale, { dateStyle: "medium" });
    this.monthFmt = new Intl.DateTimeFormat(safeLocale, {
      month: "short",
      year: "numeric",
    });
  }

  /** Cent → Betrag mit Währung */
  cents(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "—";
    }
    return this.money.format(value / 100);
  }

  /** Ganzzahl (Anzahlen, Jahre) */
  number(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "—";
    }
    return this.plain.format(value);
  }

  /** Basispunkte → Prozent (10000 Bp = 100 %) */
  bp(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "—";
    }
    return `${this.percentFmt.format(value / 100)} %`;
  }

  /** Fertiger Prozentwert (75 → „75 %") */
  percent(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "—";
    }
    return `${this.plain.format(value)} %`;
  }

  /** ISO-Datum (YYYY-MM-DD) → regionale Schreibweise */
  date(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? iso : this.dateFmt.format(d);
  }

  /** Monatsschlüssel (YYYY-MM) → „Aug. 2026" */
  month(key: string | null | undefined): string {
    if (!key) return "—";
    const d = new Date(`${key}-01T00:00:00`);
    return Number.isNaN(d.getTime()) ? key : this.monthFmt.format(d);
  }

  /** Leerer Text → Gedankenstrich, damit Tabellenzellen nie nackt sind */
  text(value: string | null | undefined): string {
    const s = (value ?? "").trim();
    return s.length === 0 ? "—" : s;
  }
}

/**
 * Fällt auf `de-DE` zurück, wenn der Client eine unbrauchbare Locale
 * schickt — ein RangeError aus Intl würde sonst den ganzen Export
 * abbrechen, obwohl nur die Schreibweise der Zahlen betroffen wäre.
 */
function supportedLocale(locale: string): string {
  try {
    new Intl.NumberFormat(locale);
    return locale;
  } catch {
    return "de-DE";
  }
}
