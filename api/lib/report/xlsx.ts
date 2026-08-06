/**
 * Bildet die gesammelten Berichtsdaten (`data.ts`) auf Arbeitsblätter ab
 * (`lib/xlsx.ts`).
 *
 * Ein Blatt je Abschnitt, davor ein Blatt „Übersicht" mit den Kennzahlen
 * aller gewählten Abschnitte — das ist die Seite, die man im Gespräch
 * aufschlägt; die Detailblätter sind zum Nachrechnen.
 *
 * Anders als im PDF wird hier **nicht** formatiert: Beträge gehen als Zahl
 * durch `money()` (Cent → Währungseinheit), Prozente durch `percentBp()`.
 * Nur so kann in Excel summiert und gefiltert werden.
 */

import {
  buildXlsx,
  int,
  money,
  percent,
  percentBp,
  text,
  type XlsxCell,
  type XlsxSheet,
} from "../xlsx";
import { REPORT_SECTION_LABELS } from "@contracts/report";
import type { ReportData } from "./data";

/** Kennzahl-Zeile des Übersichtsblatts */
type Overview = [string, string, XlsxCell];

export function renderReportXlsx(data: ReportData): Buffer {
  const overview: Overview[] = [];
  const sheets: XlsxSheet[] = [];

  for (const section of data.sections) {
    const reason = data.empty.find(e => e.section === section)?.reason;
    if (reason) {
      overview.push([REPORT_SECTION_LABELS[section], reason, null]);
      continue;
    }
    switch (section) {
      case "accounts":
        addAccounts(data, overview, sheets);
        break;
      case "goals":
        addGoals(data, overview, sheets);
        break;
      case "mortgages":
        addMortgages(data, overview, sheets);
        break;
      case "pension":
        addPension(data, overview, sheets);
        break;
      case "insurances":
        addInsurances(data, overview, sheets);
        break;
      case "cashflow":
        addCashflow(data, overview, sheets);
        break;
      case "recurring":
        addRecurring(data, overview, sheets);
        break;
      case "netWorth":
        addNetWorth(data, overview, sheets);
        break;
    }
  }

  const meta: XlsxSheet = {
    name: "Übersicht",
    columns: [
      { header: "Bereich", width: 26 },
      { header: "Kennzahl", width: 46 },
      { header: "Wert", width: 20 },
    ],
    rows: [
      [text("Bericht"), text("Erstellt am"), text(data.generatedAt)],
      [
        text("Bericht"),
        text("Sicht von"),
        text(`${data.viewer.name} (${data.viewer.email})`),
      ],
      [text("Bericht"), text("Währung"), text(data.currency)],
      ...overview.map(
        ([area, label, value]) =>
          [text(area), text(label), value] satisfies XlsxCell[]
      ),
    ],
  };

  return buildXlsx([meta, ...sheets]);
}

/* --------------------------------- Konten --------------------------------- */

function addAccounts(
  data: ReportData,
  overview: Overview[],
  sheets: XlsxSheet[]
): void {
  const s = data.accounts;
  if (!s) return;
  const area = REPORT_SECTION_LABELS.accounts;
  overview.push([area, "Anzahl Konten", int(s.rows.length)]);
  overview.push([area, "Summe der Salden", money(s.total)]);
  sheets.push({
    name: "Konten",
    columns: [
      { header: "Konto", width: 30 },
      { header: "Typ" },
      { header: "Bank" },
      { header: "IBAN", width: 26 },
      { header: "Besitz", width: 24 },
      { header: "Saldo" },
    ],
    rows: s.rows.map(r => [
      text(r.name),
      text(r.type),
      text(r.bank),
      text(r.iban),
      text(r.owners),
      money(r.balance),
    ]),
  });
}

/* -------------------------------- Sparziele -------------------------------- */

