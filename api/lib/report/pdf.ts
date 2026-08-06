/**
 * Bildet die gesammelten Berichtsdaten (`data.ts`) auf die Bausteine des
 * PDF-Writers (`lib/pdf.ts`) ab.
 *
 * Der Bericht ist bewusst ein **Faktenblatt**, kein Ratgeber: Er zeigt
 * Bestände, Sätze, Fristen und Kennzahlen. Die strukturierten Hinweise der
 * Module (`MortgageWarning`, `InsuranceGap`) bleiben draußen — ihre
 * deutschen Sätze baut das Frontend (`warningText`, `gapText`), und die
 * Formulierung ein zweites Mal zu pflegen hieße, sie über kurz oder lang
 * auseinanderlaufen zu lassen. Die harten Daten dahinter (Ablauf der
 * Zinsbindung, Kündigungstermin, Tragbarkeitsquote) stehen ohnehin im
 * Bericht.
 */

import { PdfDocument } from "../pdf";
import { ReportFormatter } from "./format";
import type { ReportData } from "./data";
import { REPORT_SECTION_LABELS, type ReportSection } from "@contracts/report";

export function renderReportPdf(data: ReportData, locale: string): Buffer {
  const fmt = new ReportFormatter(locale, data.currency);
  const doc = new PdfDocument(
    `Finance Fox · Bericht vom ${fmt.date(data.generatedAt)}`
  );

  doc.title("Finanzübersicht");
  doc.keyValues([
    ["Erstellt am", fmt.date(data.generatedAt)],
    ["Sicht von", `${data.viewer.name} (${data.viewer.email})`],
    ["Währung", data.currency],
  ]);
  doc.note(
    "Alle Angaben stammen aus der selbst gepflegten Haushaltsbuchhaltung " +
      "und sind keine Bestätigung einer Bank oder Versicherung. Konten, " +
      "Sparziele und Vorsorgedaten sind auf die Sicht der oben genannten " +
      "Person beschränkt."
  );

  for (const section of data.sections) {
    const reason = data.empty.find(e => e.section === section)?.reason;
    if (reason) {
      doc.heading(REPORT_SECTION_LABELS[section]);
      doc.note(reason);
      continue;
    }
    renderSection(doc, fmt, data, section);
  }

  return doc.build();
}

function renderSection(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData,
  section: ReportSection
): void {
  switch (section) {
    case "accounts":
      return renderAccounts(doc, fmt, data);
    case "goals":
      return renderGoals(doc, fmt, data);
    case "mortgages":
      return renderMortgages(doc, fmt, data);
    case "pension":
      return renderPension(doc, fmt, data);
    case "insurances":
      return renderInsurances(doc, fmt, data);
    case "cashflow":
      return renderCashflow(doc, fmt, data);
    case "recurring":
      return renderRecurring(doc, fmt, data);
    case "netWorth":
      return renderNetWorth(doc, fmt, data);
  }
}

/* --------------------------------- Konten --------------------------------- */

function renderAccounts(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData
): void {
  const s = data.accounts;
  if (!s) return;
  doc.heading(REPORT_SECTION_LABELS.accounts);
  doc.keyValues([
    ["Anzahl Konten", fmt.number(s.rows.length)],
    ["Summe der Salden", fmt.cents(s.total)],
  ]);
  doc.table(
    [
      { header: "Konto" },
      { header: "Typ" },
      { header: "Bank" },
      { header: "IBAN" },
      { header: "Besitz" },
      { header: "Saldo", align: "right" },
    ],
    s.rows.map(r => [
      r.name,
      fmt.text(r.type),
      fmt.text(r.bank),
      fmt.text(r.iban),
      r.owners,
      fmt.cents(r.balance),
    ])
  );
}

/* -------------------------------- Sparziele -------------------------------- */

