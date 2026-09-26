import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import {
  Check, ChevronLeft, ChevronRight, Download, Paperclip, Pencil, Search, SlidersHorizontal, Tag,
  Trash2, Undo2, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
import { SearchableSelect } from '@/components/SearchableSelect';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { saveBlobAsFile } from '@/lib/download';
import { formatCents, formatDate, formatMonth, getUserLocale, todayISO } from '@/lib/finance';
import {
  PERIOD_PRESET_LABELS, isFuturePeriod, matchingPreset, parsePeriod, periodParams, periodRange,
  presetPeriod, shiftPeriod, type Period, type PeriodPreset,
} from '@contracts/period';
import TransactionDialog from '@/components/TransactionDialog';
import TransactionAttachmentsDialog from '@/components/TransactionAttachmentsDialog';
import TransactionHistoryDialog from '@/components/TransactionHistoryDialog';
import CsvImportDialog from '@/components/CsvImportDialog';
import CamtImportDialog from '@/components/CamtImportDialog';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { pencil } from '@/lib/pencil';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';

type TxItem = inferRouterOutputs<AppRouter>['finance']['searchTransactions']['items'][number];
type Grouping = 'day' | 'month' | 'none';

const PAGE_SIZE = 50;
const GROUP_KEY = 'ff-tx-group';
const FILTER_KEYS = ['typ', 'konto', 'kategorie', 'person', 'tag', 'q'] as const;
const PERIOD_KEYS = ['monat', 'jahr', 'von', 'bis', 'zeit'] as const;

function readGrouping(): Grouping {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return v === 'month' || v === 'none' ? v : 'day';
  } catch {
    return 'day';
  }
}

function periodLabel(period: Period): string {
  switch (period.kind) {
    case 'month':
      return formatMonth(period.month);
    case 'year':
      return String(period.year);
    case 'range':
      return `${formatDate(period.from)} – ${formatDate(period.to)}`;
    case 'all':
      return 'Alle Zeiträume';
  }
}

