import { useState, type ReactNode } from 'react';
import {
  ArrowRight, LayoutGrid, Pause, Pencil, Play, Plus, Table as TableIcon, Zap,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useTableSort } from '@/lib/sort';
import { useAuth } from '@/providers/auth';
import { amountPlaceholder, currencySymbol, formatCents, formatDate, parseEuro, todayISO } from '@/lib/finance';
import { isRecurringArchived, sortRecurring } from '@/lib/recurring';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import {
  RECURRING_INTERVAL_LABELS, RECURRING_INTERVALS, type RecurringInterval,
} from '@contracts/types';
import { toast } from 'sonner';

type Interval = RecurringInterval;
const intervalLabel = RECURRING_INTERVAL_LABELS;
type RecType = 'income' | 'expense' | 'transfer';
const typeLabel: Record<RecType, string> = {
  expense: 'Ausgabe', income: 'Einnahme', transfer: 'Umbuchung',
};

type ViewMode = 'cards' | 'table';
const VIEW_KEY = 'ff-recurring-view';

/** Letzte Darstellungsart aus localStorage lesen (Default: Karten) */
const readViewMode = (): ViewMode =>
  localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';

type RecurringRow = ReturnType<typeof useFinanceData>['recurring'][number];

/** Sortierreihenfolge der Intervalle: kurz vor lang (Reihenfolge im Contract) */
const intervalOrder = (i: Interval): number => RECURRING_INTERVALS.indexOf(i);

/** Sortierbare Spalten der Tabellenansicht */
type RecSortKey = 'type' | 'note' | 'person' | 'amount' | 'interval' | 'nextDate' | 'status';

/** Formularwerte als Strings (1:1 an die Input-Felder gebunden) */
interface RecurringFormValues {
  type: RecType;
  amount: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  userId: string;
  note: string;
  interval: Interval;
  nextDate: string;
  endDate: string; // leer = kein Ende
}

const emptyForm = (): RecurringFormValues => ({
  type: 'expense', amount: '', accountId: '', toAccountId: '', categoryId: '',
  userId: '', note: '', interval: 'monthly', nextDate: todayISO(), endDate: '',
});

const formFromRow = (r: RecurringRow): RecurringFormValues => ({
  type: r.type,
  amount: (r.amount / 100).toString(),
  accountId: String(r.accountId),
  toAccountId: r.toAccountId ? String(r.toAccountId) : '',
  categoryId: r.categoryId ? String(r.categoryId) : '',
  userId: String(r.userId),
  note: r.note,
  interval: r.interval,
  nextDate: r.nextDate,
  endDate: r.endDate ?? '',
});

/**
 * Gemeinsames Formular für Anlegen und Bearbeiten — im Edit-Modus ist die
 * Art-Wahl deaktiviert (die Art einer Dauerbuchung ist unveränderlich).
 */