function renderGoals(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData
): void {
  const s = data.goals;
  if (!s) return;
  doc.heading(REPORT_SECTION_LABELS.goals);
  doc.keyValues([
    ["Angespart insgesamt", fmt.cents(s.totalSaved)],
    ["Zielbeträge insgesamt", fmt.cents(s.totalTarget)],
  ]);
  doc.table(
    [
      { header: "Sparziel" },
      { header: "Herkunft" },
      { header: "Frist" },
      { header: "Angespart", align: "right" },
      { header: "Ziel", align: "right" },
      { header: "%", align: "right" },
    ],
    s.rows.map(r => [
      r.name,
      r.sources.length > 0 ? r.sources.join("; ") : "—",
      fmt.date(r.deadline),
      fmt.cents(r.saved),
      r.targetAmount === null ? "offen" : fmt.cents(r.targetAmount),
      r.percent === null ? "—" : fmt.percent(r.percent),
    ])
  );
  // Ohne diesen Hinweis stünde ein zu niedriger Sparstand im Bericht, ohne
  // dass er es sagt — die verborgene Quelle liegt auf einem Konto, das
  // diese Person nicht sehen darf.
  if (s.rows.some(r => r.hasHiddenSources)) {
    doc.note(
      "Bei mindestens einem Sparziel liegen Quellen auf Konten, die für " +
        "dich nicht sichtbar sind. Der ausgewiesene Stand ist daher " +
        "niedriger als der tatsächliche."
    );
  }
}

/* -------------------------------- Hypotheken ------------------------------- */

function renderMortgages(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData
): void {
  const s = data.mortgages;
  if (!s) return;
  doc.heading(REPORT_SECTION_LABELS.mortgages);
  doc.keyValues([
    ["Verkehrswert insgesamt", fmt.cents(s.totals.propertyValue)],
    ["Restschuld insgesamt", fmt.cents(s.totals.debt)],
    ["Eigenkapital in Wohneigentum", fmt.cents(s.totals.equity)],
  ]);

  for (const p of s.properties) {
    doc.subheading(p.address ? `${p.name} — ${p.address}` : p.name);
    doc.keyValues([
      ["Nutzung", p.usage],
      [
        "Kaufpreis / Verkehrswert",
        `${fmt.cents(p.purchasePrice)} / ${fmt.cents(p.marketValue)}`,
      ],
      ["Restschuld", fmt.cents(p.totalDebt)],
      ["Eigenkapital", fmt.cents(p.equity)],
      ["Belehnung", fmt.bp(p.ltvBp)],
      [
        "1. / 2. Hypothek",
        `${fmt.cents(p.firstMortgage)} / ${fmt.cents(p.secondMortgage)}`,
      ],
      ["Spielraum bis zur Maximalbelehnung", fmt.cents(p.ltvHeadroom)],
      ["Ø Zinssatz", fmt.bp(p.avgRateBp)],
      ["Zins pro Monat", fmt.cents(p.monthlyInterest)],
      ["Belastung pro Monat (Zins + Amortisation)", fmt.cents(p.monthlyBurden)],
      ["Bruttojahreseinkommen (erfasst)", fmt.cents(p.householdIncome)],
      [
        "Tragbarkeit",
        p.affordability.ratioBp === null
          ? "ohne Einkommensangabe nicht berechenbar"
          : `${fmt.bp(p.affordability.ratioBp)} — ${
              p.affordability.affordable ? "tragbar" : "nicht tragbar"
            }`,
      ],
      [
        "davon kalkulatorischer Zins pro Jahr",
        fmt.cents(p.affordability.calcInterest),
      ],
      ["davon Unterhalt pro Jahr", fmt.cents(p.affordability.maintenance)],
      [
        "davon erforderliche Amortisation pro Jahr",
        fmt.cents(p.affordability.requiredAmortization),
      ],
    ]);

    if (p.tranches.length > 0) {
      doc.table(
        [
          { header: "Tranche" },
          { header: "Art" },
          { header: "Bank" },
          { header: "Ablauf Zinsbindung" },
          { header: "Zinssatz", align: "right" },
          { header: "Zins/Jahr", align: "right" },
          { header: "Restschuld", align: "right" },
        ],
        p.tranches.map(t => [
          t.name,
          t.kind,
          fmt.text(t.bank),
          fmt.date(t.maturityDate),
          fmt.bp(t.effectiveRateBp),
          fmt.cents(t.yearlyInterest),
          fmt.cents(t.principal),
        ])
      );
    }

    if (p.amortizations.length > 0) {
      doc.table(
        [
          { header: "Amortisation" },
          { header: "Intervall" },
          { header: "Status" },
          { header: "Ende" },
          { header: "Betrag", align: "right" },
        ],
        p.amortizations.map(a => [
          a.kind,
          a.interval,
          a.active ? "aktiv" : "pausiert",
          fmt.date(a.endDate),
          fmt.cents(a.amount),
        ])
      );
    }
  }
}

/* --------------------------------- Vorsorge -------------------------------- */

