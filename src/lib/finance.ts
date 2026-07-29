/** Lokales Datum als ISO-String (YYYY-MM-DD) — ohne UTC-Verschiebung */
export const localISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const todayISO = (): string => localISO(new Date());

/**
 * Haushaltsweit konfigurierte Währung (ISO 4217). Wird vom Admin in den
 * Einstellungen festgelegt und vom Layout nach dem Laden gesetzt
 * (setAppCurrency) — formatCents/currencySymbol nutzen sie als Default.
 */
let appCurrency = 'EUR';

export const setAppCurrency = (code: string): void => {
  appCurrency = code;
};

export const getAppCurrency = (): string => appCurrency;

/**
 * Region des Browsers (z. B. "de-DE", "de-CH", "en-US") — steuert alle
 * Zahlen- und Datumsformate in der Anzeige und Eingabe. Fallback: de-DE.
 */
const userLocale =
  typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'de-DE';

export const getUserLocale = (): string => userLocale;

/** Locale-konformer Placeholder für Betragsfelder (z. B. "0,00" bzw. "0.00") */
export const amountPlaceholder = new Intl.NumberFormat(userLocale, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(0);

export const formatCents = (cents: number, currency: string = appCurrency): string =>
  new Intl.NumberFormat(userLocale, { style: 'currency', currency }).format(cents / 100);

/** Währungssymbol der App-Währung (z. B. "€", "CHF", "$") für Labels/Charts */
export const currencySymbol = (currency: string = appCurrency): string =>
  new Intl.NumberFormat(userLocale, { style: 'currency', currency })
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value ?? currency;

/**
 * Locale-bewusstes Betrags-Parsing → Cent (positive ganze Zahl, 0 bei
 * ungültiger Eingabe). Regelwerk:
 * - Währungssymbole, Leerzeichen und Apostrophe (') werden ignoriert.
 * - Kommen '.' UND ',' vor, gilt das weiter rechts stehende Zeichen als
 *   Dezimalzeichen, das andere als Tausendertrenner.
 * - Kommt nur das Dezimalzeichen der Locale vor, ist es das Dezimalzeichen
 *   (bei Mehrfachvorkommen: Tausendertrenner).
 * - Kommt nur das jeweils andere Zeichen genau einmal mit 1–2
 *   Nachkommastellen vor, wird es als Dezimalzeichen interpretiert
 *   (Fallback für eingefügte Werte), sonst als Tausendertrenner entfernt.
 */
export const parseAmountCents = (input: string, locale: string): number => {
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === 'decimal')?.value ?? ',';
  const other = decimal === ',' ? '.' : ',';
  const s = input.trim().replace(/[\s'’`€$£¥₹]/g, '');
  if (s === '') return 0;
  let normalized: string;
  if (s.includes('.') && s.includes(',')) {
    // Beide Zeichen vorhanden: das letzte ist das Dezimalzeichen
    const decimalChar = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const groupChar = decimalChar === ',' ? '.' : ',';
    normalized = s.split(groupChar).join('').replace(decimalChar, '.');
  } else if (s.includes(decimal)) {
    normalized =
      s.split(decimal).length === 2 ? s.replace(decimal, '.') : s.split(decimal).join('');
  } else if (s.includes(other)) {
    const occurrences = s.split(other).length - 1;
    const fraction = s.slice(s.lastIndexOf(other) + 1);
    normalized =
      occurrences === 1 && /^\d{1,2}$/.test(fraction)
        ? s.replace(other, '.')
        : s.split(other).join('');
  } else {
    normalized = s;
  }
  const value = parseFloat(normalized);
  if (Number.isNaN(value)) return 0;
  return Math.round(Math.abs(value) * 100);
};

export const parseEuro = (input: string): number => parseAmountCents(input, userLocale);

/**
 * Prozent-Eingabe locale-bewusst parsen (z. B. "5,30" → 5.3, 0 bei
 * ungültiger Eingabe). Akzeptiert Komma und Punkt als Dezimalzeichen.
 */
export const parsePercent = (input: string): number => {
  const value = parseFloat(input.trim().replace(',', '.'));
  return Number.isNaN(value) ? 0 : value;
};

/** Basispunkte als locale-formatierten Prozent-String (530 → "5,30") */
export const formatBp = (bp: number): string =>
  new Intl.NumberFormat(userLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(bp / 100);

export const monthKey = (dateISO: string): string => dateISO.slice(0, 7);

export const currentMonthKey = (): string => monthKey(todayISO());

export const formatDate = (dateISO: string): string =>
  new Date(`${dateISO}T12:00:00`).toLocaleDateString(userLocale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

export const formatMonth = (key: string): string =>
  new Date(`${key}-15T12:00:00`).toLocaleDateString(userLocale, { month: 'long', year: 'numeric' });

/** Generische Typen für Berechnungen (kompatibel mit den tRPC-Antworten) */
export interface TxLike {
  type: 'income' | 'expense' | 'transfer';
  accountId: number;
  toAccountId: number | null;
  amount: number;
  date: string;
  splits: { userId: number; amount: number }[];
}

export interface AccountLike {
  id: number;
  initialBalance: number;
}

export function accountBalance(account: AccountLike, txs: TxLike[]): number {
  let balance = account.initialBalance;
  for (const t of txs) {
    if (t.type === 'transfer') {
      if (t.accountId === account.id) balance -= t.amount;
      if (t.toAccountId === account.id) balance += t.amount;
    } else if (t.accountId === account.id) {
      balance += t.type === 'income' ? t.amount : -t.amount;
    }
  }
  return balance;
}

export function totalBalance(accounts: AccountLike[], txs: TxLike[]): number {
  return accounts.reduce((sum, a) => sum + accountBalance(a, txs), 0);
}

export function monthTotals(txs: TxLike[], key: string): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.type === 'transfer' || monthKey(t.date) !== key) continue;
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense };
}

export function expensesByCategory(txs: TxLike[], key: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const t of txs) {
    if (t.type !== 'expense' || monthKey(t.date) !== key) continue;
    const cat = t as TxLike & { categoryId: number | null };
    const id = cat.categoryId ?? -1;
    map.set(id, (map.get(id) ?? 0) + t.amount);
  }
  return map;
}

