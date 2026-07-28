import { useMemo } from 'react';
import { Link } from 'react-router';
import { GitBranch } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MoneyFlowChart, { MoneyFlowAccountCard } from '@/components/MoneyFlowChart';
import { buildMoneyFlow } from '@/lib/moneyflow';
import { useFinanceData } from '@/lib/data';

/** Geldfluss-Übersicht: Konten als Knoten, Dauerbuchungen als gerichtete Ströme */
export default function MoneyFlow() {
  const { accounts, accountTypes, banks, recurring, isLoading } = useFinanceData();

  const flow = useMemo(() => buildMoneyFlow(accounts, recurring), [accounts, recurring]);
  const typeName = new Map(accountTypes.map((t) => [t.key, t.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Geldfluss</h1>
        <p className="text-sm text-muted-foreground">
          Zeigt die wiederkehrenden Geldströme zwischen deinen Konten
        </p>
      </div>

      {!isLoading && accounts.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Noch keine Konten — lege zuerst ein Konto an, um Geldflüsse zu sehen.
          </CardContent>
        </Card>
      )}

      {!isLoading && accounts.length > 0 && recurring.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-muted-foreground">
              Noch keine wiederkehrenden Buchungen — lege eine Dauerbuchung an,
              um Geldflüsse zu sehen.
            </p>
            <Button asChild variant="outline">
              <Link to="/wiederkehrend">Zu den Dauerbuchungen</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {accounts.length > 0 && recurring.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4 text-emerald-600" />
              Wiederkehrende Ströme
            </CardTitle>
            <CardDescription>
              Beträge sind auf einen Monat umgerechnet. Pfeile zeigen die
              Flussrichtung, gestrichelte Linien sind pausierte Dauerbuchungen.
              Fahre mit der Maus über ein Konto, um seine Ströme hervorzuheben.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyFlowChart flow={flow} />
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 rounded bg-emerald-600" /> Einnahme
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 rounded bg-rose-500" /> Ausgabe
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 rounded bg-sky-600" /> Umbuchung
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-6 border-t-2 border-dashed border-muted-foreground" /> pausiert
              </span>
              <span>Linienstärke ∝ Betrag/Monat</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Konten ohne jede Dauerbuchung — abgesetzt unterhalb der Grafik */}
      {accounts.length > 0 && recurring.length > 0 && flow.unconnected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ohne Geldflüsse</CardTitle>
            <CardDescription>
              Diese Konten haben keine wiederkehrenden Buchungen und hängen an
              keinem Geldfluss.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {flow.unconnected.map((a) => (
              <MoneyFlowAccountCard
                key={a.id}
                account={a}
                typeLabel={typeName.get(a.type) ?? a.type}
                bankLabel={a.bankId !== null ? bankName.get(a.bankId) : undefined}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