function renderPension(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData
): void {
  const s = data.pension;
  if (!s) return;
  doc.heading(REPORT_SECTION_LABELS.pension);
  doc.keyValues([
    ["Pensionierung ab", fmt.date(s.retirementDate)],
    ["Aktuelles Nettoeinkommen pro Monat", fmt.cents(s.currentNet)],
    [
      "Erwartetes Einkommen im Alter pro Monat",
      fmt.cents(s.monthlyRetirementIncome),
    ],
    [
      "Ersatzrate",
      s.replacementRate === null ? "—" : fmt.percent(s.replacementRate),
    ],
    [
      "AHV pro Monat",
      `${fmt.cents(s.ahv.monthlyPension)}${s.ahv.estimated ? " (geschätzt)" : ""}`,
    ],
    [
      "Säule 2 — Kapital / Rente",
      `${fmt.cents(s.pillar2.capital)} / ${fmt.cents(s.pillar2.monthlyPension)}`,
    ],
    [
      "Säule 3a — Kapital / Entnahme",
      `${fmt.cents(s.pillar3.capital)} / ${fmt.cents(s.pillar3.monthlyWithdrawal)}`,
    ],
  ]);

  if (s.funds.length > 0) {
    doc.table(
      [
        { header: "Vorsorgeeinrichtung" },
        { header: "Kapital bei Pensionierung", align: "right" },
        { header: "Rente pro Monat", align: "right" },
      ],
      s.funds.map(f => [
        f.name,
        fmt.cents(f.capital),
        fmt.cents(f.monthlyPension),
      ])
    );
  }

  if (s.series.length > 0) {
    doc.table(
      [
        { header: "Jahr" },
        { header: "Säule 2", align: "right" },
        { header: "Säule 3a", align: "right" },
        { header: "Gesamt", align: "right" },
      ],
      s.series.map(p => [
        String(p.year),
        fmt.cents(p.pillar2),
        fmt.cents(p.pillar3),
        fmt.cents(p.total),
      ])
    );
  }
  doc.note(
    "Die Altersprognose ist eine Modellrechnung mit den hinterlegten " +
      "Sätzen und keine Zusage einer Vorsorgeeinrichtung."
  );
}

/* ------------------------------ Versicherungen ----------------------------- */

function renderInsurances(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData
): void {
  const s = data.insurances;
  if (!s) return;
  doc.heading(REPORT_SECTION_LABELS.insurances);
  doc.keyValues([
    [
      "Policen (davon aktiv)",
      `${fmt.number(s.totals.count)} (${fmt.number(s.totals.activeCount)})`,
    ],
    ["Prämien pro Monat", fmt.cents(s.totals.premiumMonthly)],
    ["Prämien pro Jahr", fmt.cents(s.totals.premiumYearly)],
  ]);
  doc.table(
    [
      { header: "Police" },
      { header: "Sparte" },
      { header: "Versicherer" },
      { header: "Versichert" },
      { header: "Status" },
      { header: "Kündigen bis" },
      { header: "Prämie/Jahr", align: "right" },
    ],
    s.rows.map(p => [
      p.name,
      p.branch,
      fmt.text(p.insurer),
      p.persons,
      p.status,
      fmt.date(p.cancelBy),
      fmt.cents(p.premiumYearly),
    ])
  );

  const withCoverages = s.rows.filter(p => p.coverages.length > 0);
  if (withCoverages.length > 0) {
    doc.subheading("Deckungen");
    doc.table(
      [
        { header: "Police" },
        { header: "Deckung" },
        { header: "Deckungssumme", align: "right" },
      ],
      withCoverages.flatMap(p =>
        p.coverages.map(c => [
          p.name,
          c.label,
          // NULL heißt bei Deckungen „unbegrenzt", nicht „unbekannt"
          c.sumInsured === null ? "unbegrenzt" : fmt.cents(c.sumInsured),
        ])
      )
    );
  }
}

/* --------------------------------- Cashflow -------------------------------- */

