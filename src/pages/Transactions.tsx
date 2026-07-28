import { useMemo, useState } from 'react';
import { Download, Paperclip, Search, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { formatCents, formatDate, getUserLocale } from '@/lib/finance';
import TransactionDialog from '@/components/TransactionDialog';
import TransactionAttachmentsDialog from '@/components/TransactionAttachmentsDialog';
import CsvImportDialog from '@/components/CsvImportDialog';
import CamtImportDialog from '@/components/CamtImportDialog';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function Transactions() {
  const { accounts, categories, transactions, users, projects } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');

  const deleteTx = trpc.finance.deleteTransaction.useMutation({
    onSuccess: () => invalidate(),
  });

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
      if (term) {
        const cat = categories.find((c) => c.id === t.categoryId);
        const haystack = `${t.note} ${cat?.name ?? ''} ${(t.amount / 100).toFixed(2)}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [transactions, categories, search, typeFilter, accountFilter, categoryFilter, userFilter]);

  const sum = filtered.reduce((acc, t) => {
    if (t.type === 'income') return acc + t.amount;
    if (t.type === 'expense') return acc - t.amount;
    return acc;
  }, 0);

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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Suchen…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue placeholder="Typ" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Typen</SelectItem>
                <SelectItem value="income">Einnahmen</SelectItem>
                <SelectItem value="expense">Ausgaben</SelectItem>
                <SelectItem value="transfer">Umbuchungen</SelectItem>
              </SelectContent>
            </Select>
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger><SelectValue placeholder="Konto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Konten</SelectItem>
                {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger><SelectValue placeholder="Kategorie" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Kategorien</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger><SelectValue placeholder="Person" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Personen</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
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
                return (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{t.note || (t.type === 'transfer' ? 'Umbuchung' : '—')}</div>
                      <div className="mt-1 flex gap-1">
                        {t.splits.length > 0 && <Badge variant="secondary" className="text-[10px]">geteilt</Badge>}
                        {project && (
                          <Badge variant="secondary" className="text-[10px]" style={{ borderLeft: `3px solid ${project.color}` }}>
                            {project.name}
                          </Badge>
                        )}
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
                        <Button variant="ghost" size="icon" onClick={() => deleteTx.mutate({ id: t.id })} title="Löschen">
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
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