/** Gruppenkopf: Datum bzw. Monat, Anzahl, Netto der geladenen Buchungen */
function groupLabel(key: string, grouping: Grouping): string {
  if (grouping === 'month') return formatMonth(key);
  return new Date(`${key}T12:00:00`).toLocaleDateString(getUserLocale(), {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

const signedAmount = (t: { type: string; amount: number }) =>
  t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0;

export default function Transactions() {
  const { accounts, banks, categories, users, projects, tags } = useFinanceData();
  const invalidate = useInvalidateFinance();
  // Filter und Zeitraum stehen in der URL (`#/transaktionen?monat=2026-08&kategorie=12`):
  // teilbar, überleben ein Neuladen, und andere Seiten verlinken direkt auf
  // eine gefilterte Liste (Dashboard → Kategorie des Monats).
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const period = parsePeriod((k) => params.get(k), today);
  const param = (key: string) => params.get(key) ?? 'all';
  const setParam = (key: string, value: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      next.delete('fokus');
      return next;
    }, { replace: true });
  const setPeriod = (p: Period) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const k of PERIOD_KEYS) next.delete(k);
      next.delete('fokus');
      // Der laufende Monat ist der Standard und braucht keinen Parameter
      const isDefault = p.kind === 'month' && p.month === today.slice(0, 7);
      if (!isDefault) for (const [k, v] of Object.entries(periodParams(p))) next.set(k, v);
      return next;
    }, { replace: true });

  const typeFilter = param('typ');
  const accountFilter = param('konto');
  const categoryFilter = param('kategorie');
  const userFilter = param('person');
  const tagFilter = param('tag');
  const searchParam = params.get('q') ?? '';
  const focusId = Number(params.get('fokus')) || null;
  const activeFilterCount = FILTER_KEYS.filter((k) => k !== 'q' && params.has(k)).length;

  // Suchfeld lokal halten und verzögert in die URL schreiben — sonst lädt
  // jeder Tastendruck die Liste neu. Verglichen wird getrimmt (sonst frisst
  // das Zurückspiegeln ein gerade getipptes Leerzeichen), geschrieben über
  // eine Ref auf den aktuellen Setter (sonst setzte der Timer die Filter
  // eines älteren Renders zurück).
  const [searchInput, setSearchInput] = useState(searchParam);
  const lastSearchParam = useRef(searchParam);
  const setParamRef = useRef(setParam);
  useEffect(() => {
    setParamRef.current = setParam;
  });
  useEffect(() => {
    // Von außen geändert (Zurück-Taste, Link, „Filter zurücksetzen“)
    if (searchParam !== lastSearchParam.current) {
      lastSearchParam.current = searchParam;
      setSearchInput(searchParam);
    }
  }, [searchParam]);
  useEffect(() => {
    const wanted = searchInput.trim();
    if (wanted === searchParam) return;
    const timer = setTimeout(() => {
      lastSearchParam.current = wanted;
      setParamRef.current('q', wanted);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput, searchParam]);

  const [grouping, setGroupingState] = useState<Grouping>(readGrouping);
  const setGrouping = (g: Grouping) => {
    setGroupingState(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {
      // Darstellungswunsch nur für diese Sitzung
    }
  };

  const range = periodRange(period);
  // Handgeschriebene oder veraltete URL-Werte („kategorie=abc“) ignorieren
  // statt die Suche am Server scheitern zu lassen
  const idParam = (value: string, min = 1) => {
    const n = Number(value);
    return value !== 'all' && Number.isInteger(n) && n >= min ? n : undefined;
  };
  const input = {
    ...range,
    type: (['income', 'expense', 'transfer'] as const).find((t) => t === typeFilter),
    accountId: idParam(accountFilter),
    categoryId: idParam(categoryFilter, -1),
    userId: idParam(userFilter),
    tagId: idParam(tagFilter),
    search: searchParam.slice(0, 200) || undefined,
    limit: PAGE_SIZE,
  };
  const query = trpc.finance.searchTransactions.useInfiniteQuery(input, {
    getNextPageParam: (last) => last.nextCursor,
    initialCursor: 0,
    placeholderData: keepPreviousData,
  });
  const pages = useMemo(() => query.data?.pages ?? [], [query.data?.pages]);
  // Ändert sich die Liste zwischen zwei Seiten (Buchung erfasst), kann eine
  // Zeile doppelt ankommen — nach ID entdoppeln
  const items = useMemo(() => {
    const seen = new Set<number>();
    return pages.flatMap((p) => p.items).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }, [pages]);
  const head = pages[0];
  const total = head?.total ?? 0;

  // Fokus (z. B. vom Dashboard): Zeile markieren und hinscrollen
  const focusRow = useRef<HTMLTableRowElement>(null);
  const focusLoaded = focusId !== null && items.some((t) => t.id === focusId);
  useEffect(() => {
    if (focusLoaded) focusRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusLoaded]);

  const deleteTx = trpc.finance.deleteTransaction.useMutation({
    onSuccess: () => { toast.success('Buchung gelöscht.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const reverseTx = trpc.finance.reverseTransaction.useMutation({
    onSuccess: () => { toast.success('Buchung storniert.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const setTxTags = trpc.finance.setTransactionTags.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err.message),
  });

  /** Tag an einer bestehenden Buchung an-/abwählen (Ersetzen-Semantik serverseitig) */
  const toggleTag = (tx: TxItem, tagId: number) => {
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
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      saveBlobAsFile(blob, `transaktionen-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CSV-Export fehlgeschlagen.');
    } finally {
      setExporting(false);
    }
  };

  // Zugriffsstufe pro Konto (für den Bearbeiten-Button: nur bei „edit")
  const accessByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.access])),
    [accounts],
  );

  // Gruppen aus den geladenen Buchungen (nur bei Sortierung nach Datum sinnvoll)
  const groups = useMemo(() => {
    if (grouping === 'none') return [{ key: '', items }];
    const out: { key: string; items: TxItem[] }[] = [];
    for (const t of items) {
      const key = grouping === 'month' ? t.date.slice(0, 7) : t.date;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(t);
      else out.push({ key, items: [t] });
    }
    return out;
  }, [items, grouping]);

  const selectedPreset = matchingPreset(period, today);
  const canShift = period.kind !== 'all';
  const nextDisabled = isFuturePeriod(shiftPeriod(period, 1), today);

  // Aktive Filter als entfernbare Chips
  const chips: { key: string; label: string }[] = [];
  if (typeFilter !== 'all') chips.push({ key: 'typ', label: { income: 'Einnahmen', expense: 'Ausgaben', transfer: 'Umbuchungen' }[typeFilter] ?? typeFilter });
  if (accountFilter !== 'all') chips.push({ key: 'konto', label: accounts.find((a) => a.id === Number(accountFilter))?.name ?? 'Konto' });
  if (categoryFilter !== 'all') chips.push({ key: 'kategorie', label: Number(categoryFilter) === -1 ? 'Ohne Kategorie' : (categories.find((c) => c.id === Number(categoryFilter))?.name ?? 'Kategorie') });
  if (userFilter !== 'all') chips.push({ key: 'person', label: users.find((u) => u.id === Number(userFilter))?.name ?? 'Person' });
  if (tagFilter !== 'all') chips.push({ key: 'tag', label: `#${tags.find((t) => t.id === Number(tagFilter))?.name ?? 'Tag'}` });

  const filterFields = (
    <>
      <Select value={typeFilter} onValueChange={(v) => setParam('typ', v)}>
        <SelectTrigger
          className="w-full min-w-0 [&>span]:truncate"
          title={{ all: 'Alle Typen', income: 'Einnahmen', expense: 'Ausgaben', transfer: 'Umbuchungen' }[typeFilter]}
        >
          <SelectValue placeholder="Typ" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alle Typen</SelectItem>
          <SelectItem value="income">Einnahmen</SelectItem>
          <SelectItem value="expense">Ausgaben</SelectItem>
          <SelectItem value="transfer">Umbuchungen</SelectItem>
        </SelectContent>
      </Select>
      <SearchableSelect
        value={accountFilter}
        onValueChange={(v) => setParam('konto', v)}
        placeholder="Konto"
        options={[
          { value: 'all', label: 'Alle Konten' },
          ...accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) })),
        ]}
      />
      <SearchableSelect
        value={categoryFilter}
        onValueChange={(v) => setParam('kategorie', v)}
        placeholder="Kategorie"
        options={[
          { value: 'all', label: 'Alle Kategorien' },
          { value: '-1', label: 'Ohne Kategorie' },
          // Oberkategorien schließen ihre Unterkategorien ein
          ...categories
            .filter((c) => c.parentId === null)
            .flatMap((root) => [root, ...categories.filter((c) => c.parentId === root.id)])
            .map((c) => ({ value: String(c.id), label: `${c.parentId ? '  ' : ''}${c.name}` })),
        ]}
      />
      <SearchableSelect
        value={userFilter}
        onValueChange={(v) => setParam('person', v)}
        placeholder="Person"
        options={[
          { value: 'all', label: 'Alle Personen' },
          ...users.map((u) => ({ value: String(u.id), label: u.name })),
        ]}
      />
      <SearchableSelect
        value={tagFilter}
        onValueChange={(v) => setParam('tag', v)}
        placeholder="Tag"
        options={[
          { value: 'all', label: 'Alle Tags' },
          ...tags.map((tag) => ({ value: String(tag.id), label: tag.name })),
        ]}
      />
    </>
  );

  const groupingSelect = (
    <Select value={grouping} onValueChange={(v) => setGrouping(v as Grouping)}>
      <SelectTrigger className="w-full min-w-0 sm:w-40 [&>span]:truncate" title="Gruppierung">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="day">Nach Tag gruppiert</SelectItem>
        <SelectItem value="month">Nach Monat gruppiert</SelectItem>
        <SelectItem value="none">Ohne Gruppen</SelectItem>
      </SelectContent>
    </Select>
  );

  const renderRow = (t: TxItem): ReactNode => {
    const cat = categories.find((c) => c.id === t.categoryId);
    const account = accounts.find((a) => a.id === t.accountId);
    const toAccount = accounts.find((a) => a.id === t.toAccountId);
    const user = users.find((u) => u.id === t.userId);
    const project = projects.find((p) => p.id === t.projectId);
    // Storno: diese Buchung ist eine Gegenbuchung bzw. wurde storniert
    const isStorno = t.stornoOfId !== null;
    const isReversed = t.isReversed;
    const noteLabel = t.note || (t.type === 'transfer' ? 'Umbuchung' : 'ohne Notiz');
    const reversalLabel = t.type === 'expense' ? 'Einnahme' : t.type === 'income' ? 'Ausgabe' : 'Umbuchung';
    const deleteEffect = t.type === 'income' ? `−${formatCents(t.amount)}` : `+${formatCents(t.amount)}`;
    const focused = t.id === focusId;
    return (
      <TableRow
        key={t.id}
        ref={focused ? focusRow : undefined}
        className={cn((isStorno || isReversed) && 'opacity-60', focused && 'bg-stamp/10 hover:bg-stamp/15')}
      >
        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{formatDate(t.date)}</TableCell>
        <TableCell>
          <div className="font-medium">{t.note || (t.type === 'transfer' ? 'Umbuchung' : '—')}</div>
          {/* Mobil fehlen die Spalten Kategorie/Konto — die Kurzinfo steht hier */}
          <div className="text-xs text-muted-foreground md:hidden">
            {t.type === 'transfer' ? `${account?.name ?? '?'} → ${toAccount?.name ?? '?'}` : (cat?.name ?? 'ohne Kategorie')}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {isStorno && <Badge variant="stamp" tone="ink">Storno</Badge>}
            {isReversed && <Badge variant="stamp" tone="ink">Storniert</Badge>}
            {t.splits.length > 0 && <Badge variant="stamp" tone="good">geteilt</Badge>}
            {t.changeCount > 0 && (
              <TransactionHistoryDialog
                transactionId={t.id}
                note={t.note}
                trigger={
                  <Badge variant="stamp" className="cursor-pointer hover:bg-muted" title="Änderungsverlauf anzeigen">
                    bearbeitet
                  </Badge>
                }
              />
            )}
            {project && (
              <Badge variant="label" style={{ borderLeft: `3px solid ${pencil(project.color)}` }}>
                {project.name}
              </Badge>
            )}
            {t.tags.map((tag) => (
              <Badge key={tag.id} variant="label" className="gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: pencil(tag.color) }} />
                {tag.name}
              </Badge>
            ))}
          </div>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          {cat ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pencil(cat.color) }} />
              {cat.name}
            </span>
          ) : <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
          {t.type === 'transfer' ? `${account?.name ?? '?'} → ${toAccount?.name ?? '?'}` : account?.name ?? '—'}
        </TableCell>
        <TableCell className="hidden sm:table-cell">
          {user && (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pencil(user.color) }} />
              {user.name}
            </span>
          )}
        </TableCell>
        <TableCell className={cn(
          'whitespace-nowrap text-right font-mono font-medium tabular-nums',
          t.type === 'income' ? 'text-positive' : t.type === 'expense' ? 'text-negative' : 'text-muted-foreground',
        )}>
          {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{formatCents(t.amount)}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end">
            {accessByAccount.get(t.accountId) === 'edit' && (
              // Key erzwingt ein Remount, wenn sich die Buchung ändert
              // (Edit → changeCount, Tag-Popover → tags) — so befüllen die
              // State-Initialisierer stets aktuell
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
                  <Tag className={cn('h-4 w-4', t.tags.length > 0 ? 'text-stamp' : 'text-muted-foreground')} />
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
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pencil(tag.color) }} />
                          <span className="flex-1 text-left">{tag.name}</span>
                          {active && <Check className="h-3.5 w-3.5 text-positive" />}
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
                  <Paperclip className={cn('h-4 w-4', t.attachments.length > 0 ? 'text-stamp' : 'text-muted-foreground')} />
                  {t.attachments.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-stamp px-1 text-[10px] font-semibold text-stamp-foreground">
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
                    <AlertDialogAction disabled={reverseTx.isPending} onClick={() => reverseTx.mutate({ id: t.id })}>
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
                    Zugehörige Belege und die Änderungshistorie werden ebenfalls gelöscht.
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
  };

  const hasSearchOrFilter = searchParam !== '' || chips.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Transaktionen</h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {head ? (
              <>
                {total} {total === 1 ? 'Buchung' : 'Buchungen'} · <span className="text-positive">+{formatCents(head.income)}</span>
                {' · '}<span className="text-negative">−{formatCents(head.expense)}</span>
                {' · '}Saldo {formatCents(head.income - head.expense)}
              </>
            ) : 'Buchungen werden geladen…'}
          </p>
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
        <CardContent className="space-y-3">
          {/* Zeitraum: Pfeile schieben um die eigene Länge, Presets daneben */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-md border bg-card">
              <Button
                variant="ghost" size="icon" className="h-9 w-9" title="Vorheriger Zeitraum"
                disabled={!canShift} onClick={() => setPeriod(shiftPeriod(period, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-28 px-1 text-center text-sm font-medium tabular-nums">{periodLabel(period)}</span>
              <Button
                variant="ghost" size="icon" className="h-9 w-9" title="Nächster Zeitraum"
                disabled={!canShift || nextDisabled} onClick={() => setPeriod(shiftPeriod(period, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Select
              value={selectedPreset ?? 'custom'}
              onValueChange={(v) => {
                if (v !== 'custom') setPeriod(presetPeriod(v as PeriodPreset, today));
              }}
            >
              <SelectTrigger className="w-44 min-w-0 [&>span]:truncate" title="Zeitraum wählen">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PERIOD_PRESET_LABELS) as PeriodPreset[]).map((p) => (
                  <SelectItem key={p} value={p}>{PERIOD_PRESET_LABELS[p]}</SelectItem>
                ))}
                <SelectItem value="custom" disabled={selectedPreset !== null}>Eigener Zeitraum</SelectItem>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">Von – bis…</Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-2" align="start">
                <RangeForm
                  initial={periodRange(period)}
                  today={today}
                  onApply={(from, to) => setPeriod({ kind: 'range', from, to })}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Suchen: Notiz, Kategorie, Tag oder Betrag…"
                className="pl-8"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            {/* Mobil: Filter hinter einem Knopf, damit die Liste oben beginnt */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="shrink-0 md:hidden">
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Filter</SheetTitle>
                </SheetHeader>
                <div className="grid gap-3 px-4 pb-6">
                  {filterFields}
                  {groupingSelect}
                </div>
              </SheetContent>
            </Sheet>
          </div>

          <div className="hidden gap-3 md:grid md:grid-cols-3 lg:grid-cols-6">
            {filterFields}
            {groupingSelect}
          </div>

          {(chips.length > 0 || searchParam) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setParam(c.key, '')}
                  className="flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs hover:bg-muted"
                  title="Filter entfernen"
                >
                  {c.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <Button
                variant="ghost" size="sm" className="h-6 px-2 text-xs"
                onClick={() => setParams(periodParams(period), { replace: true })}
              >
                Filter zurücksetzen
              </Button>
            </div>
          )}
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
              {query.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Buchungen werden geladen…
                  </TableCell>
                </TableRow>
              )}
              {query.isError && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-destructive">
                    Die Buchungen konnten nicht geladen werden: {query.error.message}
                  </TableCell>
                </TableRow>
              )}
              {!query.isLoading && !query.isError && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="space-y-3 py-8 text-center text-muted-foreground">
                    <p>Keine Buchungen im Zeitraum „{periodLabel(period)}“{hasSearchOrFilter ? ' mit diesen Filtern' : ''}.</p>
                    {period.kind !== 'all' && (
                      <Button variant="outline" size="sm" onClick={() => setPeriod({ kind: 'all' })}>
                        In allen Zeiträumen suchen
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )}
              {/* Flache Zeilenliste statt Fragment je Gruppe: Gruppenkopf, dann Buchungen */}
              {groups.flatMap((g) => [
                grouping !== 'none' && (
                  <TableRow key={`gruppe-${g.key}`} className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={7} className="py-1.5">
                      {/* Summe direkt neben dem Datum — rechtsbündig verschwände
                          sie bei breiten Tabellen aus dem sichtbaren Bereich */}
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-medium text-foreground">{groupLabel(g.key, grouping)}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {g.items.length} · {formatCents(g.items.reduce((s, t) => s + signedAmount(t), 0))}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ),
                ...g.items.map(renderRow),
              ])}
            </TableBody>
          </Table>
          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <span className="tabular-nums">{items.length} von {total} Buchungen geladen</span>
              {query.hasNextPage && (
                <Button
                  variant="outline" size="sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? 'Lade…' : `Weitere ${Math.min(PAGE_SIZE, total - items.length)} laden`}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Freie Spanne im Popover: zwei Datumsfelder, Übernehmen */
function RangeForm({
  initial, today, onApply,
}: {
  initial: { from?: string; to?: string };
  today: string;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(initial.from ?? `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(initial.to ?? today);
  const valid = from !== '' && to !== '' && from <= to;
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Von</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Bis</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {!valid && <p className="text-xs text-destructive">„Von“ muss vor „Bis“ liegen.</p>}
      <Button size="sm" className="w-full" disabled={!valid} onClick={() => onApply(from, to)}>
        Zeitraum übernehmen
      </Button>
    </>
  );
}
