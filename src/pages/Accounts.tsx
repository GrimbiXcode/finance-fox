import { useState } from 'react';
import { Banknote, ChevronDown, ChevronUp, CreditCard, LayoutGrid, Pencil, PiggyBank, Plus, Search, Table as TableIcon, Wallet } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import AccountDialog from '@/components/AccountDialog';
import { trpc } from '@/providers/trpc';
import { useFinanceData } from '@/lib/data';
import { useTableSort } from '@/lib/sort';
import { currencySymbol, formatCents, formatDate, getUserLocale } from '@/lib/finance';
import { cn } from '@/lib/utils';

/** Icons für die Builtin-Typen; eigene Typen bekommen das Fallback-Icon */
const typeIcons: Record<string, typeof CreditCard> = {
  checking: CreditCard,
  cash: Banknote,
  savings: PiggyBank,
};

/** IBAN zur Anzeige in 4er-Gruppen formatieren */
const formatIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

/** Zeitraum-Optionen für den Saldo-Verlauf (months: 0 = komplette Historie) */
const HISTORY_RANGES = [
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '12M', months: 12 },
  { label: 'Alles', months: 0 },
] as const;

type HistoryMonths = (typeof HISTORY_RANGES)[number]['months'];

type AccountRow = ReturnType<typeof useFinanceData>['accounts'][number];

/** Sortierbare Spalten der Tabellenansicht */
type AccountSortKey = 'name' | 'type' | 'bank' | 'txCount' | 'initial' | 'balance';

type ViewMode = 'cards' | 'table';
const VIEW_KEY = 'ff-accounts-view';

/** Letzte Darstellungsart aus localStorage lesen (Default: Karten) */
const readViewMode = (): ViewMode =>
  localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';

