import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, HandCoins, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { trpc } from '@/providers/trpc';
import { computeSettlements, formatCents, formatDate, memberBalances, todayISO } from '@/lib/finance';
import { cn } from '@/lib/utils';

// Kleine Farbpalette für neue Projekte (wie die Kategorien-Palette im Dialog)
const PROJECT_COLORS = ['#3b82f6', '#f59e0b', '#14b8a6', '#a855f7', '#ec4899', '#f43f5e', '#10b981', '#94a3b8'];

/** Projekt-Filter: 'all' = alles, 'household' = ohne Projekt, sonst Projekt-ID als Zahl */
type ProjectFilter = 'all' | 'household' | number;

export default function Splitting() {
  const { accounts, transactions, users, projects, splitTemplates } = useFinanceData();
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

  const sharedExpenses = filteredTransactions.filter((t) => t.type === 'expense' && t.splits.length > 0);
  const userById = (id: number) => users.find((u) => u.id === id);
  const projectById = (id: number | null) => projects.find((p) => p.id === id);

  // Projekt-Verwaltung (kleine Sektion unten auf der Seite)
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);

  const addProject = () => {
    const name = newProjectName.trim();
    if (!name) return;
    createProject.mutate({ name, color: newProjectColor });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Kostenaufteilung</h1>
        <p className="text-sm text-muted-foreground">
          Wer hat was bezahlt, wer schuldet wem etwas — basierend auf geteilten Ausgaben.
        </p>
      </div>

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
                  ? 'border-emerald-600 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'all' ? 'Alle' : 'Haushalt'}
            </button>
          ))}
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProjectFilter(p.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                projectFilter === p.id
                  ? 'border-emerald-600 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      )}

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
            const project = projectById(t.projectId);
            return (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {t.note || 'Ausgabe'}
                    {project && (
                      <Badge variant="secondary" className="text-[10px]" style={{ borderLeft: `3px solid ${project.color}` }}>
                        {project.name}
                      </Badge>
                    )}
                  </div>
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
              <div key={p.id} className="flex items-center justify-between rounded-lg border px-4 py-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}
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
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          {splitTemplates.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground">Gespeicherte Aufteilungsvorlagen</p>
              {splitTemplates.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border px-4 py-2">
                  <span className="text-sm font-medium">{t.name}</span>
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