function renderCashflow(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData
): void {
  const s = data.cashflow;
  if (!s) return;
  doc.heading(REPORT_SECTION_LABELS.cashflow);
  doc.keyValues([
    ["Einnahmen (12 Monate)", fmt.cents(s.totals.income)],
    ["Ausgaben (12 Monate)", fmt.cents(s.totals.expense)],
    ["Saldo (12 Monate)", fmt.cents(s.totals.net)],
    ["Ø Einnahmen pro Monat", fmt.cents(s.average.income)],
    ["Ø Ausgaben pro Monat", fmt.cents(s.average.expense)],
    ["Ø Sparbetrag pro Monat", fmt.cents(s.average.net)],
  ]);
  doc.table(
    [
      { header: "Monat" },
      { header: "Einnahmen", align: "right" },
      { header: "Ausgaben", align: "right" },
      { header: "Saldo", align: "right" },
    ],
    s.months.map(m => [
      fmt.month(m.month),
      fmt.cents(m.income),
      fmt.cents(m.expense),
      fmt.cents(m.net),
    ])
  );

  if (s.categories.length > 0) {
    doc.subheading("Ausgaben je Oberkategorie");
    doc.table(
      [
        { header: "Kategorie" },
        { header: "Anteil", align: "right" },
        { header: "12 Monate", align: "right" },
        { header: "Ø pro Monat", align: "right" },
      ],
      s.categories.map(c => [
        c.name,
        s.totals.expense > 0
          ? fmt.percent(Math.round((c.amount / s.totals.expense) * 100))
          : "—",
        fmt.cents(c.amount),
        fmt.cents(Math.round(c.amount / 12)),
      ])
    );
  }
  doc.note(
    "Umbuchungen zwischen eigenen Konten sind nicht enthalten — sie " +
      "verschieben Geld, ohne Einnahme oder Ausgabe zu sein."
  );
}

/* -------------------------------- Fixkosten -------------------------------- */

function renderRecurring(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData
): void {
  const s = data.recurring;
  if (!s) return;
  doc.heading(REPORT_SECTION_LABELS.recurring);
  doc.keyValues([
    ["Wiederkehrende Einnahmen pro Monat", fmt.cents(s.totals.monthlyIncome)],
    ["Wiederkehrende Ausgaben pro Monat", fmt.cents(s.totals.monthlyExpense)],
    [
      "Saldo pro Monat",
      fmt.cents(s.totals.monthlyIncome - s.totals.monthlyExpense),
    ],
  ]);
  doc.table(
    [
      { header: "Bezeichnung" },
      { header: "Art" },
      { header: "Konto" },
      { header: "Kategorie" },
      { header: "Intervall" },
      { header: "Betrag", align: "right" },
      { header: "pro Monat", align: "right" },
    ],
    s.rows.map(r => [
      `${r.note}${r.active ? "" : " (pausiert)"}`,
      TYPE_LABELS[r.type],
      r.account,
      fmt.text(r.category),
      r.interval,
      fmt.cents(r.amount),
      fmt.cents(r.monthly),
    ])
  );
  doc.note(
    "Nur aktive und nicht abgelaufene Dauerbuchungen zählen in die " +
      "Monatssummen oben."
  );
}

const TYPE_LABELS: Record<"income" | "expense" | "transfer", string> = {
  income: "Einnahme",
  expense: "Ausgabe",
  transfer: "Umbuchung",
};

/* ------------------------------ Nettovermögen ------------------------------ */

function renderNetWorth(
  doc: PdfDocument,
  fmt: ReportFormatter,
  data: ReportData
): void {
  const s = data.netWorth;
  if (!s) return;
  doc.heading(REPORT_SECTION_LABELS.netWorth);
  doc.keyValues([
    ["Kontostände heute", fmt.cents(s.balanceNow)],
    [
      "Nettovermögen heute",
      s.netWorthNow === null
        ? "ohne Wohneigentum identisch mit den Kontoständen"
        : fmt.cents(s.netWorthNow),
    ],
    ["Horizont", `${fmt.number(data.months)} Monate`],
  ]);
  // Quartalsschritte plus Endpunkt — 36 Monatszeilen wären Rauschen
  const points = s.points.filter(
    (_, i) => i % 3 === 0 || i === s.points.length - 1
  );
  doc.table(
    [
      { header: "Monat" },
      { header: "Kontostände", align: "right" },
      { header: "Nettovermögen", align: "right" },
    ],
    points.map(p => [
      fmt.month(p.month),
      fmt.cents(p.balance),
      p.netWorth === null ? "—" : fmt.cents(p.netWorth),
    ])
  );
  if (s.missingRecurring > 0) {
    doc.note(
      `${s.missingRecurring} Hypotheken-Posten haben keine Dauerbuchung — ` +
        "deren Zahlungen fehlen in der Prognose, das Nettovermögen fällt " +
        "dadurch zu optimistisch aus."
    );
  }
  doc.note(
    "Der Verkehrswert von Wohneigentum wird konstant fortgeschrieben; eine " +
      "Wertentwicklung wäre geraten, nicht gerechnet."
  );
}