/** Aufklappbarer Saldo-Verlauf eines Kontos (AreaChart, Zeitraum wählbar) */
function BalanceHistory({ accountId }: { accountId: number }) {
  const [months, setMonths] = useState<HistoryMonths>(12);
  const query = trpc.finance.accountBalanceHistory.useQuery({ accountId, months });
  const data = (query.data ?? []).map((p) => ({ date: p.date, saldo: p.balance / 100 }));
  const gradientId = `gSaldo${accountId}`;

  return (
    <div className="border-t px-4 pb-4 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Saldo-Verlauf</span>
        <div className="flex gap-1">
          {HISTORY_RANGES.map((r) => (
            <Button
              key={r.months}
              size="sm"
              variant={months === r.months ? 'secondary' : 'ghost'}
              className="h-6 px-2 text-xs"
              onClick={() => setMonths(r.months)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>
      {query.isLoading ? (
        <p className="py-10 text-center text-xs text-muted-foreground">Verlauf wird geladen…</p>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date" tickLine={false} axisLine={false} fontSize={11}
                tickFormatter={(v: string) => formatDate(v)}
              />
              <YAxis
                tickLine={false} axisLine={false} width={64} fontSize={11}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => `${v} ${currencySymbol()}`}
              />
              <Tooltip
                labelFormatter={(label) => formatDate(String(label))}
                formatter={(value: number | string) =>
                  `${Number(value).toLocaleString(getUserLocale(), { minimumFractionDigits: 2 })} ${currencySymbol()}`}
              />
              <Area
                type="monotone" dataKey="saldo" stroke="#10b981"
                fill={`url(#${gradientId})`} strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function Accounts() {
  const { accounts, accountTypes, banks, transactions, users } = useFinanceData();
  const [openId, setOpenId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [bankFilter, setBankFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>(readViewMode);
  const typeName = new Map(accountTypes.map((t) => [t.key, t.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));

  /** Besitzer-Namen eines Kontos kommagetrennt (für die Kartenansicht) */
  const ownerNames = (a: AccountRow) =>
    a.owners.map((id) => userName.get(id) ?? '?').join(', ');

  const switchView = (v: ViewMode) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const filtered = accounts.filter((a) => {
    if (typeFilter !== 'all' && a.type !== typeFilter) return false;
    if (bankFilter === 'none' && a.bankId !== null) return false;
    if (bankFilter !== 'all' && bankFilter !== 'none' && a.bankId !== Number(bankFilter)) return false;
    const term = search.trim().toLowerCase().replace(/\s/g, '');
    if (term) {
      // Suche über Kontoname, Bankname und IBAN (Leerzeichen ignoriert)
      const haystack = `${a.name} ${a.bankId !== null ? (bankName.get(a.bankId) ?? '') : ''} ${a.iban ?? ''}`
        .toLowerCase().replace(/\s/g, '');
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
  const txCountOf = (id: number) =>
    transactions.filter((t) => t.accountId === id || t.toAccountId === id).length;

  // Clientseitige Sortierung der Tabellenansicht (wirkt auf die gefilterte Liste)
  const { toggleSort, sorted, iconFor, isActive } = useTableSort<AccountSortKey, AccountRow>({
    name: (a) => a.name,
    type: (a) => typeName.get(a.type) ?? a.type,
    bank: (a) => (a.bankId !== null ? bankName.get(a.bankId) ?? '' : ''),
    txCount: (a) => txCountOf(a.id),
    initial: (a) => a.initialBalance,
    balance: (a) => a.balance,
  });

  /** Sortierbarer Spaltenkopf: Klick schaltet die Sortierung, Pfeil-Icon zeigt sie an */
  const sortableHead = (key: AccountSortKey, label: string, className?: string) => {
    const Icon = iconFor(key);
    return (
      <TableHead className={cn('cursor-pointer select-none', className)} onClick={() => toggleSort(key)}>
        <span className="inline-flex items-center gap-1">
          {label}
          <Icon className={cn('h-3.5 w-3.5', isActive(key) ? 'text-foreground' : 'text-muted-foreground/40')} />
        </span>
      </TableHead>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Konten</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} von {accounts.length} Konten im Haushalt</p>
        </div>
        <AccountDialog
          trigger={
            <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Neues Konto</Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suche: Name, Bank, IBAN…" className="w-56 pl-8"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SearchableSelect
          value={typeFilter}
          onValueChange={setTypeFilter}
          placeholder="Kontotyp"
          className="w-44"
          options={[
            { value: 'all', label: 'Alle Typen' },
            ...accountTypes.map((t) => ({ value: t.key, label: t.name })),
          ]}
        />
        <SearchableSelect
          value={bankFilter}
          onValueChange={setBankFilter}
          placeholder="Bank"
          className="w-44"
          options={[
            { value: 'all', label: 'Alle Banken' },
            { value: 'none', label: 'Ohne Bank' },
            ...banks.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
        />
        <div className="ml-auto flex rounded-lg border bg-muted/40 p-1">
          <Button
            variant="ghost" size="icon" title="Kartenansicht"
            className={cn('h-7 w-7', view === 'cards' && 'bg-background shadow-sm')}
            onClick={() => switchView('cards')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon" title="Tabellenansicht"
            className={cn('h-7 w-7', view === 'table' && 'bg-background shadow-sm')}
            onClick={() => switchView('table')}
          >
            <TableIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {accounts.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Noch keine Konten — lege dein erstes Konto an, um Buchungen zu erfassen.
          </CardContent>
        </Card>
      )}
      {accounts.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Keine Konten für diese Filterauswahl.
          </CardContent>
        </Card>
      )}
      {view === 'cards' ? (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((a) => {
          const Icon = typeIcons[a.type] ?? Wallet;
          const txCount = txCountOf(a.id);
          return (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-base" title={a.name}>{a.name}</CardTitle>
                    <CardDescription>{typeName.get(a.type) ?? a.type}</CardDescription>
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  {a.access === 'edit' && (
                    <AccountDialog
                      account={a}
                      trigger={
                        <Button variant="ghost" size="icon" title="Konto bearbeiten">
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      }
                    />
                  )}
                  <Button
                    variant="ghost" size="icon" title="Saldo-Verlauf"
                    onClick={() => setOpenId(openId === a.id ? null : a.id)}
                  >
                    {openId === a.id
                      ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className={cn('text-2xl font-bold', a.balance < 0 && 'text-destructive')}>{formatCents(a.balance)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{txCount} Buchungen</Badge>
                  {a.owners.length > 0 && <Badge variant="outline">Privat</Badge>}
                  {a.access === 'view' && <Badge variant="outline">nur lesend</Badge>}
                  <span>Anfangsbestand: {formatCents(a.initialBalance)}</span>
                </div>
                {a.owners.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">Besitzer: {ownerNames(a)}</div>
                )}
                {(a.bankId !== null || a.iban) && (
                  <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {a.bankId !== null && <div>{bankName.get(a.bankId) ?? 'Unbekannte Bank'}</div>}
                    {a.iban && <div className="font-mono">{formatIban(a.iban)}</div>}
                  </div>
                )}
              </CardContent>
              {openId === a.id && <BalanceHistory accountId={a.id} />}
            </Card>
          );
        })}
      </div>
      ) : (
      <Card className="overflow-x-auto py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {sortableHead('name', 'Konto')}
              {sortableHead('type', 'Typ')}
              {sortableHead('bank', 'Bank')}
              <TableHead>IBAN</TableHead>
              {sortableHead('txCount', 'Buchungen', 'text-right')}
              {sortableHead('initial', 'Anfangsbestand', 'text-right')}
              {sortableHead('balance', 'Saldo', 'text-right')}
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Sortierung vor dem Rendern der Zeilenpaare — die Verlauf-Zeile bleibt unter ihrem Konto */}
            {sorted(filtered).map((a) => {
              const Icon = typeIcons[a.type] ?? Wallet;
              return [
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-medium">{a.name}</div>
                        <div className="flex gap-1">
                          {a.owners.length > 0 && <Badge variant="outline" className="text-[10px]">Privat</Badge>}
                          {a.access === 'view' && <Badge variant="outline" className="text-[10px]">nur lesend</Badge>}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{typeName.get(a.type) ?? a.type}</TableCell>
                  <TableCell>{a.bankId !== null ? (bankName.get(a.bankId) ?? 'Unbekannte Bank') : '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{a.iban ? formatIban(a.iban) : '—'}</TableCell>
                  <TableCell className="text-right">{txCountOf(a.id)}</TableCell>
                  <TableCell className="text-right">{formatCents(a.initialBalance)}</TableCell>
                  <TableCell className={cn('text-right font-bold', a.balance < 0 && 'text-destructive')}>
                    {formatCents(a.balance)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      {a.access === 'edit' && (
                        <AccountDialog
                          account={a}
                          trigger={
                            <Button variant="ghost" size="icon" title="Konto bearbeiten">
                              <Pencil className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          }
                        />
                      )}
                      <Button
                        variant="ghost" size="icon" title="Saldo-Verlauf"
                        onClick={() => setOpenId(openId === a.id ? null : a.id)}
                      >
                        {openId === a.id
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>,
                openId === a.id && (
                  <TableRow key={`${a.id}-verlauf`}>
                    <TableCell colSpan={8} className="p-0">
                      <BalanceHistory accountId={a.id} />
                    </TableCell>
                  </TableRow>
                ),
              ];
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="font-medium">
                Total ({filtered.length} {filtered.length === 1 ? 'Konto' : 'Konten'})
              </TableCell>
              <TableCell className="text-right">
                {filtered.reduce((s, a) => s + txCountOf(a.id), 0)}
              </TableCell>
              <TableCell className="text-right">
                {formatCents(filtered.reduce((s, a) => s + a.initialBalance, 0))}
              </TableCell>
              <TableCell className={cn(
                'text-right font-bold',
                filtered.reduce((s, a) => s + a.balance, 0) < 0 && 'text-destructive',
              )}>
                {formatCents(filtered.reduce((s, a) => s + a.balance, 0))}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
      )}
    </div>
  );
}
