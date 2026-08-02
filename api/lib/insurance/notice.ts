/**
 * Fristen-Rechnung der Versicherungen — rein, ohne DB-Zugriff.
 *
 * Eigene Datei, weil drei Aufrufer dieselbe Rechnung brauchen: die
 * Policen-Liste (Karten-Anzeige), die Lückenanalyse (`gaps.ts`) und die
 * Cron-Erinnerung (`noticeReminder.ts`). Muster: `lib/recurringSchedule.ts`.
 *
 * Die Datumsarithmetik rechnet bewusst auf den Zahlen y/m/d statt über
 * `Date.setMonth`/`setFullYear`: deren stiller Überlauf (31.03. − 1 Monat =
 * 03.03., 29.02. + 1 Jahr = 01.03.) ist bei `advanceDate` dokumentiert
 * akzeptiert, würde bei einer **Kündigungsfrist** aber einen ganzen
 * Vertragszyklus kosten.
 */

import type { InsuranceRenewal, InsuranceStatus } from "@contracts/insurance";

export interface NoticeInput {
  status: InsuranceStatus;
  renewal: InsuranceRenewal;
  startDate: string; // YYYY-MM-DD
  mainDueDate: string | null;
  endDate: string | null;
  noticePeriodMonths: number;
}

export interface NoticeResult {
  /** Nächster Termin ≥ heute: Hauptverfall bzw. Vertragsablauf. NULL = keiner */
  dueDate: string | null;
  /** Nächste noch **erreichbare** Kündigungsfrist (≥ heute). NULL = keine */
  cancelBy: string | null;
  /** Termin, auf den sich `cancelBy` bezieht (kann ein Jahr nach `dueDate` liegen) */
  cancelByDueDate: string | null;
  /** true, wenn die laufende Periode nicht mehr kündbar ist */
  currentPeriodMissed: boolean;
  daysUntilCancel: number | null;
  daysUntilDue: number | null;
  /** true bei `renewal = "auto"` — der Termin wiederholt sich jährlich */
  recurring: boolean;
}

const EMPTY: NoticeResult = {
  dueDate: null,
  cancelBy: null,
  cancelByDueDate: null,
  currentPeriodMissed: false,
  daysUntilCancel: null,
  daysUntilDue: null,
  recurring: false,
};

/* ------------------------------ Datums-Helfer ----------------------------- */

/** Tage im Monat (`m` 1-basiert) */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseISO(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Monate abziehen mit Klemmung auf den Monatsletzten:
 * `subMonths("2026-12-31", 3)` → `"2026-09-30"`.
 */
export function subMonths(iso: string, months: number): string {
  const [y, m, d] = parseISO(iso);
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return toISO(year, month, Math.min(d, daysInMonth(year, month)));
}

/**
 * Jahre addieren mit Schalttag-Klemmung:
 * `addYears("2024-02-29", 1)` → `"2025-02-28"`.
 */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = parseISO(iso);
  const year = y + years;
  return toISO(year, m, Math.min(d, daysInMonth(year, m)));
}

/** Tage zwischen zwei ISO-Daten (positiv = `to` liegt in der Zukunft) */
export function daysBetween(from: string, to: string): number {
  // T12:00:00 wie in mortgage/maturityNotice.ts — schützt gegen DST-Sprünge
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/* -------------------------------- Rechnung -------------------------------- */

function result(
  partial: Partial<NoticeResult>,
  today: string,
  recurring: boolean
): NoticeResult {
  const dueDate = partial.dueDate ?? null;
  const cancelBy = partial.cancelBy ?? null;
  return {
    dueDate,
    cancelBy,
    cancelByDueDate: partial.cancelByDueDate ?? null,
    currentPeriodMissed: partial.currentPeriodMissed ?? false,
    daysUntilCancel: cancelBy === null ? null : daysBetween(today, cancelBy),
    daysUntilDue: dueDate === null ? null : daysBetween(today, dueDate),
    recurring,
  };
}

/**
 * Nächster Termin und nächste erreichbare Kündigungsfrist einer Police.
 *
 * `cancelBy` ist immer der **erreichbare** Termin: Die Zahl steuert die
 * Erinnerungen, und eine Erinnerung an eine bereits verstrichene Frist ist
 * Rauschen. Für den ehrlichen Satz „Frist für den 31.12. ist verstrichen —
 * nächste Möglichkeit: …" liefert `currentPeriodMissed` das Signal.
 */
export function computeNotice(p: NoticeInput, today: string): NoticeResult {
  // Status-Gate zuerst: Angebote und abgelaufene Policen haben keine Fristen.
  if (p.status === "quote" || p.status === "expired") return { ...EMPTY };

  // Gekündigt: der Endtermin bleibt für die Anzeige interessant („endet am"),
  // aber es gibt nichts mehr zu kündigen.
  if (p.status === "cancelled") {
    return result({ dueDate: p.endDate }, today, false);
  }

  if (p.renewal === "fixed") {
    // Befristeter Vertrag: genau ein Termin, kein Vorrollen — eine verpasste
    // Frist bekommt hier keine zweite Chance.
    if (!p.endDate) return { ...EMPTY };
    const raw = subMonths(p.endDate, p.noticePeriodMonths);
    const reachable = raw >= today;
    return result(
      {
        dueDate: p.endDate,
        cancelBy: reachable ? raw : null,
        cancelByDueDate: reachable ? p.endDate : null,
        currentPeriodMissed: !reachable && p.endDate >= today,
      },
      today,
      false
    );
  }

  // Automatische Verlängerung: Anker jahresweise vorrollen, bis er heute oder
  // später liegt. `>=` ist Absicht — ein Hauptverfall heute ist der heutige.
  const anchor = p.mainDueDate ?? p.startDate;
  let dueDate = anchor;
  if (dueDate < today) {
    const [ay] = parseISO(anchor);
    const [ty] = parseISO(today);
    dueDate = addYears(anchor, Math.max(0, ty - ay));
    while (dueDate < today) dueDate = addYears(dueDate, 1);
  }

  const raw = subMonths(dueDate, p.noticePeriodMonths);
  if (raw >= today) {
    return result(
      { dueDate, cancelBy: raw, cancelByDueDate: dueDate },
      today,
      true
    );
  }

  // Frist der laufenden Periode ist durch → auf den nächsten Termin zeigen.
  const nextDue = addYears(dueDate, 1);
  return result(
    {
      dueDate,
      cancelBy: subMonths(nextDue, p.noticePeriodMonths),
      cancelByDueDate: nextDue,
      currentPeriodMissed: true,
    },
    today,
    true
  );
}
