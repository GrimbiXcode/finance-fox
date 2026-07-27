import { Banknote, CreditCard, Pencil, PiggyBank, Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import AccountDialog from '@/components/AccountDialog';
import { useFinanceData } from '@/lib/data';
import { formatCents } from '@/lib/finance';
import { cn } from '@/lib/utils';

type AccountType = 'checking' | 'cash' | 'savings';

const typeMeta: Record<AccountType, { label: string; icon: typeof CreditCard }> = {
  checking: { label: 'Girokonto', icon: CreditCard },
  cash: { label: 'Bargeld', icon: Banknote },
  savings: { label: 'Sparkonto', icon: PiggyBank },
};

export default function Accounts() {
  const { accounts, transactions } = useFinanceData();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Konten</h1>
          <p className="text-sm text-muted-foreground">{accounts.length} Konten im Haushalt</p>
        </div>
        <AccountDialog
          trigger={
            <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Neues Konto</Button>
          }
        />
      </div>

      {accounts.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Noch keine Konten — lege dein erstes Konto an, um Buchungen zu erfassen.
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => {
          const meta = typeMeta[a.type];
          const txCount = transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).length;
          return (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600">
                    <meta.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{a.name}</CardTitle>
                    <CardDescription>{meta.label}</CardDescription>
                  </div>
                </div>
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
              </CardHeader>
              <CardContent>
                <div className={cn('text-2xl font-bold', a.balance < 0 && 'text-destructive')}>{formatCents(a.balance)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{txCount} Buchungen</Badge>
                  {a.ownerId !== null && <Badge variant="outline">Privat</Badge>}
                  {a.access === 'view' && <Badge variant="outline">nur lesend</Badge>}
                  <span>Anfangsbestand: {formatCents(a.initialBalance)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