function RecurringForm({
  initial, editMode, isPending, submitLabel, onCancel, onSubmit, dangerZone,
}: {
  initial: RecurringFormValues;
  editMode: boolean;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: RecurringFormValues) => void;
  /** Gefahrenzone (Löschen) — nur im Edit-Modus übergeben */
  dangerZone?: ReactNode;
}) {
  const { user } = useAuth();
  const { accounts, banks, categories, users } = useFinanceData();
  const [values, setValues] = useState(initial);
  const set = <K extends keyof RecurringFormValues>(key: K, value: RecurringFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const typeButton = (t: RecType, label: string, activeClass: string) => (
    <Button
      type="button"
      variant={values.type === t ? 'default' : 'outline'}
      className={values.type === t ? activeClass : ''}
      disabled={editMode}
      title={editMode ? 'Die Art kann nicht geändert werden — lösche die Dauerbuchung und lege sie neu an.' : undefined}
      onClick={() => set('type', t)}
    >
      {label}
    </Button>
  );

  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid grid-cols-3 gap-2">
          {typeButton('expense', 'Ausgabe', 'bg-rose-600 hover:bg-rose-700')}
          {typeButton('income', 'Einnahme', 'bg-emerald-600 hover:bg-emerald-700')}
          {typeButton('transfer', 'Umbuchung', 'bg-sky-600 hover:bg-sky-700')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Betrag ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={values.amount} onChange={(e) => set('amount', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Intervall</Label>
            <Select value={values.interval} onValueChange={(v) => set('interval', v as Interval)}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate" title={intervalLabel[values.interval]}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(intervalLabel).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{values.type === 'transfer' ? 'Von Konto' : 'Konto'}</Label>
            <SearchableSelect
              value={values.accountId}
              onValueChange={(v) => set('accountId', v)}
              placeholder="Konto wählen"
              options={accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }))}
            />
          </div>
          {values.type === 'transfer' ? (
            <div className="space-y-2">
              <Label>Nach Konto</Label>
              <SearchableSelect
                value={values.toAccountId}
                onValueChange={(v) => set('toAccountId', v)}
                placeholder="Zielkonto"
                options={accounts
                  .filter((a) => String(a.id) !== values.accountId)
                  .map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }))}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Kategorie</Label>
              {/* Sentinel „none" statt leerem String — intern bleibt „keine
                  Kategorie" der leere String (submit mappt auf undefined/null) */}
              <SearchableSelect
                value={values.categoryId || 'none'}
                onValueChange={(v) => set('categoryId', v === 'none' ? '' : v)}
                placeholder="Optional"
                options={[
                  { value: 'none', label: 'Keine Kategorie' },
                  ...categories
                    .filter((c) => c.type === values.type)
                    .map((c) => ({ value: String(c.id), label: c.name })),
                ]}
              />
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Person</Label>
            <SearchableSelect
              value={values.userId}
              onValueChange={(v) => set('userId', v)}
              placeholder={user?.name}
              options={users.map((u) => ({ value: String(u.id), label: u.name }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Nächste Fälligkeit</Label>
            <Input type="date" value={values.nextDate} onChange={(e) => set('nextDate', e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Enddatum (optional)</Label>
          <Input type="date" value={values.endDate} onChange={(e) => set('endDate', e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Leer = läuft unbegrenzt; nach diesem Datum wird nichts mehr gebucht.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Notiz</Label>
          <Input placeholder="z. B. Miete" value={values.note} onChange={(e) => set('note', e.target.value)} />
        </div>
        {dangerZone}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Abbrechen</Button>
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onSubmit(values)} disabled={isPending}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export default function Recurring() {
  const { user } = useAuth();
  const { accounts, banks, categories, recurring, users } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRow | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [view, setView] = useState<ViewMode>(readViewMode);

  const createRecurring = trpc.finance.createRecurring.useMutation({
    onSuccess: () => {
      toast.success('Dauerbuchung angelegt — fällige Buchungen erzeugt der Server automatisch.');
      invalidate();
      setOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const updateRecurring = trpc.finance.updateRecurring.useMutation({
    onSuccess: () => {
      toast.success('Dauerbuchung aktualisiert.');
      invalidate();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });
  const toggle = trpc.finance.toggleRecurring.useMutation({ onSuccess: () => invalidate() });
  const remove = trpc.finance.deleteRecurring.useMutation({
    onSuccess: () => {
      toast.success('Dauerbuchung gelöscht.');
      invalidate();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });
  const runNow = trpc.finance.runRecurringNow.useMutation({
    onSuccess: (res) => {
      toast.success(res.created > 0 ? `${res.created} fällige Buchung(en) verbucht.` : 'Keine fälligen Buchungen.');
      invalidate();
    },
  });

  const switchView = (v: ViewMode) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  /** Gemeinsame Vorab-Prüfung für Anlegen und Bearbeiten */
  const validateForm = (v: RecurringFormValues) => {
    const cents = parseEuro(v.amount);
    const accId = Number(v.accountId) || accounts[0]?.id;
    const toAccId = Number(v.toAccountId);
    if (cents <= 0 || !accId) { toast.error('Betrag und Konto angeben.'); return null; }
    if (v.type === 'transfer' && (!toAccId || toAccId === accId)) {
      toast.error('Zielkonto muss ein anderes Konto sein.'); return null;
    }
    if (v.endDate && v.endDate < v.nextDate) {
      toast.error('Das Enddatum darf nicht vor der nächsten Fälligkeit liegen.'); return null;
    }
    return { cents, accId, toAccId };
  };

  const submitCreate = (v: RecurringFormValues) => {
    const parsed = validateForm(v);
    if (!parsed) return;
    createRecurring.mutate({
      type: v.type, amount: parsed.cents, accountId: parsed.accId,
      toAccountId: v.type === 'transfer' ? parsed.toAccId : undefined,
      categoryId: v.type !== 'transfer' && v.categoryId ? Number(v.categoryId) : undefined,
      userId: Number(v.userId) || user?.id || 0,
      note: v.note.trim(), interval: v.interval, nextDate: v.nextDate,
      endDate: v.endDate || undefined,
    });
  };

  const submitEdit = (v: RecurringFormValues) => {
    if (!editing) return;
    const parsed = validateForm(v);
    if (!parsed) return;
    updateRecurring.mutate({
      id: editing.id,
      amount: parsed.cents,
      accountId: parsed.accId,
      toAccountId: v.type === 'transfer' ? parsed.toAccId : undefined,
      // Leere Kategorie entfernen (null), Umbuchungen haben keine Kategorie
      categoryId: v.type !== 'transfer' ? (v.categoryId ? Number(v.categoryId) : null) : undefined,
      userId: Number(v.userId) || editing.userId,
      note: v.note.trim(),
      interval: v.interval,
      nextDate: v.nextDate,
      // Leeres Feld entfernt das Enddatum (null)
      endDate: v.endDate ? v.endDate : null,
    });
  };

  const accessById = new Map(accounts.map((a) => [a.id, a.access]));
  const canEdit = (r: RecurringRow) => accessById.get(r.accountId) === 'edit';

  const today = todayISO();
  /** Abgelaufen = Enddatum gesetzt UND vor heute — wird „archiviert" dargestellt */
  const isArchived = (r: RecurringRow) => isRecurringArchived(r, today);

  const filtered = recurring.filter((r) => {
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    if (accountFilter !== 'all') {
      const id = Number(accountFilter);
      if (r.accountId !== id && r.toAccountId !== id) return false;
    }
    // Archivierte bilden einen eigenen Status (überschreibt aktiv/pausiert)
    if (statusFilter === 'active' && (isArchived(r) || !r.active)) return false;
    if (statusFilter === 'paused' && (isArchived(r) || r.active)) return false;
    if (statusFilter === 'archived' && !isArchived(r)) return false;
    if (userFilter !== 'all' && r.userId !== Number(userFilter)) return false;
    return true;
  });

  // Laufende Dauerbuchungen (nach nächster Fälligkeit) zuerst, archivierte ans Ende
  const displayed = sortRecurring(filtered, today);

  // Clientseitige Sortierung der Tabellenansicht (wirkt auf die gefilterte Liste)
  const { toggleSort, sorted, iconFor, isActive } = useTableSort<RecSortKey, RecurringRow>({
    type: (r) => typeLabel[r.type],
    note: (r) =>
      r.note ||
      (r.type === 'transfer' ? 'Umbuchung' : categories.find((c) => c.id === r.categoryId)?.name ?? ''),
    person: (r) => users.find((u) => u.id === r.userId)?.name ?? '',
    amount: (r) => r.amount,
    interval: (r) => intervalOrder(r.interval),
    nextDate: (r) => r.nextDate,
    status: (r) => (isArchived(r) ? 2 : r.active ? 0 : 1), // aktiv < pausiert < archiviert
  });

  /** Sortierbarer Spaltenkopf: Klick schaltet die Sortierung, Pfeil-Icon zeigt sie an */
  const sortableHead = (key: RecSortKey, label: string, className?: string) => {
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

  const editButton = (r: RecurringRow) =>
    canEdit(r) ? (
      <Button variant="ghost" size="icon" title="Bearbeiten" onClick={() => setEditing(r)}>
        <Pencil className="h-4 w-4 text-muted-foreground hover:text-foreground" />
      </Button>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Wiederkehrende Buchungen</h1>
          <p className="text-sm text-muted-foreground">
            Der Server verbucht fällige Dauerbuchungen automatisch täglich (03:00 Uhr) und bei jedem Start.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            <Zap className="mr-2 h-4 w-4" /> Jetzt verbuchen
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Neue Dauerbuchung</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader><DialogTitle>Neue wiederkehrende Buchung</DialogTitle></DialogHeader>
              <RecurringForm
                initial={emptyForm()}
                editMode={false}
                isPending={createRecurring.isPending}
                submitLabel="Anlegen"
                onCancel={() => setOpen(false)}
                onSubmit={submitCreate}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger
            className="w-40 min-w-0 [&>span]:truncate"
            title={{ all: 'Alle Typen', expense: 'Ausgaben', income: 'Einnahmen', transfer: 'Umbuchungen' }[typeFilter]}
          >
            <SelectValue placeholder="Typ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            <SelectItem value="expense">Ausgaben</SelectItem>
            <SelectItem value="income">Einnahmen</SelectItem>
            <SelectItem value="transfer">Umbuchungen</SelectItem>
          </SelectContent>
        </Select>
        <SearchableSelect
          value={accountFilter}
          onValueChange={setAccountFilter}
          placeholder="Konto"
          className="w-44"
          options={[
            { value: 'all', label: 'Alle Konten' },
            ...accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) })),
          ]}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger
            className="w-36 min-w-0 [&>span]:truncate"
            title={{ all: 'Alle Status', active: 'Aktiv', paused: 'Pausiert', archived: 'Archiviert' }[statusFilter]}
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="active">Aktiv</SelectItem>
            <SelectItem value="paused">Pausiert</SelectItem>
            <SelectItem value="archived">Archiviert</SelectItem>
          </SelectContent>
        </Select>
        <SearchableSelect
          value={userFilter}
          onValueChange={setUserFilter}
          placeholder="Person"
          className="w-40"
          options={[
            { value: 'all', label: 'Alle Personen' },
            ...users.map((u) => ({ value: String(u.id), label: u.name })),
          ]}
        />
        <span className="text-sm text-muted-foreground">
          {filtered.length} von {recurring.length} Dauerbuchungen
        </span>
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

      {recurring.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Noch keine Dauerbuchungen angelegt.
          </CardContent>
        </Card>
      )}
      {recurring.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Keine Dauerbuchungen für diese Filterauswahl.
          </CardContent>
        </Card>
      )}

      {view === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {displayed.map((r) => {
            const cat = categories.find((c) => c.id === r.categoryId);
            const account = accounts.find((a) => a.id === r.accountId);
            const toAccount = r.toAccountId ? accounts.find((a) => a.id === r.toAccountId) : undefined;
            const owner = users.find((u) => u.id === r.userId);
            const archived = isArchived(r);
            return (
              <Card key={r.id} className={cn((!r.active || archived) && 'opacity-60')}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base">
                        {r.note || (r.type === 'transfer' ? 'Umbuchung' : cat?.name) || 'Dauerbuchung'}
                      </CardTitle>
                      <CardDescription className="flex flex-wrap items-center gap-1">
                        {r.type === 'transfer' ? (
                          <>
                            {account?.name ?? '?'}
                            <ArrowRight className="h-3 w-3" />
                            {toAccount?.name ?? '?'}
                            {' · '}{owner?.name}
                          </>
                        ) : (
                          <>{account?.name} · {owner?.name}</>
                        )}
                      </CardDescription>
                    </div>
                    <Badge variant={r.active && !archived ? 'default' : 'secondary'} className={r.active && !archived ? 'bg-emerald-600' : ''}>
                      {archived ? 'Archiviert' : r.active ? 'Aktiv' : 'Pausiert'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className={cn(
                      'text-xl font-bold',
                      r.type === 'income' && 'text-emerald-600',
                      r.type === 'expense' && 'text-rose-500',
                    )}>
                      {r.type === 'income' ? '+' : r.type === 'expense' ? '−' : ''}{formatCents(r.amount)}
                    </span>
                    <span className="text-sm text-muted-foreground">{intervalLabel[r.interval]}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {archived ? (
                      <>Ende: <span className="font-medium text-foreground">{formatDate(r.endDate!)}</span></>
                    ) : (
                      <>
                        Nächste Fälligkeit: <span className="font-medium text-foreground">{formatDate(r.nextDate)}</span>
                        {r.endDate && <> · endet {formatDate(r.endDate)}</>}
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {canEdit(r) && (
                      <Button variant="outline" size="sm" onClick={() => setEditing(r)} title="Bearbeiten">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => toggle.mutate({ id: r.id })}>
                      {r.active ? <><Pause className="mr-1.5 h-3.5 w-3.5" /> Pausieren</> : <><Play className="mr-1.5 h-3.5 w-3.5" /> Fortsetzen</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        filtered.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                {sortableHead('type', 'Typ')}
                {sortableHead('note', 'Notiz')}
                <TableHead>Von → Nach</TableHead>
                {sortableHead('person', 'Person')}
                {sortableHead('amount', 'Betrag', 'text-right')}
                {sortableHead('interval', 'Intervall')}
                {sortableHead('nextDate', 'Nächster Termin')}
                {sortableHead('status', 'Status')}
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted(displayed).map((r) => {
                const cat = categories.find((c) => c.id === r.categoryId);
                const account = accounts.find((a) => a.id === r.accountId);
                const toAccount = r.toAccountId ? accounts.find((a) => a.id === r.toAccountId) : undefined;
                const archived = isArchived(r);
                return (
                  <TableRow key={r.id} className={cn((!r.active || archived) && 'opacity-60')}>
                    <TableCell>
                      <Badge variant="outline">{typeLabel[r.type]}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{r.note || (r.type === 'transfer' ? 'Umbuchung' : cat?.name) || '—'}</span>
                        {cat && (
                          <Badge variant="secondary" className="text-[10px]">{cat.name}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.type === 'transfer' ? (
                        <span className="flex items-center gap-1">
                          {account?.name ?? '?'}
                          <ArrowRight className="h-3 w-3" />
                          {toAccount?.name ?? '?'}
                        </span>
                      ) : (
                        account?.name ?? '?'
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const owner = users.find((u) => u.id === r.userId);
                        return owner ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: owner.color }} />
                            {owner.name}
                          </span>
                        ) : '—';
                      })()}
                    </TableCell>
                    <TableCell className={cn(
                      'text-right font-bold',
                      r.type === 'income' && 'text-emerald-600',
                      r.type === 'expense' && 'text-rose-500',
                    )}>
                      {r.type === 'income' ? '+' : r.type === 'expense' ? '−' : ''}{formatCents(r.amount)}
                    </TableCell>
                    <TableCell>{intervalLabel[r.interval]}</TableCell>
                    <TableCell>{formatDate(r.nextDate)}</TableCell>
                    <TableCell>
                      <Badge variant={r.active && !archived ? 'default' : 'secondary'} className={r.active && !archived ? 'bg-emerald-600' : ''}>
                        {archived ? 'Archiviert' : r.active ? 'Aktiv' : 'Pausiert'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {editButton(r)}
                        <Button
                          variant="ghost" size="icon"
                          title={r.active ? 'Pausieren' : 'Fortsetzen'}
                          onClick={() => toggle.mutate({ id: r.id })}
                        >
                          {r.active
                            ? <Pause className="h-4 w-4 text-muted-foreground" />
                            : <Play className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Dauerbuchung bearbeiten</DialogTitle></DialogHeader>
          {editing && (
            <RecurringForm
              key={editing.id}
              initial={formFromRow(editing)}
              editMode
              isPending={updateRecurring.isPending}
              submitLabel="Speichern"
              onCancel={() => setEditing(null)}
              onSubmit={submitEdit}
              dangerZone={
                <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
                  <p className="text-sm font-semibold text-destructive">Gefahrenzone</p>
                  <p className="text-xs text-muted-foreground">
                    Die Dauerbuchung wird unwiderruflich gelöscht. Bereits verbuchte
                    Buchungen bleiben bestehen.
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={remove.isPending}>
                        Dauerbuchung endgültig löschen
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Dauerbuchung wirklich löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          „{editing.note || typeLabel[editing.type]}“ wird unwiderruflich
                          gelöscht. Bereits verbuchte Buchungen bleiben bestehen.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => remove.mutate({ id: editing.id })}
                        >
                          Löschen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