function addGoals(
  data: ReportData,
  overview: Overview[],
  sheets: XlsxSheet[]
): void {
  const s = data.goals;
  if (!s) return;
  const area = REPORT_SECTION_LABELS.goals;
  overview.push([area, "Anzahl Sparziele", int(s.rows.length)]);
  overview.push([area, "Angespart insgesamt", money(s.totalSaved)]);
  overview.push([area, "Zielbeträge insgesamt", money(s.totalTarget)]);
  if (s.rows.some(r => r.hasHiddenSources)) {
    overview.push([
      area,
      "Achtung: enthält Quellen auf nicht sichtbaren Konten",
      null,
    ]);
  }
  sheets.push({
    name: "Sparziele",
    columns: [
      { header: "Sparziel", width: 30 },
      { header: "Herkunft", width: 40 },
      { header: "Frist" },
      { header: "Angespart" },
      { header: "Zielbetrag" },
      { header: "Fortschritt" },
      { header: "Verborgene Quellen" },
    ],
    rows: s.rows.map(r => [
      text(r.name),
      text(r.sources.join("; ")),
      text(r.deadline),
      money(r.saved),
      money(r.targetAmount),
      percent(r.percent),
      text(r.hasHiddenSources ? "ja" : "nein"),
    ]),
  });
}

/* -------------------------------- Hypotheken ------------------------------- */

function addMortgages(
  data: ReportData,
  overview: Overview[],
  sheets: XlsxSheet[]
): void {
  const s = data.mortgages;
  if (!s) return;
  const area = REPORT_SECTION_LABELS.mortgages;
  overview.push([
    area,
    "Verkehrswert insgesamt",
    money(s.totals.propertyValue),
  ]);
  overview.push([area, "Restschuld insgesamt", money(s.totals.debt)]);
  overview.push([area, "Eigenkapital in Wohneigentum", money(s.totals.equity)]);

  sheets.push({
    name: "Hypotheken",
    columns: [
      { header: "Liegenschaft", width: 30 },
      { header: "Adresse", width: 30 },
      { header: "Nutzung" },
      { header: "Kaufpreis" },
      { header: "Verkehrswert" },
      { header: "Restschuld" },
      { header: "Eigenkapital" },
      { header: "Belehnung" },
      { header: "1. Hypothek" },
      { header: "2. Hypothek" },
      { header: "Spielraum" },
      { header: "Ø Zins" },
      { header: "Zins/Monat" },
      { header: "Belastung/Monat" },
      { header: "Bruttoeinkommen" },
      { header: "Kalk. Zins/Jahr" },
      { header: "Unterhalt/Jahr" },
      { header: "Erf. Amortisation/Jahr" },
      { header: "Kosten/Jahr" },
      { header: "Kostenquote" },
      { header: "Tragbar" },
    ],
    rows: s.properties.map(p => [
      text(p.name),
      text(p.address),
      text(p.usage),
      money(p.purchasePrice),
      money(p.marketValue),
      money(p.totalDebt),
      money(p.equity),
      percentBp(p.ltvBp),
      money(p.firstMortgage),
      money(p.secondMortgage),
      money(p.ltvHeadroom),
      percentBp(p.avgRateBp),
      money(p.monthlyInterest),
      money(p.monthlyBurden),
      money(p.householdIncome),
      money(p.affordability.calcInterest),
      money(p.affordability.maintenance),
      money(p.affordability.requiredAmortization),
      money(p.affordability.totalCost),
      percentBp(p.affordability.ratioBp),
      text(
        p.affordability.affordable === null
          ? "unbekannt"
          : p.affordability.affordable
            ? "ja"
            : "nein"
      ),
    ]),
  });

  const tranches = s.properties.flatMap(p =>
    p.tranches.map(t => [
      text(p.name),
      text(t.name),
      text(t.kind),
      text(t.bank),
      text(t.maturityDate),
      percentBp(t.effectiveRateBp),
      money(t.yearlyInterest),
      money(t.principal),
    ])
  );
  if (tranches.length > 0) {
    sheets.push({
      name: "Tranchen",
      columns: [
        { header: "Liegenschaft", width: 26 },
        { header: "Tranche", width: 24 },
        { header: "Art" },
        { header: "Bank" },
        { header: "Ablauf Zinsbindung" },
        { header: "Zinssatz" },
        { header: "Zins/Jahr" },
        { header: "Restschuld" },
      ],
      rows: tranches,
    });
  }

  const amorts = s.properties.flatMap(p =>
    p.amortizations.map(a => [
      text(p.name),
      text(a.kind),
      text(a.interval),
      text(a.active ? "aktiv" : "pausiert"),
      text(a.endDate),
      money(a.amount),
    ])
  );
  if (amorts.length > 0) {
    sheets.push({
      name: "Amortisationen",
      columns: [
        { header: "Liegenschaft", width: 26 },
        { header: "Art" },
        { header: "Intervall" },
        { header: "Status" },
        { header: "Ende" },
        { header: "Betrag" },
      ],
      rows: amorts,
    });
  }
}

