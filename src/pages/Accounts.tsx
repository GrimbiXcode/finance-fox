import { useState } from 'react';
import { Banknote, ChevronDown, ChevronUp, CreditCard, Pencil, PiggyBank, Plus, Wallet } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AccountDialog from '@/components/AccountDialog';
import { trpc } from '@/providers/trpc';
import { useFinanceData } from '@/lib/data';
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
  const { accounts, accountTypes, banks, transactions } = useFinanceData();
  const [openId, setOpenId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [bankFilter, setBankFilter] = useState('all');
  const typeName = new Map(accountTypes.map((t) => [t.key, t.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));

  const filtered = accounts.filter((a) => {
    if (typeFilter !== 'all' && a.type !== typeFilter) return false;
    if (bankFilter === 'none' && a.bankId !== null) return false;
    if (bankFilter !== 'all' && bankFilter !== 'none' && a.bankId !== Number(bankFilter)) return false;
    return true;
  });

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

      <div className="flex flex-wrap gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Kontotyp" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            {accountTypes.map((t) => <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={bankFilter} onValueChange={setBankFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Bank" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Banken</SelectItem>
            <SelectItem value="none">Ohne Bank</SelectItem>
            {banks.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((a) => {
          const Icon = typeIcons[a.type] ?? Wallet;
          const txCount = transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).length;
          return (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{a.name}</CardTitle>
                    <CardDescription>{typeName.get(a.type) ?? a.type}</CardDescription>
                  </div>
                </div>
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
              </CardHeader>
              <CardContent>
                <div className={cn('text-2xl font-bold', a.balance < 0 && 'text-destructive')}>{formatCents(a.balance)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{txCount} Buchungen</Badge>
                  {a.ownerId !== null && <Badge variant="outline">Privat</Badge>}
                  {a.access === 'view' && <Badge variant="outline">nur lesend</Badge>}
                  <span>Anfangsbestand: {formatCents(a.initialBalance)}</span>
                </div>
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
    </div>
  );
}
