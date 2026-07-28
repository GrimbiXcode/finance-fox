import { Link } from 'react-router';
import { GitBranch } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MoneyFlowChart from '@/components/MoneyFlowChart';
import { useFinanceData } from '@/lib/data';

/** Geldfluss-Übersicht: Konten als Knoten, Dauerbuchungen als gerichtete Ströme */
export default function MoneyFlow() {
  const { accounts, recurring, isLoading } = useFinanceData();

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
            <MoneyFlowChart />
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
              <span>Linienstärke ≈ Betrag pro Monat</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