/* --------------------------------- Vorsorge -------------------------------- */

function addPension(
  data: ReportData,
  overview: Overview[],
  sheets: XlsxSheet[]
): void {
  const s = data.pension;
  if (!s) return;
  const area = REPORT_SECTION_LABELS.pension;
  overview.push([area, "Pensionierung ab", text(s.retirementDate)]);
  overview.push([
    area,
    "Erwartetes Einkommen im Alter pro Monat",
    money(s.monthlyRetirementIncome),
  ]);
  overview.push([area, "Aktuelles Netto pro Monat", money(s.currentNet)]);
  overview.push([area, "Ersatzrate", percent(s.replacementRate)]);

  sheets.push({
    name: "Vorsorge",
    columns: [
      { header: "Position", width: 34 },
      { header: "Kapital" },
      { header: "Rente pro Monat" },
      { header: "Hinweis", width: 24 },
    ],
    rows: [
      [
        text("AHV (1. Säule)"),
        null,
        money(s.ahv.monthlyPension),
        text(s.ahv.estimated ? "geschätzt" : "erfasst"),
      ],
      [
        text("Pensionskasse (2. Säule)"),
        money(s.pillar2.capital),
        money(s.pillar2.monthlyPension),
        null,
      ],
      [
        text("Säule 3a"),
        money(s.pillar3.capital),
        money(s.pillar3.monthlyWithdrawal),
        text("Entnahme über 20 Jahre"),
      ],
      ...s.funds.map(f => [
        text(`  davon ${f.name}`),
        money(f.capital),
        money(f.monthlyPension),
        null,
      ]),
      [text("Gesamt pro Monat"), null, money(s.monthlyRetirementIncome), null],
    ],
  });

  if (s.series.length > 0) {
    sheets.push({
      name: "Vorsorge-Verlauf",
      columns: [
        { header: "Jahr" },
        { header: "Säule 2" },
        { header: "Säule 3a" },
        { header: "Gesamt" },
      ],
      rows: s.series.map(p => [
        int(p.year),
        money(p.pillar2),
        money(p.pillar3),
        money(p.total),
      ]),
    });
  }
}

/* ------------------------------ Versicherungen ----------------------------- */

function addInsurances(
  data: ReportData,
  overview: Overview[],
  sheets: XlsxSheet[]
): void {
  const s = data.insurances;
  if (!s) return;
  const area = REPORT_SECTION_LABELS.insurances;
  overview.push([area, "Policen", int(s.totals.count)]);
  overview.push([area, "davon aktiv", int(s.totals.activeCount)]);
  overview.push([area, "Prämien pro Monat", money(s.totals.premiumMonthly)]);
  overview.push([area, "Prämien pro Jahr", money(s.totals.premiumYearly)]);

  sheets.push({
    name: "Versicherungen",
    columns: [
      { header: "Police", width: 30 },
      { header: "Sparte", width: 26 },
      { header: "Versicherer", width: 24 },
      { header: "Versichert", width: 22 },
      { header: "Status" },
      { header: "Beginn" },
      { header: "Ende" },
      { header: "Kündigen bis" },
      { header: "Prämie" },
      { header: "Intervall" },
      { header: "Prämie/Monat" },
      { header: "Prämie/Jahr" },
      { header: "Selbstbehalt" },
    ],
    rows: s.rows.map(p => [
      text(p.name),
      text(p.branch),
      text(p.insurer),
      text(p.persons),
      text(p.status),
      text(p.startDate),
      text(p.endDate),
      text(p.cancelBy),
      money(p.premium),
      text(p.interval),
      money(p.premiumMonthly),
      money(p.premiumYearly),
      money(p.deductible),
    ]),
  });

  const coverages = s.rows.flatMap(p =>
    p.coverages.map(c => [
      text(p.name),
      text(c.label),
      // NULL heißt „unbegrenzt" — als leere Zelle wäre es „unbekannt"
      c.sumInsured === null ? text("unbegrenzt") : money(c.sumInsured),
      text(c.note),
    ])
  );
  if (coverages.length > 0) {
    sheets.push({
      name: "Deckungen",
      columns: [
        { header: "Police", width: 30 },
        { header: "Deckung", width: 34 },
        { header: "Deckungssumme" },
        { header: "Bemerkung", width: 34 },
      ],
      rows: coverages,
    });
  }
}

