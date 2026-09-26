import { z } from "zod";

/**
 * Serverseitige Suche über Buchungen (Transaktionsliste, Drilldowns).
 *
 * Bisher lud jede Seite **alle** Buchungen und filterte im Browser — mit
 * hartem Schnitt bei 200 Zeilen und Summen über alle Jahre. Hier liegen
 * Filter, Sortierung, Seitenbildung und Summen als reine Funktion, damit sie
 * mit Vitest prüfbar sind (Frontend-Tests gibt es nicht) und im Service
 * Worker genauso laufen wie auf dem Server.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");

export const TX_SORT_KEYS = [
  "date",
  "amount",
  "category",
  "account",
  "person",
] as const;
export type TxSortKey = (typeof TX_SORT_KEYS)[number];

export const transactionSearchInput = z.object({
  /** Genau eine Buchung (Detail-Blatt für einen Link außerhalb der Seite) */
  id: z.number().int().positive().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  /** Quell- ODER Zielkonto */
  accountId: z.number().int().positive().optional(),
  /** Kategorie inklusive ihrer Unterkategorien; -1 = ohne Kategorie */
  categoryId: z.number().int().min(-1).optional(),
  userId: z.number().int().positive().optional(),
  tagId: z.number().int().positive().optional(),
  /** Projekt-ID oder 0 = laufender Haushalt (ohne Projekt) */
  projectId: z.number().int().min(0).optional(),
  /** Nur Buchungen mit Aufteilung */
  shared: z.boolean().optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(TX_SORT_KEYS).default("date"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  /** Versatz (tRPC-Infinite-Queries nennen ihn `cursor`) */
  cursor: z.number().int().min(0).nullish(),
  limit: z.number().int().min(1).max(500).default(50),
});
export type TransactionSearchInput = z.infer<typeof transactionSearchInput>;

export interface SearchableTx {
  id: number;
  type: "income" | "expense" | "transfer";
  accountId: number;
  toAccountId: number | null;
  amount: number;
  categoryId: number | null;
  userId: number;
  projectId: number | null;
  date: string;
  note: string;
  stornoOfId: number | null;
}

export interface SearchLookups {
  categories: { id: number; name: string; parentId: number | null }[];
  accountNames: Map<number, string>;
  userNames: Map<number, string>;
  /** Tag-IDs und -Namen je Buchung */
  tagsByTx: Map<number, { id: number; name: string }[]>;
  /** IDs der Buchungen mit Aufteilung */
  sharedTxIds: Set<number>;
}

/**
 * Suchbegriff als Betrag in Cent deuten — beide Dezimaltrennzeichen und
 * Tausender-Apostroph/-Punkt sind erlaubt („12,50“, „12.50“, „1'234“).
 * `exact` = mit Nachkommastellen eingegeben (dann exakter Vergleich),
 * sonst passt jeder Betrag mit diesem ganzzahligen Anteil.
 */
