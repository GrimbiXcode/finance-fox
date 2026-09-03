import {
  formatBp,
  formatCents,
  formatDate,
  formatMonth,
  getUserLocale,
} from "@/lib/finance";

/**
 * Deutsche Beschriftungen für den Konflikt-Dialog.
 *
 * Ein Konflikt zeigt Tabellen- und Spaltennamen aus der Datenbank —
 * `transactions.category_id` hilft niemandem beim Entscheiden. Hier werden
 * daraus Sätze, die man ohne Datenbankkenntnis lesen kann, und die Werte
 * werden so formatiert wie überall sonst in der App (Cent als Betrag,
 * Basispunkte als Prozent, Datum nach Systemregion).
 */

const ENTITY_LABELS: Record<string, string> = {
  users: "Person",
  accounts: "Konto",
  account_types: "Kontotyp",
  account_owners: "Konto-Besitz",
  account_permissions: "Konto-Freigabe",
  banks: "Bank",
  categories: "Kategorie",
  projects: "Projekt",
  tags: "Tag",
  transactions: "Buchung",
  transaction_splits: "Aufteilung",
  transaction_changes: "Änderungsverlauf",
  transaction_attachments: "Beleg",
  transaction_tags: "Buchungs-Tag",
  split_templates: "Aufteilungs-Vorlage",
  budgets: "Budget",
  recurring: "Dauerbuchung",
  savings_goals: "Sparziel",
  goal_contributions: "Sparziel-Einzahlung",
  goal_sources: "Sparziel-Quelle",
  pension_profiles: "Vorsorge-Profil",
  pension_salaries: "Lohn",
  pension_deductions: "Lohnabzug",
  pension_ahv: "AHV",
  pension_ahv_years: "AHV-Beitragsjahr",
  pension_funds: "Pensionskasse",
  pension_fund_tiers: "Pensionskassen-Abstufung",
  pension_pillar3: "Säule 3a",
  pension_attachments: "Vorsorge-Dokument",
  properties: "Liegenschaft",
  mortgage_tranches: "Hypothekar-Tranche",
  mortgage_amortizations: "Amortisation",
  insurance_policies: "Police",
  insurance_coverages: "Deckung",
  insurance_policy_persons: "Versicherte Person",
  insurance_attachments: "Versicherungs-Dokument",
  insurance_gap_dismissals: "Ausgeblendeter Hinweis",
  app_settings: "App-Einstellung",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  note: "Notiz",
  notes: "Notizen",
  amount: "Betrag",
  date: "Datum",
  type: "Art",
  color: "Farbe",
  email: "E-Mail",
  active: "Aktiv",
  account_id: "Konto",
  to_account_id: "Zielkonto",
  category_id: "Kategorie",
  project_id: "Projekt",
  user_id: "Person",
  initial_balance: "Anfangssaldo",
  iban: "IBAN",
  bank_id: "Bank",
  interval: "Intervall",
  next_date: "Nächste Fälligkeit",
  end_date: "Enddatum",
  start_date: "Startdatum",
  deadline: "Stichtag",
  target_amount: "Zielbetrag",
  saved_amount: "Gespart",
  period: "Zeitraum",
  rollover: "Übertrag",
  premium: "Prämie",
  premium_interval: "Prämien-Intervall",
  deductible: "Selbstbehalt",
  sum_insured: "Deckungssumme",
  insurer: "Versicherer",
  policy_number: "Policennummer",
  status: "Status",
  branch: "Sparte",
  renewal: "Verlängerung",
  notice_period_months: "Kündigungsfrist (Monate)",
  main_due_date: "Hauptfälligkeit",
  label: "Bezeichnung",
  market_value: "Verkehrswert",
  purchase_price: "Kaufpreis",
  household_income: "Haushaltseinkommen",
  principal: "Betrag",
  maturity_date: "Ablauf",
  gross_monthly: "Bruttolohn",
  valid_from: "Gültig ab",
  current_capital: "Aktuelles Kapital",
  yearly_savings: "Jährliche Sparbeiträge",
  current_balance: "Aktueller Stand",
  yearly_deposit: "Jährliche Einzahlung",
  birth_date: "Geburtsdatum",
  retirement_age: "Rentenalter",
  income: "Einkommen",
  year: "Jahr",
  quick_account_id: "Konto für die Schnellerfassung",
  value: "Wert",
  key: "Schlüssel",
};