/* --------------------------------- Cashflow -------------------------------- */

function addCashflow(
  data: ReportData,
  overview: Overview[],
  sheets: XlsxSheet[]
): void {
  const s = data.cashflow;
  if (!s) return;
  const area = REPORT_SECTION_LABELS.cashflow;
  overview.push([area, "Einnahmen (12 Monate)", money(s.totals.income)]);
  overview.push([area, "Ausgaben (12 Monate)", money(s.totals.expense)]);
  overview.push([area, "Saldo (12 Monate)", money(s.totals.net)]);
  overview.push([area, "Ø Sparbetrag pro Monat", money(s.average.net)]);

  sheets.push({
    name: "Cashflow",
    columns: [
      { header: "Monat" },
      { header: "Einnahmen" },
      { header: "Ausgaben" },
      { header: "Saldo" },
    ],
    rows: s.months.map(m => [
      text(m.month),
      money(m.income),
      money(m.expense),
      money(m.net),
    ]),
  });

  sheets.push({
    name: "Ausgaben je Kategorie",
    columns: [
      { header: "Oberkategorie", width: 30 },
      { header: "12 Monate" },
      { header: "Ø pro Monat" },
      { header: "Anteil" },
    ],
    rows: s.categories.map(c => [
      text(c.name),
      money(c.amount),
      money(Math.round(c.amount / 12)),
      s.totals.expense > 0
        ? percent(Math.round((c.amount / s.totals.expense) * 100))
        : null,
    ]),
  });
}

/* -------------------------------- Fixkosten -------------------------------- */

function addRecurring(
  data: ReportData,
  overview: Overview[],
  sheets: XlsxSheet[]
): void {
  const s = data.recurring;
  if (!s) return;
  const area = REPORT_SECTION_LABELS.recurring;
  overview.push([
    area,
    "Wiederkehrende Einnahmen pro Monat",
    money(s.totals.monthlyIncome),
  ]);
  overview.push([
    area,
    "Wiederkehrende Ausgaben pro Monat",
    money(s.totals.monthlyExpense),
  ]);
  overview.push([
    area,
    "Saldo pro Monat",
    money(s.totals.monthlyIncome - s.totals.monthlyExpense),
  ]);

  sheets.push({
    name: "Fixkosten",
    columns: [
      { header: "Bezeichnung", width: 34 },
      { header: "Art" },
      { header: "Konto", width: 28 },
      { header: "Kategorie" },
      { header: "Intervall" },
      { header: "Betrag" },
      { header: "pro Monat" },
      { header: "Nächster Termin" },
      { header: "Ende" },
      { header: "Status" },
    ],
    rows: s.rows.map(r => [
      text(r.note),
      text(TYPE_LABELS[r.type]),
      text(r.account),
      text(r.category),
      text(r.interval),
      money(r.amount),
      money(r.monthly),
      text(r.nextDate),
      text(r.endDate),
      text(r.active ? "aktiv" : "pausiert"),
    ]),
  });
}

const TYPE_LABELS: Record<"income" | "expense" | "transfer", string> = {
  income: "Einnahme",
  expense: "Ausgabe",
  transfer: "Umbuchung",
};

/* ------------------------------ Nettovermögen ------------------------------ */

function addNetWorth(
  data: ReportData,
  overview: Overview[],
  sheets: XlsxSheet[]
): void {
  const s = data.netWorth;
  if (!s) return;
  const area = REPORT_SECTION_LABELS.netWorth;
  overview.push([area, "Kontostände heute", money(s.balanceNow)]);
  overview.push([area, "Nettovermögen heute", money(s.netWorthNow)]);
  overview.push([area, "Horizont (Monate)", int(data.months)]);
  if (s.missingRecurring > 0) {
    overview.push([
      area,
      "Hypotheken-Posten ohne Dauerbuchung (Prognose zu optimistisch)",
      int(s.missingRecurring),
    ]);
  }
  sheets.push({
    name: "Nettovermögen",
    columns: [
      { header: "Monat" },
      { header: "Kontostände" },
      { header: "Nettovermögen" },
    ],
    rows: s.points.map(p => [
      text(p.month),
      money(p.balance),
      money(p.netWorth),
    ]),
  });
}