export function parseAmountTerm(
  term: string
): { cents: number; exact: boolean } | null {
  const s = term.replace(/[\s'’]/g, "");
  const m = /^(\d{1,3}(?:[.,]\d{3})*|\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  // Ein einzelnes Trennzeichen mit genau drei Ziffern danach ist ein
  // Tausendertrenner („1.234“), mit ein oder zwei Ziffern ein Dezimalzeichen
  const whole = Number(m[1].replace(/[.,]/g, ""));
  if (!Number.isFinite(whole)) return null;
  if (m[2] === undefined) return { cents: whole * 100, exact: false };
  const fraction = Number(m[2].padEnd(2, "0"));
  return { cents: whole * 100 + fraction, exact: true };
}

/** Kategorie plus ihre Unterkategorien */
export function categoryWithChildren(
  categories: SearchLookups["categories"],
  id: number
): Set<number> {
  return new Set([
    id,
    ...categories.filter(c => c.parentId === id).map(c => c.id),
  ]);
}

export interface SearchResult<T extends SearchableTx> {
  items: T[];
  total: number;
  /** Summen über ALLE Treffer (nicht nur die Seite) */
  income: number;
  expense: number;
  hasMore: boolean;
  nextCursor: number | null;
}

export function searchTransactions<T extends SearchableTx>(
  rows: T[],
  input: TransactionSearchInput,
  lookups: SearchLookups
): SearchResult<T> {
  const categoryName = new Map(lookups.categories.map(c => [c.id, c.name]));
  const categoryIds =
    input.categoryId !== undefined && input.categoryId > 0
      ? categoryWithChildren(lookups.categories, input.categoryId)
      : null;
  const term = input.search?.toLowerCase() ?? "";
  const amountTerm = term ? parseAmountTerm(term) : null;

  const matches = rows.filter(t => {
    if (input.id !== undefined && t.id !== input.id) return false;
    if (input.from && t.date < input.from) return false;
    if (input.to && t.date > input.to) return false;
    if (input.type && t.type !== input.type) return false;
    if (
      input.accountId !== undefined &&
      t.accountId !== input.accountId &&
      t.toAccountId !== input.accountId
    ) {
      return false;
    }
    if (input.categoryId === -1 && t.categoryId !== null) return false;
    if (categoryIds && (t.categoryId === null || !categoryIds.has(t.categoryId))) {
      return false;
    }
    if (input.userId !== undefined && t.userId !== input.userId) return false;
    if (input.projectId !== undefined) {
      const wanted = input.projectId === 0 ? null : input.projectId;
      if (t.projectId !== wanted) return false;
    }
    if (input.shared && !lookups.sharedTxIds.has(t.id)) return false;
    const txTags = lookups.tagsByTx.get(t.id) ?? [];
    if (input.tagId !== undefined && !txTags.some(x => x.id === input.tagId)) {
      return false;
    }
    if (term) {
      if (amountTerm) {
        const hit = amountTerm.exact
          ? t.amount === amountTerm.cents
          : Math.floor(t.amount / 100) === amountTerm.cents / 100;
        if (hit) return true;
      }
      const haystack = [
        t.note,
        t.categoryId !== null ? (categoryName.get(t.categoryId) ?? "") : "",
        ...txTags.map(x => x.name),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  // Summen ohne stornierte Buchungen und Gegenbuchungen (contracts/flows.ts)
  // — die Paare aus allen Zeilen bestimmen, nicht nur aus den Treffern: Liegt
  // das Storno in einem anderen Monat, zählte das Original sonst weiter
  const inPair = new Set<number>();
  for (const t of rows) {
    if (t.stornoOfId !== null) {
      inPair.add(t.id);
      inPair.add(t.stornoOfId);
    }
  }
  let income = 0;
  let expense = 0;
  for (const t of matches) {
    if (inPair.has(t.id)) continue;
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
  }

  const sortValue = (t: T): string | number => {
    switch (input.sort) {
      case "amount":
        return t.amount;
      case "category":
        return t.categoryId !== null
          ? (categoryName.get(t.categoryId) ?? "")
          : "";
      case "account":
        return lookups.accountNames.get(t.accountId) ?? "";
      case "person":
        return lookups.userNames.get(t.userId) ?? "";
      default:
        return t.date;
    }
  };
  const factor = input.dir === "asc" ? 1 : -1;
  const sorted = [...matches].sort((a, b) => {
    const va = sortValue(a);
    const vb = sortValue(b);
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "de");
    // Gleichstand: neueste zuerst, dann höhere ID — stabile Seitenbildung
    return (
      cmp * factor || b.date.localeCompare(a.date) || b.id - a.id
    );
  });

  const offset = input.cursor ?? 0;
  const items = sorted.slice(offset, offset + input.limit);
  const next = offset + items.length;
  return {
    items,
    total: matches.length,
    income,
    expense,
    hasMore: next < matches.length,
    /** Versatz der nächsten Seite, `null` am Ende */
    nextCursor: next < matches.length ? next : null,
  };
}
