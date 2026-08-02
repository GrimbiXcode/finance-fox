import {
  INSURANCE_BRANCH_LABELS,
  INSURANCE_RENEWAL_LABELS,
  INSURANCE_STATUS_LABELS,
  type InsuranceBranch,
  type InsuranceRenewal,
  type InsuranceStatus,
} from "@contracts/insurance";
import { RECURRING_INTERVAL_LABELS } from "@contracts/types";
import { formatCents, formatDate } from "@/lib/finance";

/**
 * Ableitung der Vergleichstabelle — reine Funktion, damit die Tabelle nur
 * noch rendert (Muster: `lib/moneyflow.ts`). Hält außerdem den Rückfallplan
 * offen, falls die Sticky-Spalte auf schmalen Geräten nicht taugt: eine
 * gestapelte Kartenliste würde dieselben Zeilen rendern.
 */

export interface ComparePolicy {
  id: number;
  name: string;
  branch: InsuranceBranch;
  insurer: string;
  policyNumber: string;
  status: InsuranceStatus;
  premium: number;
  premiumInterval: string;
  premiumYearly: number;
  deductible: number | null;
  startDate: string;
  renewal: InsuranceRenewal;
  mainDueDate: string | null;
  endDate: string | null;
  noticePeriodMonths: number;
  accountName: string | null;
  notice: { cancelBy: string | null };
}

export interface CompareCoverage {
  policyId: number;
  label: string;
  sumInsured: number | null;
  deductible: number | null;
}

export interface CompareRow {
  label: string;
  /** Eine Zelle je Police; null = „—" (Merkmal fehlt bei dieser Police) */
  cells: (string | null)[];
  /** Untertitel je Zelle, z. B. der abweichende Selbstbehalt einer Deckung */
  subCells?: (string | null)[];
  /** Index der Police mit dem besten Wert; null = kein sinnvoller Vergleich */
  bestIndex: number | null;
}

export interface Comparison {
  policies: ComparePolicy[];
  /** Vertrags- und Prämien-Merkmale */
  facts: CompareRow[];
  /** Eine Zeile je vereinigter Deckungs-Bezeichnung */
  coverages: CompareRow[];
}

/** „unbegrenzt" ist ein Wert, kein fehlendes Feld */
function sumText(sum: number | null): string {
  return sum === null ? "unbegrenzt" : formatCents(sum);
}

/** Index des kleinsten Werts (null-Werte zählen nicht mit) */
function indexOfMin(values: (number | null)[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v === null) continue;
    if (best === null || v < values[best]!) best = i;
  }
  // Bei Gleichstand aller Werte gibt es nichts hervorzuheben
  const seen = values.filter(v => v !== null);
  if (seen.length < 2 || new Set(seen).size === 1) return null;
  return best;
}

/**
 * Index des größten Werts. `null` steht bei Deckungssummen für
 * **unbegrenzt** und gewinnt damit immer — deshalb kein einfaches Max.
 */
function indexOfMaxSum(sums: (number | null | undefined)[]): number | null {
  const present = sums.filter(s => s !== undefined);
  if (present.length < 2) return null;
  const unlimited = sums.findIndex(s => s === null);
  if (unlimited >= 0) return unlimited;
  let best: number | null = null;
  for (let i = 0; i < sums.length; i += 1) {
    const v = sums[i];
    if (v === undefined || v === null) continue;
    if (best === null || v > (sums[best] as number)) best = i;
  }
  const values = present.filter(s => s !== null) as number[];
  if (values.length < 2 || new Set(values).size === 1) return null;
  return best;
}

export function buildComparison(
  policies: ComparePolicy[],
  coverages: CompareCoverage[]
): Comparison {
  const text = (fn: (p: ComparePolicy) => string | null): (string | null)[] =>
    policies.map(fn);

  const facts: CompareRow[] = [
    {
      label: "Sparte",
      cells: text(p => INSURANCE_BRANCH_LABELS[p.branch]),
      bestIndex: null,
    },
    {
      label: "Versicherer",
      cells: text(p => p.insurer || null),
      bestIndex: null,
    },
    {
      label: "Policennummer",
      cells: text(p => p.policyNumber || null),
      bestIndex: null,
    },
    {
      label: "Status",
      cells: text(p => INSURANCE_STATUS_LABELS[p.status]),
      bestIndex: null,
    },
    {
      label: "Prämie",
      cells: text(
        p =>
          `${formatCents(p.premium)} ${RECURRING_INTERVAL_LABELS[
            p.premiumInterval as keyof typeof RECURRING_INTERVAL_LABELS
          ].toLowerCase()}`
      ),
      bestIndex: null,
    },
    {
      label: "Prämie pro Jahr",
      cells: text(p => formatCents(p.premiumYearly)),
      // Der eigentliche Vergleichswert: normalisiert, deshalb hervorgehoben
      bestIndex: indexOfMin(policies.map(p => p.premiumYearly)),
    },
    {
      label: "Selbstbehalt",
      cells: text(p => (p.deductible === null ? null : formatCents(p.deductible))),
      bestIndex: indexOfMin(policies.map(p => p.deductible)),
    },
    {
      label: "Vertragsbeginn",
      cells: text(p => formatDate(p.startDate)),
      bestIndex: null,
    },
    {
      label: "Verlängerung",
      cells: text(p => INSURANCE_RENEWAL_LABELS[p.renewal]),
      bestIndex: null,
    },
    {
      label: "Hauptverfall / Vertragsende",
      cells: text(p => {
        const date = p.renewal === "fixed" ? p.endDate : p.mainDueDate;
        return date === null ? null : formatDate(date);
      }),
      bestIndex: null,
    },
    {
      label: "Kündigungsfrist",
      cells: text(p =>
        p.noticePeriodMonths === 0
          ? "jederzeit"
          : `${p.noticePeriodMonths} Monate`
      ),
      bestIndex: null,
    },
    {
      label: "Kündigen bis",
      cells: text(p =>
        p.notice.cancelBy === null ? null : formatDate(p.notice.cancelBy)
      ),
      bestIndex: null,
    },
    {
      label: "Belastungskonto",
      cells: text(p => p.accountName),
      bestIndex: null,
    },
  ];

  // Deckungen über alle gewählten Policen vereinigen — case-insensitiv,
  // Reihenfolge = erstes Auftreten.
  const order: string[] = [];
  const byKey = new Map<string, Map<number, CompareCoverage>>();
  const selected = new Set(policies.map(p => p.id));
  for (const c of coverages) {
    if (!selected.has(c.policyId)) continue;
    const key = c.label.trim().toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, new Map());
      order.push(key);
    }
    // Mehrfach gleich benannte Deckungen: die erste gewinnt
    const bucket = byKey.get(key)!;
    if (!bucket.has(c.policyId)) bucket.set(c.policyId, c);
  }

  const coverageRows: CompareRow[] = order.map(key => {
    const bucket = byKey.get(key)!;
    const first = [...bucket.values()][0];
    const sums = policies.map(p =>
      bucket.has(p.id) ? bucket.get(p.id)!.sumInsured : undefined
    );
    return {
      label: first.label,
      cells: policies.map(p =>
        bucket.has(p.id) ? sumText(bucket.get(p.id)!.sumInsured) : null
      ),
      subCells: policies.map(p => {
        const own = bucket.get(p.id)?.deductible;
        return own === undefined || own === null
          ? null
          : `Selbstbehalt ${formatCents(own)}`;
      }),
      bestIndex: indexOfMaxSum(sums),
    };
  });

  return { policies, facts, coverages: coverageRows };
}
