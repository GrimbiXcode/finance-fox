import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, CheckCircle2, HandCoins, Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { trpc } from '@/providers/trpc';
import { computeSettlements, formatCents, formatDate, memberBalances, todayISO } from '@/lib/finance';
import { cn } from '@/lib/utils';
import { isSettlementShape } from '@contracts/settlement';
import { PENCIL_COLORS, pencil } from '@/lib/pencil';
import ProjectSummaryCard from '@/components/ProjectSummaryCard';
import Note from '@/components/Note';
import { useActions } from '@/providers/actions';
import { useAuth } from '@/providers/auth';

// Kleine Farbpalette für neue Projekte (wie die Kategorien-Palette im Dialog)
const PROJECT_COLORS = PENCIL_COLORS;

/** Projekt-Filter: 'all' = alles, 'household' = ohne Projekt, sonst Projekt-ID als Zahl */
type ProjectFilter = 'all' | 'household' | number;

export default function Splitting() {
  const { accounts, users, projects, splitTemplates } = useFinanceData();
  const { user } = useAuth();
  const { show } = useActions();
  // Deaktivierte Personen zählen für alte Salden, aber nicht als Mitbewohner
  const activeCount = users.filter((u) => u.active).length;
  // Nur Buchungen mit Aufteilung — mehr braucht die Seite nicht
  const sharedQuery = trpc.finance.listTransactions.useQuery({ sharedOnly: true });
  const transactions = useMemo(() => sharedQuery.data ?? [], [sharedQuery.data]);
  const invalidate = useInvalidateFinance();
  const userIds = users.map((u) => u.id);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');

  // Salden/Ausgleich rechnen immer über die gefilterten Buchungen:
  // „Haushalt" = projectId null, Projekt = dessen Buchungen, „Alle" = ungefiltert
  const filteredTransactions = useMemo(() => {
    if (projectFilter === 'all') return transactions;
    if (projectFilter === 'household') return transactions.filter((t) => t.projectId === null);
    return transactions.filter((t) => t.projectId === projectFilter);
  }, [transactions, projectFilter]);

  const balances = memberBalances(filteredTransactions, userIds);
  const settlements = computeSettlements(filteredTransactions, userIds);

  // Erstes Konto mit Bearbeitungsrecht — dahin wird der Ausgleich gebucht.
  const editAccount = accounts.find((a) => a.access === 'edit');

  const settle = trpc.finance.createTransaction.useMutation({
    onSuccess: () => {
      toast.success('Ausgleich verbucht.');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const createProject = trpc.finance.createProject.useMutation({
    onSuccess: () => {
      toast.success('Projekt angelegt.');
      setNewProjectName('');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteProject = trpc.finance.deleteProject.useMutation({
    onSuccess: () => {
      toast.success('Projekt gelöscht.');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteTemplate = trpc.finance.deleteSplitTemplate.useMutation({
    onSuccess: () => {
      toast.success('Vorlage gelöscht.');
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
      // Bei gewähltem Projekt gehört auch die Ausgleichsbuchung dazu
      projectId: typeof projectFilter === 'number' ? projectFilter : undefined,
      date: todayISO(),
      note: `Ausgleich an ${to?.name ?? 'Unbekannt'}`,
      splits: [{ userId: toId, amount }],
    });
  };

  // Ausgleiche stehen in ihrer eigenen Karte, nicht noch einmal als Ausgabe
  const sharedExpenses = filteredTransactions.filter(
    (t) => t.type === 'expense' && t.splits.length > 0 && !isSettlementShape(t),
  );
  // Verbuchte Ausgleiche erkennt man an ihrer Form (siehe bookSettlement):
  // eine Ausgabe, die vollständig eine andere Person trägt. Stornierte zählen
  // nicht (Gegenbuchung hebt sie auf).
  const settlementsDone = filteredTransactions
    .filter((t) => t.stornoOfId === null && !t.isReversed && isSettlementShape(t))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const lastSettlement = settlementsDone[0];
  const userById = (id: number) => users.find((u) => u.id === id);
  const projectById = (id: number | null) => projects.find((p) => p.id === id);

  // Projekt-Verwaltung (kleine Sektion unten auf der Seite)
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState<string>(PROJECT_COLORS[0]);

  const addProject = () => {
    const name = newProjectName.trim();
    if (!name) return;
    createProject.mutate({ name, color: newProjectColor });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Kostenaufteilung</h1>
        <p className="text-sm text-muted-foreground">
          Wer hat was bezahlt, wer schuldet wem etwas — basierend auf geteilten Ausgaben.
        </p>
      </div>

      {/* Allein gibt es nichts aufzuteilen (A3): erklären statt leerer Salden */}
      {activeCount < 2 && (
        <Note title="Aufteilen braucht eine zweite Person" icon={UserPlus}>
          <p>
            Hier siehst du, wer im Haushalt wie viel vorgestreckt hat und wer wem etwas schuldet.
            Dafür muss eine weitere Person im Haushalt sein.
          </p>
          {user?.role === 'admin' ? (
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link to="/personen">Person einladen</Link>
            </Button>
          ) : (
            <p className="mt-1">Eine Person mit Admin-Rechten kann sie unter „Personen“ einladen.</p>
          )}
        </Note>
      )}

      {projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'household'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setProjectFilter(value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                projectFilter === value
                  ? 'border-stamp bg-stamp/10 text-stamp'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'all' ? 'Alle' : 'Haushalt'}
            </button>
          ))}
          {/* Laufende Projekte zuerst; abgeschlossene bleiben wählbar (Salden,
              Rückblick), stehen aber hinten und tragen ein Häkchen */}
          {[...projects].sort((a, b) => Number(!!a.closedAt) - Number(!!b.closedAt)).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProjectFilter(p.id)}
              title={p.closedAt ? `Abgeschlossen am ${formatDate(p.closedAt)}` : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                projectFilter === p.id
                  ? 'border-stamp bg-stamp/10 text-stamp'
                  : 'text-muted-foreground hover:text-foreground',
                p.closedAt && projectFilter !== p.id && 'border-dashed',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pencil(p.color) }} />
              {p.name}
              {p.closedAt && <Check className="h-3 w-3" aria-label="abgeschlossen" />}
            </button>
          ))}
        </div>
      )}

      {/* Projekt gewählt: Gesamtkosten, Zeitraum, wer hat wie viel getragen */}
      {typeof projectFilter === 'number' && <ProjectSummaryCard projectId={projectFilter} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aktuelle Salden</CardTitle>
            <CardDescription>
              Positiv = bekommt Geld · Negativ = schuldet Geld
              {lastSettlement && ` · letzter Ausgleich am ${formatDate(lastSettlement.date)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {users.map((u) => {
              const bal = balances.get(u.id) ?? 0;
              return (
                <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg border px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: pencil(u.color) }}>
                      {u.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="truncate font-medium" title={u.name}>{u.name}</span>
                  </div>
                  <span className={cn('shrink-0 font-serif text-lg font-semibold tabular-nums', bal > 0 ? 'text-positive' : bal < 0 ? 'text-negative' : 'text-muted-foreground')}>
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
              <div className="flex items-center gap-2 rounded-lg border border-positive/30 bg-positive/5 px-4 py-3 text-sm text-positive">
                <CheckCircle2 className="h-4 w-4" />
                Alles ausgeglichen — niemand schuldet jemandem etwas.
              </div>
            ) : (
              settlements.map((s, idx) => {
                const from = userById(s.fromId);
                const to = userById(s.toId);
                return (
                  <div key={idx} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: pencil(from?.color) }}>
                        {from?.name.slice(0, 2).toUpperCase()}
                      </span>
                      {from?.name}
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: pencil(to?.color) }}>
                        {to?.name.slice(0, 2).toUpperCase()}
                      </span>
                      {to?.name}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-serif text-lg font-semibold tabular-nums">{formatCents(s.amount)}</span>
                      <Button
                        size="sm"
                        variant="stamp"
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

      {/* Ausgleichshistorie (H3): wann wurde zuletzt ausgeglichen? */}
      {settlementsDone.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Verbuchte Ausgleiche</CardTitle>
            <CardDescription>Rückzahlungen zwischen euch — neueste zuerst</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {settlementsDone.slice(0, 5).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{userById(t.userId)?.name ?? '?'}</span>
                    {' → '}
                    <span className="font-medium">{userById(t.splits[0].userId)?.name ?? '?'}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{formatDate(t.date)}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{formatCents(t.amount)}</span>
                </li>
              ))}
            </ul>
            {settlementsDone.length > 5 && (
              <p className="pt-2 text-xs text-muted-foreground">+ {settlementsDone.length - 5} ältere</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Geteilte Ausgaben</CardTitle>
          <CardDescription>{sharedExpenses.length} Buchungen mit Aufteilung</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {sharedExpenses.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">
                Noch keine geteilten Ausgaben. Beim Erfassen einer Ausgabe unter „Kosten aufteilen“
                angeben, wer welchen Anteil trägt.
              </p>
              {activeCount > 1 && (
                <Button variant="outline" size="sm" onClick={() => show('transaction')}>
                  <Plus className="mr-2 h-4 w-4" /> Ausgabe erfassen
                </Button>
              )}
            </div>
          )}
          {sharedExpenses.slice(0, 50).map((t) => {
            const payer = userById(t.userId);
            const project = projectById(t.projectId);
            return (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {t.note || 'Ausgabe'}
                    {project && (
                      <Badge variant="label" style={{ borderLeft: `3px solid ${pencil(project.color)}` }}>
                        {project.name}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(t.date)} · bezahlt von {payer?.name}
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {t.splits.map((s) => {
                      const u = userById(s.userId);
                      return (
                        <Badge key={s.userId} variant="label" style={{ borderLeft: `3px solid ${pencil(u?.color) ?? '#999'}` }}>
                          {u?.name}: {formatCents(s.amount)}
                        </Badge>
                      );
                    })}
                  </div>
                  <span className="font-semibold text-negative">−{formatCents(t.amount)}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projekte &amp; Vorlagen</CardTitle>
          <CardDescription>
            Projekte bündeln geteilte Ausgaben (z. B. ein Urlaub) getrennt vom laufenden Haushalt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground">Noch keine Projekte angelegt.</p>
            )}
            {projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border px-4 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: pencil(p.color) }} />
                  <span className="truncate">{p.name}</span>
                  {p.closedAt && (
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      abgeschlossen am {formatDate(p.closedAt)}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Projekt löschen"
                  disabled={deleteProject.isPending}
                  onClick={() => deleteProject.mutate({ id: p.id })}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="Neues Projekt, z. B. Urlaub 2026"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={!newProjectName.trim() || createProject.isPending}
                onClick={addProject}
              >
                <Plus className="h-4 w-4" /> Anlegen
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setNewProjectColor(c)}
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-transform',
                    newProjectColor === c ? 'scale-110 border-foreground' : 'border-transparent',
                  )}
                  style={{ backgroundColor: pencil(c) }}
                />
              ))}
            </div>
          </div>
          {splitTemplates.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground">Gespeicherte Aufteilungsvorlagen</p>
              {splitTemplates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border px-4 py-2">
                  <span className="min-w-0 text-sm font-medium">{t.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Vorlage löschen"
                    disabled={deleteTemplate.isPending}
                    onClick={() => deleteTemplate.mutate({ id: t.id })}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