/** Spalten, die Cent-Beträge tragen (Konvention des Projekts) */
const MONEY_FIELDS = new Set([
  "amount",
  "initial_balance",
  "target_amount",
  "saved_amount",
  "premium",
  "deductible",
  "sum_insured",
  "principal",
  "purchase_price",
  "market_value",
  "household_income",
  "gross_monthly",
  "current_capital",
  "yearly_savings",
  "current_balance",
  "yearly_deposit",
  "income",
  "insured_salary",
  "coordination_deduction",
  "buy_in_potential",
  "disability_pension",
  "death_benefit",
  "expected_monthly_pension",
]);

const DATE_FIELDS = new Set([
  "date",
  "next_date",
  "end_date",
  "start_date",
  "deadline",
  "maturity_date",
  "balance_date",
  "value_date",
  "purchase_date",
  "main_due_date",
  "birth_date",
]);

const BOOLEAN_FIELDS = new Set([
  "active",
  "can_edit",
  "builtin",
  "rollover",
  "totp_enabled",
]);

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

export function fieldLabel(column: string): string {
  return FIELD_LABELS[column] ?? column;
}

/** Ein Wert so, wie er auch sonst in der App erscheint */
export function formatFieldValue(column: string, value: unknown): string {
  // Die einzige Spalte im Schema, in der NULL „unbegrenzt" heißt und nicht
  // „nicht erfasst" (siehe db/AGENTS.md). Als „—" dargestellt würde der
  // Benutzer im Konfliktdialog eine unbegrenzte Deckung wegklicken.
  if (column === "sum_insured" && (value === null || value === undefined)) {
    return "unbegrenzt";
  }
  if (value === null || value === undefined || value === "") return "—";
  if (BOOLEAN_FIELDS.has(column)) return value ? "ja" : "nein";
  if (MONEY_FIELDS.has(column) && typeof value === "number") {
    return formatCents(value);
  }
  if (column.endsWith("_bp") && typeof value === "number") {
    return `${formatBp(value)} %`;
  }
  if (typeof value === "string" && DATE_FIELDS.has(column)) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value;
  }
  if (column === "valid_from" && typeof value === "string") {
    return formatMonth(value);
  }
  if (column.endsWith("_at") && typeof value === "number") {
    return new Date(value).toLocaleString(getUserLocale(), {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  return String(value);
}

/**
 * Kurzbeschreibung eines Datensatzes, mit der man ihn wiedererkennt —
 * „Migros · 45.30 CHF · 12.03.2026" statt „transactions #4711".
 */
export function describeRecord(
  entity: string,
  row: Record<string, unknown> | null
): string {
  if (!row) return entityLabel(entity);
  const parts: string[] = [];
  const push = (value: unknown, column?: string) => {
    if (value === null || value === undefined || value === "") return;
    parts.push(column ? formatFieldValue(column, value) : String(value));
  };

  push(row.name ?? row.label ?? row.note);
  if (typeof row.amount === "number") push(row.amount, "amount");
  if (typeof row.premium === "number") push(row.premium, "premium");
  if (typeof row.date === "string") push(row.date, "date");
  if (parts.length === 0 && typeof row.key === "string") push(row.key);
  if (parts.length === 0 && typeof row.year === "number") push(row.year);

  const description = parts.join(" · ");
  return description
    ? `${entityLabel(entity)}: ${description}`
    : entityLabel(entity);
}
