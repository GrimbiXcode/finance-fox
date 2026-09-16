import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { GitBranch, List as ListIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import MoneyFlowChart, { MoneyFlowAccountCard } from '@/components/MoneyFlowChart';
import { MoneyFlowList, MoneyFlowNodeDetails } from '@/components/MoneyFlowList';
import { buildMoneyFlow } from '@/lib/moneyflow';
import { useFinanceData } from '@/lib/data';
import { cn } from '@/lib/utils';

type ViewMode = 'chart' | 'list';
const VIEW_KEY = 'ff-moneyflow-view';

/** Letzte Darstellungsart aus localStorage lesen (Default: Diagramm) */
const readViewMode = (): ViewMode => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'chart');

/** Geldfluss-Übersicht: Konten als Knoten, Dauerbuchungen als gerichtete Ströme */
export default function MoneyFlow() {
  const { accounts, accountTypes, banks, recurring, isLoading } = useFinanceData();
  const [view, setView] = useState<ViewMode>(readViewMode);
  /** per Tipp/Klick hervorgehobener Knoten — im Diagramm und in der Liste derselbe */
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [showAllLabels, setShowAllLabels] = useState(false);

  const flow = useMemo(() => buildMoneyFlow(accounts, recurring), [accounts, recurring]);
  const typeName = new Map(accountTypes.map((t) => [t.key, t.name]));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));

  const switchView = (v: ViewMode) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const hasFlows = accounts.length > 0 && recurring.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">Geldfluss</h1>
          <p className="text-sm text-muted-foreground">
            Zeigt die wiederkehrenden Geldströme zwischen deinen Konten
          </p>
        </div>
        {hasFlows && (
          <div className="flex rounded-lg border bg-muted/40 p-1">
            <Button
              variant="ghost"
              size="icon"
              title="Diagramm"
              className={cn('h-7 w-7', view === 'chart' && 'bg-background shadow-sm')}
              onClick={() => switchView('chart')}
            >
              <GitBranch className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Liste"
              className={cn('h-7 w-7', view === 'list' && 'bg-background shadow-sm')}
              onClick={() => switchView('list')}
            >
              <ListIcon className="h-4 w-4" />
            </Button>
          </div>
        )}
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
              Noch keine wiederkehrenden Buchungen — lege eine Dauerbuchung an, um Geldflüsse zu
              sehen.
            </p>
            <Button asChild variant="outline">
              <Link to="/wiederkehrend">Zu den Dauerbuchungen</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {hasFlows && view === 'chart' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              Wiederkehrende Ströme
            </CardTitle>
            <CardDescription>
              Beträge sind auf einen Monat umgerechnet. Pfeile zeigen die Flussrichtung,
              gestrichelte Linien sind pausierte Dauerbuchungen. Tippe auf ein Konto oder fahre mit
              der Maus darüber, um seine Ströme hervorzuheben — die Beträge erscheinen dann auch als
              Liste unter dem Diagramm.
            </CardDescription>
            {flow.dense && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-xs text-muted-foreground">
                <span>
                  Viele Ströme: Beträge werden nur für das hervorgehobene Konto eingeblendet.
                </span>
                <div className="flex items-center gap-2">
                  <Switch
                    id="mf-all-labels"
                    checked={showAllLabels}
                    onCheckedChange={setShowAllLabels}
                  />
                  <Label htmlFor="mf-all-labels" className="text-xs font-normal">
                    Alle Beträge anzeigen
                  </Label>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <MoneyFlowChart
              flow={flow}
              focusNode={focusNode}
              onFocusNodeChange={setFocusNode}
              showAllLabels={showAllLabels}
            />
            {focusNode !== null && (
              <MoneyFlowNodeDetails
                flow={flow}
                nodeId={focusNode}
                onClose={() => setFocusNode(null)}
              />
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 rounded bg-positive" /> Einnahme
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 rounded bg-negative" /> Ausgabe
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 rounded bg-pencil-1" /> Umbuchung
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-6 border-t-2 border-dashed border-muted-foreground" />{' '}
                pausiert
              </span>
              <span>Linienstärke ∝ Betrag/Monat</span>
            </div>
          </CardContent>
        </Card>
      )}

      {hasFlows && view === 'list' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListIcon className="h-4 w-4 text-muted-foreground" />
              Wiederkehrende Ströme
            </CardTitle>
            <CardDescription>
              Beträge sind auf einen Monat umgerechnet; pausierte Dauerbuchungen zählen nicht zu den
              Summen. Tippe auf ein Konto, um seine einzelnen Ströme zu sehen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyFlowList flow={flow} focusNode={focusNode} onFocusNodeChange={setFocusNode} />
          </CardContent>
        </Card>
      )}

      {/* Konten ohne jede Dauerbuchung — abgesetzt unterhalb der Grafik */}
      {hasFlows && flow.unconnected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ohne Geldflüsse</CardTitle>
            <CardDescription>
              Diese Konten haben keine wiederkehrenden Buchungen und hängen an keinem Geldfluss.
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
