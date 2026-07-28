import { useMemo, useState } from 'react';
import { Check, Download, Paperclip, Pencil, Search, Tag, Trash2, Undo2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { formatCents, formatDate, getUserLocale } from '@/lib/finance';
import TransactionDialog from '@/components/TransactionDialog';
import TransactionAttachmentsDialog from '@/components/TransactionAttachmentsDialog';
import TransactionHistoryDialog from '@/components/TransactionHistoryDialog';
import CsvImportDialog from '@/components/CsvImportDialog';
import CamtImportDialog from '@/components/CamtImportDialog';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function Transactions() {
  const { accounts, banks, categories, transactions, users, projects, tags } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');

  const deleteTx = trpc.finance.deleteTransaction.useMutation({
    onSuccess: () => invalidate(),
  });

  const reverseTx = trpc.finance.reverseTransaction.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const setTxTags = trpc.finance.setTransactionTags.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err.message),
  });

  /** Tag an einer bestehenden Buchung an-/abwählen (Ersetzen-Semantik serverseitig) */
  const toggleTag = (tx: (typeof transactions)[number], tagId: number) => {
    const current = tx.tags.map((t) => t.id);
    const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
    setTxTags.mutate({ transactionId: tx.id, tagIds: next });
  };

  const utils = trpc.useUtils();
  const [exporting, setExporting] = useState(false);

  /** CSV-Export on demand abrufen und als Datei herunterladen */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await utils.finance.exportTransactionsCsv.fetch({ locale: getUserLocale() });
      // BOM, damit Excel die UTF-8-Umlaute korrekt erkennt
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transaktionen-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CSV-Export fehlgeschlagen.');
    } finally {
      setExporting(false);
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (accountFilter !== 'all' && t.accountId !== Number(accountFilter) && t.toAccountId !== Number(accountFilter)) return false;
      if (categoryFilter !== 'all' && t.categoryId !== Number(categoryFilter)) return false;
      if (userFilter !== 'all' && t.userId !== Number(userFilter)) return false;
      if (tagFilter !== 'all' && !t.tags.some((tag) => tag.id === Number(tagFilter))) return false;
      if (term) {
        const cat = categories.find((c) => c.id === t.categoryId);
        const haystack = `${t.note} ${cat?.name ?? ''} ${t.tags.map((tag) => tag.name).join(' ')} ${(t.amount / 100).toFixed(2)}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [transactions, categories, search, typeFilter, accountFilter, categoryFilter, userFilter, tagFilter]);

  const sum = filtered.reduce((acc, t) => {
    if (t.type === 'income') return acc + t.amount;
    if (t.type === 'expense') return acc - t.amount;
    return acc;
  }, 0);

  // Zugriffsstufe pro Konto (für den Bearbeiten-Button: nur bei „edit")
  const accessByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.access])),
    [accounts],
  );

  // IDs bereits stornierter Buchungen (es existiert eine Buchung mit stornoOfId = id)
  const reversedIds = useMemo(
    () => new Set(transactions.map((t) => t.stornoOfId).filter((id): id is number => id !== null)),
    [transactions],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Transaktionen</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} Buchungen · Saldo der Auswahl: {formatCents(sum)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" /> {exporting ? 'Exportiere…' : 'CSV exportieren'}
          </Button>
          <CsvImportDialog />
          <CamtImportDialog />
          <TransactionDialog />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Suchen…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Typ" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Typen</SelectItem>
                <SelectItem value="income">Einnahmen</SelectItem>
                <SelectItem value="expense">Ausgaben</SelectItem>
                <SelectItem value="transfer">Umbuchungen</SelectItem>
              </SelectContent>
            </Select>
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Konto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Konten</SelectItem>
                {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{accountLabel(a, banks)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Kategorie" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Kategorien</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Person" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Personen</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Tags</SelectItem>
                {tags.map((tag) => <SelectItem key={tag.id} value={String(tag.id)}>{tag.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead className="hidden md:table-cell">Kategorie</TableHead>
                <TableHead className="hidden lg:table-cell">Konto</TableHead>
                <TableHead className="hidden sm:table-cell">Person</TableHead>
                <TableHead className="text-right">Betrag</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Keine Buchungen gefunden.
                  </TableCell>
                </TableRow>
              )}
              {filtered.slice(0, 200).map((t) => {
                const cat = categories.find((c) => c.id === t.categoryId);
                const account = accounts.find((a) => a.id === t.accountId);
                const toAccount = accounts.find((a) => a.id === t.toAccountId);
                const user = users.find((u) => u.id === t.userId);
                const project = projects.find((p) => p.id === t.projectId);
                // Storno: diese Buchung ist eine Gegenbuchung bzw. wurde storniert
                const isStorno = t.stornoOfId !== null;
                const isReversed = reversedIds.has(t.id);
                const noteLabel = t.note || (t.type === 'transfer' ? 'Umbuchung' : 'ohne Notiz');
                // Art der Gegenbuchung für den Storno-Dialog
                const reversalLabel =
                  t.type === 'expense' ? 'Einnahme' : t.type === 'income' ? 'Ausgabe' : 'Umbuchung';
                // Saldo-Effekt des Löschens auf dem Quellkonto
                const deleteEffect =
                  t.type === 'income' ? `−${formatCents(t.amount)}` : `+${formatCents(t.amount)}`;
                return (
                  <TableRow key={t.id} className={cn((isStorno || isReversed) && 'opacity-60')}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{t.note || (t.type === 'transfer' ? 'Umbuchung' : '—')}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {isStorno && <Badge variant="outline" className="text-[10px]">Storno</Badge>}
                        {isReversed && <Badge variant="outline" className="text-[10px]">Storniert</Badge>}
                        {t.splits.length > 0 && <Badge variant="secondary" className="text-[10px]">geteilt</Badge>}
                        {t.changeCount > 0 && (
                          <TransactionHistoryDialog
                            transactionId={t.id}
                            note={t.note}
                            trigger={
                              <Badge
                                variant="secondary"
                                className="cursor-pointer text-[10px] hover:bg-muted"
                                title="Änderungsverlauf anzeigen"
                              >
                                bearbeitet
                              </Badge>
                            }
                          />
                        )}
                        {project && (
                          <Badge variant="secondary" className="text-[10px]" style={{ borderLeft: `3px solid ${project.color}` }}>
                            {project.name}
                          </Badge>
                        )}
                        {t.tags.map((tag) => (
                          <Badge key={tag.id} variant="secondary" className="gap-1 text-[10px]">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {cat ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.color }} />
                          {cat.name}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {t.type === 'transfer' ? `${account?.name ?? '?'} → ${toAccount?.name ?? '?'}` : account?.name ?? '—'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {user && (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: user.color }} />
                          {user.name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cn(
                      'whitespace-nowrap text-right font-semibold',
                      t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-rose-500' : 'text-muted-foreground',
                    )}>
                      {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{formatCents(t.amount)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        {accessByAccount.get(t.accountId) === 'edit' && (
                          // Key erzwingt ein Remount, wenn sich die Buchung
                          // ändert (Edit → changeCount, Tag-Popover → tags) —
                          // so befüllen die State-Initialisierer stets aktuell
                          <TransactionDialog
                            key={`${t.id}:${t.changeCount}:${t.tags.map((x) => x.id).join(',')}`}
                            transaction={t}
                            trigger={
                              <Button variant="ghost" size="icon" title="Bearbeiten">
                                <Pencil className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            }
                          />
                        )}
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" title="Tags bearbeiten">
                              <Tag className={cn(
                                'h-4 w-4',
                                t.tags.length > 0 ? 'text-emerald-600' : 'text-muted-foreground',
                              )} />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-2" align="end">
                            {tags.length === 0 ? (
                              <p className="px-1 py-2 text-xs text-muted-foreground">
                                Noch keine Tags — in den Einstellungen anlegen.
                              </p>
                            ) : (
                              <div className="space-y-0.5">
                                {tags.map((tag) => {
                                  const active = t.tags.some((x) => x.id === tag.id);
                                  return (
                                    <button
                                      key={tag.id}
                                      type="button"
                                      disabled={setTxTags.isPending}
                                      onClick={() => toggleTag(t, tag.id)}
                                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                                    >
                                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                                      <span className="flex-1 text-left">{tag.name}</span>
                                      {active && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                        <TransactionAttachmentsDialog
                          transactionId={t.id}
                          note={t.note}
                          attachments={t.attachments}
                          trigger={
                            <Button variant="ghost" size="icon" className="relative" title="Belege">
                              <Paperclip className={cn(
                                'h-4 w-4',
                                t.attachments.length > 0 ? 'text-emerald-600' : 'text-muted-foreground',
                              )} />
                              {t.attachments.length > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white">
                                  {t.attachments.length}
                                </span>
                              )}
                            </Button>
                          }
                        />
                        {accessByAccount.get(t.accountId) === 'edit' && !isStorno && !isReversed && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" title="Stornieren">
                                <Undo2 className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Buchung stornieren?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Es wird eine Gegenbuchung erstellt: {reversalLabel} über{' '}
                                  {formatCents(t.amount)}{' '}
                                  {t.type === 'transfer'
                                    ? `von „${toAccount?.name ?? '?'}“ zurück auf „${account?.name ?? '?'}“`
                                    : `auf „${account?.name ?? '?'}“`}{' '}
                                  (heutiges Datum). Beide Buchungen bleiben als storniert
                                  markiert sichtbar, der Saldo gleicht sich aus.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                <AlertDialogAction
                                  disabled={reverseTx.isPending}
                                  onClick={() => reverseTx.mutate({ id: t.id })}
                                >
                                  Stornieren
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="Löschen">
                              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Buchung wirklich löschen?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Die Buchung „{noteLabel}“ über {formatCents(t.amount)} vom{' '}
                                {formatDate(t.date)} wird endgültig gelöscht.{' '}
                                {t.type === 'transfer'
                                  ? `Der Saldo von „${account?.name ?? '?'}“ ändert sich um +${formatCents(t.amount)}, der von „${toAccount?.name ?? '?'}“ um −${formatCents(t.amount)}.`
                                  : `Der Saldo von „${account?.name ?? '?'}“ ändert sich um ${deleteEffect}.`}{' '}
                                Zugehörige Belege und die Änderungshistorie werden ebenfalls
                                gelöscht.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                disabled={deleteTx.isPending}
                                onClick={() => deleteTx.mutate({ id: t.id })}
                              >
                                Löschen
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {filtered.length > 200 && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Es werden die ersten 200 Treffer angezeigt — bitte Filter verfeinern.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
