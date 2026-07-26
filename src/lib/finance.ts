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

export const formatCents = (cents: number, currency: string = appCurrency): string =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);

/** Währungssymbol der App-Währung (z. B. "€", "CHF", "$") für Labels/Charts */
export const currencySymbol = (currency: string = appCurrency): string =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency })
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value ?? currency;

export const parseEuro = (input: string): number => {
  const normalized = input.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const value = parseFloat(normalized);
  if (Number.isNaN(value)) return 0;
  return Math.round(Math.abs(value) * 100);
};

export const monthKey = (dateISO: string): string => dateISO.slice(0, 7);

export const currentMonthKey = (): string => monthKey(todayISO());

export const formatDate = (dateISO: string): string =>
  new Date(`${dateISO}T12:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

export const formatMonth = (key: string): string =>
  new Date(`${key}-15T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

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

/** Netto-Salden zwischen Personen aus geteilten Ausgaben */
export function memberBalances(txs: TxLike[], userIds: number[]): Map<number, number> {
  const net = new Map<number, number>();
  for (const id of userIds) net.set(id, 0);
  for (const t of txs) {
    if (t.type !== 'expense' || t.splits.length === 0) continue;
    const payer = t as TxLike & { userId: number };
    net.set(payer.userId, (net.get(payer.userId) ?? 0) + t.amount);
    for (const s of t.splits) {
      net.set(s.userId, (net.get(s.userId) ?? 0) - s.amount);
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
