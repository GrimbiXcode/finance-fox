import { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import GoalDialog from '@/components/GoalDialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { amountPlaceholder, currencySymbol, formatCents, formatDate, formatMonth, parseEuro } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/** Farben der Herkunfts-Segmente (Konto-Quellen nach Index, Bestand grau) */
const SOURCE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#6366f1'];
const LEGACY_COLOR = '#94a3b8';

type Goal = ReturnType<typeof useFinanceData>['goals'][number];
type Account = ReturnType<typeof useFinanceData>['accounts'][number];
type Bank = ReturnType<typeof useFinanceData>['banks'][number];
type GoalForecastRow = { goalId: number; etaMonth: string | null; monthlyRate: number };

/** Deutsche Kurzbezeichnung der Quellen-Modi */
function modeLabel(mode: 'full' | 'absolute' | 'percent', value: number | null | undefined): string {
  if (mode === 'full') return 'gesamtes Konto';
  if (mode === 'absolute') return `Anteil ${formatCents(value ?? 0)}`;
  return `${value ?? 0} %`;
}

/**
 * Karte eines Sparziels (Sparziele 2.0). Der Fortschritt ergibt sich aus
 * den verknüpften Konten (Quellen) plus dem Alt-Bestand „Manuell" — der
 * gestapelte Balken und die Herkunfts-Zeilen zeigen die Zusammensetzung.
 */
function GoalCard({ goal, accounts, banks, forecast }: {
  goal: Goal;
  accounts: Account[];
  banks: Bank[];
  forecast: GoalForecastRow | undefined;
}) {
  const invalidate = useInvalidateFinance();
  const contribsQuery = trpc.finance.listGoalContributions.useQuery({ goalId: goal.id });
  const [showSources, setShowSources] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkAccount, setLinkAccount] = useState('');
  const [linkMode, setLinkMode] = useState<'full' | 'absolute' | 'percent'>('full');
  const [linkValue, setLinkValue] = useState('');

  const addSource = trpc.finance.addGoalSource.useMutation({
    onSuccess: () => {
      toast.success('Konto verknüpft.');
      invalidate();
      setLinkOpen(false); setLinkAccount(''); setLinkMode('full'); setLinkValue('');
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteSource = trpc.finance.deleteGoalSource.useMutation({
    onSuccess: () => { toast.success('Verknüpfung entfernt.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  // Freier Anteil des gewählten Kontos (Anteils-Exklusivität) — nur bei
  // geöffnetem Dialog und gewähltem Konto abfragen
  const availability = trpc.finance.goalSourceAvailability.useQuery(
    { accountId: Number(linkAccount) || 0 },
    { enabled: linkOpen && linkAccount !== '' },
  );

  const contribs = contribsQuery.data ?? [];
  const total = goal.totalSaved;
  // Offenes Ziel (kein Zielbetrag): kein Prozent/„Erreicht"/Prognose,
  // aber der Herkunfts-Balken zeigt die Zusammensetzung der Gesamtmenge
  const open = goal.targetAmount === null;
  const pct = goal.percent ?? 0;
  const done = !open && total >= (goal.targetAmount ?? 0);

  // Farbe je Quelle: Konto-Quellen nach Index, Bestand grau
  const colorOf = (index: number, kind: 'account' | 'legacy') =>
    kind === 'legacy' ? LEGACY_COLOR : SOURCE_COLORS[index % SOURCE_COLORS.length];
  // Balkenbreiten: mit Zielbetrag als Anteil am Ziel (Summe auf 100 % gedeckelt),
  // beim offenen Ziel als Anteil an der Gesamtmenge
  const widthOf = (cents: number) =>
    goal.targetAmount
      ? Math.min(100, (cents / goal.targetAmount) * 100)
      : total > 0 ? (cents / total) * 100 : 0;

  // Verknüpfbare Konten: sichtbar und noch nicht mit diesem Ziel verknüpft
  const linkedAccountIds = new Set(
    goal.sources.filter((s) => s.kind === 'account').map((s) => s.accountId),
  );
  const linkableAccounts = accounts.filter((a) => !linkedAccountIds.has(a.id));

  const submitLink = () => {
    const accountId = Number(linkAccount);
    if (!accountId) { toast.error('Konto wählen.'); return; }
    if (linkMode === 'absolute') {
      const cents = parseEuro(linkValue);
      if (cents <= 0) { toast.error('Betrag größer 0 angeben.'); return; }
      addSource.mutate({ goalId: goal.id, accountId, mode: linkMode, value: cents });
      return;
    }
    if (linkMode === 'percent') {
      const pctValue = Number(linkValue);
      if (!Number.isInteger(pctValue) || pctValue < 1 || pctValue > 100) {
        toast.error('Prozentwert zwischen 1 und 100 angeben.');
        return;
      }
      addSource.mutate({ goalId: goal.id, accountId, mode: linkMode, value: pctValue });
      return;
    }
    addSource.mutate({ goalId: goal.id, accountId, mode: 'full' });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div>
          <CardTitle className="text-base">{goal.name}</CardTitle>
          <CardDescription>
            {goal.deadline ? `bis ${formatDate(goal.deadline)}` : 'ohne Stichtag'}
          </CardDescription>
        </div>
        <GoalDialog
          goal={goal}
          trigger={
            <Button variant="ghost" size="icon" title="Ziel bearbeiten">
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-bold" style={{ color: goal.color }}>{formatCents(total)}</span>
          {open ? (
            <Badge variant="secondary">offenes Ziel</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">von {formatCents(goal.targetAmount ?? 0)}</span>
          )}
        </div>
        {/* Gestapelter Herkunfts-Balken: ein Segment pro Quelle; beim offenen
            Ziel zeigt er die Aufteilung der Gesamtmenge (ohne Prozent/ETA) */}
        {(open ? total > 0 : true) && (
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
            {goal.sources.map((s, i) => (
              s.amount > 0 && (
                <div
                  key={s.kind === 'account' ? `acc-${s.sourceId}` : 'legacy'}
                  style={{ width: `${widthOf(s.amount)}%`, backgroundColor: colorOf(i, s.kind) }}
                />
              )
            ))}
          </div>
        )}
        {!open && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{done ? 'Erreicht! 🎉' : `${pct} %`}</span>
              {!done && forecast && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {forecast.etaMonth
                    ? `Voraussichtlich erreicht: ${formatMonth(forecast.etaMonth)}`
                    : 'Mit aktuellen Dauerbuchungen nicht erreichbar'}
                  {forecast.monthlyRate > 0 && ` (+${formatCents(forecast.monthlyRate)}/Monat)`}
                </span>
              )}
            </div>
          </>
        )}
        {goal.hasHiddenSources && (
          <p className="text-xs italic text-muted-foreground">Enthält verborgene Quellen</p>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between"
          onClick={() => setShowSources((v) => !v)}
        >
          Herkunft ({goal.sources.length})
          {showSources ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        {showSources && (
          <div className="space-y-2 border-t pt-3">
            {/* Herkunfts-Zeilen: Konto — Modus → Betrag, Bestand zuletzt */}
            <div className="space-y-1">
              {goal.sources.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Noch keine Quelle — verknüpfe ein Konto mit diesem Ziel.
                </p>
              )}
              {goal.sources.map((s, i) => (
                <div
                  key={s.kind === 'account' ? `acc-${s.sourceId}` : 'legacy'}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(i, s.kind) }}
                    />
                    <span className="truncate">
                      {s.kind === 'legacy'
                        ? 'Manuell (Bestand)'
                        : `${s.accountName} — ${modeLabel(s.mode ?? 'full', s.value)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="font-medium">→ {formatCents(s.amount)}</span>
                    {s.kind === 'account' && s.sourceId !== undefined && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="Verknüpfung entfernen"
                        onClick={() => deleteSource.mutate({ id: s.sourceId! })}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Bestand: bisherige Beiträge (schreibgeschützt) */}
            {contribs.length > 0 && (
              <ul className="space-y-1 border-t pt-2">
                {contribs.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.userColor }} />
                      <span className="truncate">
                        {c.userName}
                        {c.note ? ` — ${c.note}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-muted-foreground">
                        {formatDate(new Date(c.createdAt).toISOString().slice(0, 10))}
                      </span>
                      <span className="font-medium">{formatCents(c.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <Link2 className="mr-2 h-4 w-4" /> Konto verknüpfen
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Konto mit „{goal.name}“ verknüpfen</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="space-y-2">
                    <Label>Konto</Label>
                    <Select value={linkAccount} onValueChange={setLinkAccount}>
                      <SelectTrigger><SelectValue placeholder="Konto wählen" /></SelectTrigger>
                      <SelectContent>
                        {linkableAccounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{accountLabel(a, banks)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {linkableAccounts.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Alle sichtbaren Konten sind bereits verknüpft.
                      </p>
                    )}
                    {availability.data && (
                      <p className="text-xs text-muted-foreground">
                        {availability.data.hasFullSource
                          ? 'Das Konto ist bereits vollständig verplant.'
                          : `Verfügbar: ${formatCents(availability.data.available)}${
                              availability.data.committedTotal > 0
                                ? ` (bereits verplant: ${formatCents(availability.data.committedTotal)})`
                                : ''
                            }`}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Modus</Label>
                    <Select value={linkMode} onValueChange={(v) => setLinkMode(v as typeof linkMode)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Ganzes Konto</SelectItem>
                        <SelectItem value="absolute">Absoluter Betrag</SelectItem>
                        <SelectItem value="percent">Prozent vom Saldo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {linkMode === 'absolute' && (
                    <div className="space-y-2">
                      <Label>Betrag ({currencySymbol()})</Label>
                      <Input inputMode="decimal" placeholder={amountPlaceholder} value={linkValue} onChange={(e) => setLinkValue(e.target.value)} />
                    </div>
                  )}
                  {linkMode === 'percent' && (
                    <div className="space-y-2">
                      <Label>Prozent (1–100)</Label>
                      <Input inputMode="numeric" placeholder="z. B. 50" value={linkValue} onChange={(e) => setLinkValue(e.target.value)} />
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLinkOpen(false)}>Abbrechen</Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitLink} disabled={addSource.isPending || linkableAccounts.length === 0}>Verknüpfen</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Goals() {
  const { goals, accounts, banks } = useFinanceData();
  const goalFc = trpc.forecast.goalForecast.useQuery();

  const forecastByGoal = new Map((goalFc.data ?? []).map((f) => [f.goalId, f]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sparziele</h1>
          <p className="text-sm text-muted-foreground">{goals.length} Ziele im Haushalt</p>
        </div>
        <GoalDialog
          trigger={
            <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Neues Ziel</Button>
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {goals.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-10 text-center text-muted-foreground">
              Noch keine Sparziele angelegt.
            </CardContent>
          </Card>
        )}
        {goals.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            accounts={accounts}
            banks={banks}
            forecast={forecastByGoal.get(g.id)}
          />
        ))}
      </div>
    </div>
  );
}
