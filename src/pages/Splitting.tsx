import { ArrowRight, CheckCircle2, HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { trpc } from '@/providers/trpc';
import { computeSettlements, formatCents, formatDate, memberBalances, todayISO } from '@/lib/finance';
import { cn } from '@/lib/utils';

export default function Splitting() {
  const { accounts, transactions, users } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const userIds = users.map((u) => u.id);
  const balances = memberBalances(transactions, userIds);
  const settlements = computeSettlements(transactions, userIds);

  // Erstes Konto mit Bearbeitungsrecht — dahin wird der Ausgleich gebucht.
  const editAccount = accounts.find((a) => a.access === 'edit');

  const settle = trpc.finance.createTransaction.useMutation({
    onSuccess: () => {
      toast.success('Ausgleich verbucht.');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Buchungsrichtung: Der Schuldner zahlt (userId), der Gläubiger trägt den
  // Anteil zu 100 % (splits). In memberBalances hebt das den Saldo des
  // Schuldners (+Betrag) und senkt den des Gläubigers (−Betrag) — beide
  // landen dadurch bei 0 statt doppelt daneben.
  const bookSettlement = (fromId: number, toId: number, amount: number) => {
    if (!editAccount) return;
    const to = userById(toId);
    settle.mutate({
      type: 'expense',
      accountId: editAccount.id,
      amount,
      userId: fromId,
      date: todayISO(),
      note: `Ausgleich an ${to?.name ?? 'Unbekannt'}`,
      splits: [{ userId: toId, amount }],
    });
  };

  const sharedExpenses = transactions.filter((t) => t.type === 'expense' && t.splits.length > 0);
  const userById = (id: number) => users.find((u) => u.id === id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Kostenaufteilung</h1>
        <p className="text-sm text-muted-foreground">
          Wer hat was bezahlt, wer schuldet wem etwas — basierend auf geteilten Ausgaben.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aktuelle Salden</CardTitle>
            <CardDescription>Positiv = bekommt Geld · Negativ = schuldet Geld</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {users.map((u) => {
              const bal = balances.get(u.id) ?? 0;
              return (
                <div key={u.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: u.color }}>
                      {u.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="font-medium">{u.name}</span>
                  </div>
                  <span className={cn('text-lg font-bold', bal > 0 ? 'text-emerald-600' : bal < 0 ? 'text-rose-500' : 'text-muted-foreground')}>
                    {bal > 0 ? '+' : ''}{formatCents(bal)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ausgleichsvorschläge</CardTitle>
            <CardDescription>Minimale Überweisungen, damit alle quitt sind</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {settlements.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Alles ausgeglichen — niemand schuldet jemandem etwas.
              </div>
            ) : (
              settlements.map((s, idx) => {
                const from = userById(s.fromId);
                const to = userById(s.toId);
                return (
                  <div key={idx} className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: from?.color }}>
                        {from?.name.slice(0, 2).toUpperCase()}
                      </span>
                      {from?.name}
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <span className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: to?.color }}>
                        {to?.name.slice(0, 2).toUpperCase()}
                      </span>
                      {to?.name}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold">{formatCents(s.amount)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!editAccount || settle.isPending}
                        title={editAccount
                          ? `Ausgleich als Ausgabe auf „${editAccount.name}“ verbuchen`
                          : 'Kein Konto mit Bearbeitungsrecht vorhanden'}
                        onClick={() => bookSettlement(s.fromId, s.toId, s.amount)}
                      >
                        <HandCoins className="h-4 w-4" />
                        Verbuchen
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
            <p className="text-xs text-muted-foreground">
              Tipp: Mit „Verbuchen“ wird die Rückzahlung direkt als geteilte Ausgabe erfasst — die Salden gleichen sich sofort aus.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Geteilte Ausgaben</CardTitle>
          <CardDescription>{sharedExpenses.length} Buchungen mit Aufteilung</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {sharedExpenses.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Noch keine geteilten Ausgaben. Beim Erfassen einer Ausgabe „Kosten aufteilen“ aktivieren.
            </p>
          )}
          {sharedExpenses.slice(0, 50).map((t) => {
            const payer = userById(t.userId);
            return (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{t.note || 'Ausgabe'}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(t.date)} · bezahlt von {payer?.name}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    {t.splits.map((s) => {
                      const u = userById(s.userId);
                      return (
                        <Badge key={s.userId} variant="secondary" className="text-[10px]" style={{ borderLeft: `3px solid ${u?.color ?? '#999'}` }}>
                          {u?.name}: {formatCents(s.amount)}
                        </Badge>
                      );
                    })}
                  </div>
                  <span className="font-semibold text-rose-500">−{formatCents(t.amount)}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