export interface CategoryLike {
  id: number;
  parentId: number | null;
}

/**
 * Ausgaben eines Monats auf Oberkategorien aggregiert: Ausgaben einer
 * Unterkategorie zählen zur Oberkategorie, Kategorien ohne Oberkategorie
 * bilden eine eigene Gruppe (Schlüssel -1 = ohne Kategorie, wie bei
 * expensesByCategory).
 */
export function expensesByRootCategory(
  txs: TxLike[],
  key: string,
  categories: CategoryLike[],
): Map<number, number> {
  const rootOf = new Map<number, number>(
    categories.map((c) => [c.id, c.parentId ?? c.id]),
  );
  const map = new Map<number, number>();
  for (const [catId, amount] of expensesByCategory(txs, key)) {
    const rootId = catId === -1 ? -1 : (rootOf.get(catId) ?? catId);
    map.set(rootId, (map.get(rootId) ?? 0) + amount);
  }
  return map;
}

/**
 * Netto-Salden zwischen Personen aus geteilten Buchungen.
 * Geteilte Ausgaben: Zahler +Betrag, Split-Partner −Anteil.
 * Einnahmen MIT Splits zählen umgekehrt (Zahler −Betrag, Split-Partner
 * +Anteil) — so hebt eine Storno-Buchung (Ausgabe → Einnahme mit denselben
 * Splits, siehe finance.reverseTransaction) die ursprüngliche
 * Aufteilungs-Wirkung exakt auf.
 */
export function memberBalances(txs: TxLike[], userIds: number[]): Map<number, number> {
  const net = new Map<number, number>();
  for (const id of userIds) net.set(id, 0);
  for (const t of txs) {
    if (t.splits.length === 0) continue;
    if (t.type !== 'expense' && t.type !== 'income') continue;
    // Vorzeichen: Ausgabe wie bisher, Einnahme mit Splits spiegelverkehrt
    const sign = t.type === 'expense' ? 1 : -1;
    const payer = t as TxLike & { userId: number };
    net.set(payer.userId, (net.get(payer.userId) ?? 0) + sign * t.amount);
    for (const s of t.splits) {
      net.set(s.userId, (net.get(s.userId) ?? 0) - sign * s.amount);
    }
  }
  return net;
}

export interface SettlementLike {
  fromId: number;
  toId: number;
  amount: number;
}

/** Greedy-Ausgleich: minimale Anzahl an Überweisungen */
export function computeSettlements(txs: TxLike[], userIds: number[]): SettlementLike[] {
  const net = memberBalances(txs, userIds);
  const debtors = userIds
    .filter((id) => (net.get(id) ?? 0) < -0.5)
    .map((id) => ({ id, amount: -(net.get(id) ?? 0) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = userIds
    .filter((id) => (net.get(id) ?? 0) > 0.5)
    .map((id) => ({ id, amount: net.get(id) ?? 0 }))
    .sort((a, b) => b.amount - a.amount);

  const result: SettlementLike[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    result.push({ fromId: debtors[i].id, toId: creditors[j].id, amount: Math.round(pay) });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount < 0.5) i += 1;
    if (creditors[j].amount < 0.5) j += 1;
  }
  return result;
}
