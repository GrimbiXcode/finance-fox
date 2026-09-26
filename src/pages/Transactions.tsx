import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, Download, Paperclip, Pencil, Search, SlidersHorizontal, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { accountLabel, useFinanceData } from '@/lib/data';
import { saveBlobAsFile } from '@/lib/download';
import { formatCents, formatDate, formatMonth, getUserLocale, todayISO } from '@/lib/finance';
import { parsePeriod, periodParams, periodRange, type Period } from '@contracts/period';
import TransactionDialog from '@/components/TransactionDialog';
import TransactionAttachmentsDialog from '@/components/TransactionAttachmentsDialog';
import PeriodPicker from '@/components/PeriodPicker';
import { periodLabel } from '@/lib/period';
import TransactionDetailSheet, { type TxItem } from '@/components/TransactionDetailSheet';
import BulkActionBar from '@/components/BulkActionBar';
import { Checkbox } from '@/components/ui/checkbox';
import CsvImportDialog from '@/components/CsvImportDialog';
import CamtImportDialog from '@/components/CamtImportDialog';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { pencil } from '@/lib/pencil';

type Grouping = 'day' | 'month' | 'none';

const PAGE_SIZE = 50;
const GROUP_KEY = 'ff-tx-group';
const FILTER_KEYS = ['typ', 'konto', 'kategorie', 'person', 'tag', 'projekt', 'q'] as const;
const SORT_KEYS = ['date', 'amount', 'category', 'account', 'person'] as const;
type SortKey = (typeof SORT_KEYS)[number];
/** Erste Richtung beim Anklicken: Datum/Betrag absteigend, Texte A→Z */
const SORT_FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = {
  date: 'desc', amount: 'desc', category: 'asc', account: 'asc', person: 'asc',
};
/** Deutsche URL-Werte für `sortierung` */
const SORT_PARAM: Record<SortKey, string> = {
  date: 'datum', amount: 'betrag', category: 'kategorie', account: 'konto', person: 'person',
};
const PERIOD_KEYS = ['monat', 'jahr', 'von', 'bis', 'zeit'] as const;

function readGrouping(): Grouping {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return v === 'month' || v === 'none' ? v : 'day';
  } catch {
    return 'day';
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
  const projectFilter = param('projekt');
  const searchParam = params.get('q') ?? '';
  const focusId = Number(params.get('fokus')) || null;
  const sortKey: SortKey = SORT_KEYS.find((k) => SORT_PARAM[k] === params.get('sortierung')) ?? 'date';
  const dirParam = params.get('richtung');
  const sortDir = dirParam === 'auf' ? 'asc' : dirParam === 'ab' ? 'desc' : SORT_FIRST_DIR[sortKey];
  /** Spaltenkopf angeklickt: gleiche Spalte kehrt die Richtung um */
  const toggleSort = (key: SortKey) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      const dir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : SORT_FIRST_DIR[key];
      next.delete('sortierung');
      next.delete('richtung');
      next.delete('fokus');
      // Neueste zuerst ist der Standard und braucht keinen Parameter
      if (key !== 'date' || dir !== 'desc') {
        next.set('sortierung', SORT_PARAM[key]);
        if (dir !== SORT_FIRST_DIR[key]) next.set('richtung', dir === 'asc' ? 'auf' : 'ab');
      }
      return next;
    }, { replace: true });
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
    // 0 = laufender Haushalt (ohne Projekt)
    projectId: idParam(projectFilter, 0),
    search: searchParam.slice(0, 200) || undefined,
    sort: sortKey,
    dir: sortDir,
    limit: PAGE_SIZE,
  };
  // Massenbearbeitung: Auswahl gilt nur für die aktuelle Suche — ändern sich
  // Filter oder Zeitraum, ist sie leer (abgeleitet statt per Effekt geleert)
  const selectionKey = JSON.stringify(input);
  const [selection, setSelection] = useState<{ key: string; ids: Set<number> }>({ key: '', ids: new Set() });
  const selected = selection.key === selectionKey ? selection.ids : new Set<number>();
  const toggleSelected = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelection({ key: selectionKey, ids: next });
  };
  const clearSelection = () => setSelection({ key: '', ids: new Set() });

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

  // Detail-Blatt: die Fokus-Buchung eines Links (Dashboard, Suche) hat
  // Vorrang, bis man sie schließt; sonst die angeklickte Zeile. Beides ist
  // an den Stand gebunden, in dem es entstand: Die Klick-Wahl an die
  // Suchparameter (ein Filterwechsel verwirft sie), das Schließen des
  // Fokus an die Navigation (derselbe Link erneut geöffnet zeigt das Blatt
  // wieder). Abgeleitet statt per Effekt gesetzt.
  const location = useLocation();
  const paramsKey = [...params.entries()].filter(([k]) => k !== 'fokus').map(([k, v]) => `${k}=${v}`).join('&');
  const [clicked, setClicked] = useState<{ key: string; id: number } | null>(null);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const focusOpen = focusId !== null && dismissedAt !== location.key;
  const openId = focusOpen ? focusId : clicked && clicked.key === paramsKey ? clicked.id : null;
  const loadedItem = openId === null ? undefined : items.find((t) => t.id === openId);
  // Liegt die Buchung nicht in den geladenen Seiten (älter, anderer Filter),
  // holt das Blatt sie einzeln
  const single = trpc.finance.searchTransactions.useQuery(
    { id: openId ?? 0, limit: 1 },
    { enabled: openId !== null && loadedItem === undefined && !query.isLoading },
  );
  const detailItem = loadedItem ?? (openId !== null ? (single.data?.items[0] ?? null) : null);
  // Fokus nach dem Schließen zurück auf die Zeile (Radix kennt hier keinen Auslöser)
  const returnFocus = useRef<HTMLElement | null>(null);
  const openDetail = (id: number, from: HTMLElement | null) => {
    returnFocus.current = from;
    setClicked({ key: paramsKey, id });
    if (focusOpen) setDismissedAt(location.key);
  };

  // Fokus (z. B. vom Dashboard): Zeile markieren und hinscrollen
  const focusRow = useRef<HTMLTableRowElement>(null);
  const focusLoaded = focusId !== null && items.some((t) => t.id === focusId);
  useEffect(() => {
    if (focusLoaded) focusRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusLoaded]);

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
  const selectable = items.filter((t) => accessByAccount.get(t.accountId) === 'edit');
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));
  const someSelected = selectable.some((t) => selected.has(t.id));

  // Gruppen aus den geladenen Buchungen (nur bei Sortierung nach Datum sinnvoll)
  const effectiveGrouping: Grouping = sortKey === 'date' ? grouping : 'none';
  const groups = useMemo(() => {
    if (effectiveGrouping === 'none') return [{ key: '', items }];
    const out: { key: string; items: TxItem[] }[] = [];
    for (const t of items) {
      const key = effectiveGrouping === 'month' ? t.date.slice(0, 7) : t.date;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(t);
      else out.push({ key, items: [t] });
    }
    return out;
  }, [items, effectiveGrouping]);

  // Aktive Filter als entfernbare Chips
  const chips: { key: string; label: string }[] = [];
  if (typeFilter !== 'all') chips.push({ key: 'typ', label: { income: 'Einnahmen', expense: 'Ausgaben', transfer: 'Umbuchungen' }[typeFilter] ?? typeFilter });
  if (accountFilter !== 'all') chips.push({ key: 'konto', label: accounts.find((a) => a.id === Number(accountFilter))?.name ?? 'Konto' });
  if (categoryFilter !== 'all') chips.push({ key: 'kategorie', label: Number(categoryFilter) === -1 ? 'Ohne Kategorie' : (categories.find((c) => c.id === Number(categoryFilter))?.name ?? 'Kategorie') });
  if (userFilter !== 'all') chips.push({ key: 'person', label: users.find((u) => u.id === Number(userFilter))?.name ?? 'Person' });
  if (tagFilter !== 'all') chips.push({ key: 'tag', label: `#${tags.find((t) => t.id === Number(tagFilter))?.name ?? 'Tag'}` });
  if (projectFilter !== 'all') chips.push({ key: 'projekt', label: Number(projectFilter) === 0 ? 'Ohne Projekt' : (projects.find((p) => p.id === Number(projectFilter))?.name ?? 'Projekt') });

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
      {projects.length > 0 && (
        <SearchableSelect
          value={projectFilter}
          onValueChange={(v) => setParam('projekt', v)}
          placeholder="Projekt"
          options={[
            { value: 'all', label: 'Alle Projekte' },
            { value: '0', label: 'Ohne Projekt' },
            ...projects.map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        />
      )}
    </>
  );

  const groupingSelect = (
    <Select value={grouping} onValueChange={(v) => setGrouping(v as Grouping)} disabled={sortKey !== 'date'}>
      <SelectTrigger
        className="w-full min-w-0 sm:w-40 [&>span]:truncate"
        title={sortKey === 'date' ? 'Gruppierung' : 'Gruppiert wird nur bei Sortierung nach Datum'}
      >
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
    const focused = t.id === focusId;
    return (
      <TableRow
        key={t.id}
        ref={focused ? focusRow : undefined}
        // Ein Klick irgendwo in die Zeile öffnet das Detail-Blatt; für
        // Tastatur und Screenreader ist die Beschreibung ein echter Knopf
        // (die Zeile bleibt eine Tabellenzeile). Seltene Aktionen (Tags,
        // Stornieren, Löschen, Verlauf) liegen im Blatt.
        onClick={(e) => openDetail(t.id, e.currentTarget.querySelector('button[data-row-open]'))}
        className={cn(
          'group cursor-pointer',
          (isStorno || isReversed) && 'opacity-60',
          focused && 'bg-stamp/10 hover:bg-stamp/15',
        )}
      >
        {/* Auswahl für die Massenbearbeitung (Desktop; nur mit edit-Recht) */}
        <TableCell className="hidden w-8 pr-0 md:table-cell" onClick={(e) => e.stopPropagation()}>
          {accessByAccount.get(t.accountId) === 'edit' && (
            <Checkbox
              checked={selected.has(t.id)}
              onCheckedChange={(v) => toggleSelected(t.id, v === true)}
              aria-label={`„${t.note || 'Buchung'}“ auswählen`}
            />
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{formatDate(t.date)}</TableCell>
        {/* whitespace-normal: lange Konto-Paare umbrechen statt den Betrag aus dem Bild zu schieben */}
        <TableCell className="min-w-32 whitespace-normal">
          <button
            type="button"
            data-row-open
            className="text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={(e) => {
              e.stopPropagation();
              openDetail(t.id, e.currentTarget);
            }}
          >
            {t.note || (t.type === 'transfer' ? 'Umbuchung' : '—')}
          </button>
          {/* Mobil fehlen die Spalten Kategorie/Konto — die Kurzinfo steht hier */}
          <div className="text-xs text-muted-foreground md:hidden">
            {t.type === 'transfer' ? `${account?.name ?? '?'} → ${toAccount?.name ?? '?'}` : (cat?.name ?? 'ohne Kategorie')}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {isStorno && <Badge variant="stamp" tone="ink">Storno</Badge>}
            {isReversed && <Badge variant="stamp" tone="ink">Storniert</Badge>}
            {t.splits.length > 0 && <Badge variant="stamp" tone="good">geteilt</Badge>}
            {t.changeCount > 0 && <Badge variant="stamp">bearbeitet</Badge>}
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
        {/* Nur die häufigen Aktionen in der Zeile; Klicks hier öffnen nicht das Detail */}
        {/* Klicks aus den Dialogen (Portale) blubbern im React-Baum bis
            hierher — sie dürfen das Detail-Blatt nicht öffnen */}
        <TableCell className="hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end">
            {accessByAccount.get(t.accountId) === 'edit' && (
              // Key erzwingt ein Remount, wenn sich die Buchung ändert
              <TransactionDialog
                key={`${t.id}:${t.changeCount}:${t.tags.map((x) => x.id).join(',')}`}
                transaction={t}
                trigger={
                  <Button
                    variant="ghost" size="icon" title="Bearbeiten"
                    className="md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                }
              />
            )}
            <TransactionAttachmentsDialog
              transactionId={t.id}
              note={t.note}
              attachments={t.attachments}
              trigger={
                <Button
                  variant="ghost" size="icon" title="Belege"
                  className={cn(
                    'relative',
                    // Ohne Beleg nur bei Hover/Fokus sichtbar — mit Beleg immer (Zähler)
                    t.attachments.length === 0 && 'md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
                  )}
                >
                  <Paperclip className={cn('h-4 w-4', t.attachments.length > 0 ? 'text-stamp' : 'text-muted-foreground')} />
                  {t.attachments.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-stamp px-1 text-[10px] font-semibold text-stamp-foreground">
                      {t.attachments.length}
                    </span>
                  )}
                </Button>
              }
            />
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
          <PeriodPicker period={period} onChange={setPeriod} today={today} />

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

          <div className={cn('hidden gap-3 md:grid md:grid-cols-3', projects.length > 0 ? 'lg:grid-cols-4 xl:grid-cols-7' : 'lg:grid-cols-6')}>
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
                onClick={() =>
                  setParams((prev) => {
                    // Zeitraum und Sortierung bleiben, nur die Filter gehen
                    const next = new URLSearchParams(periodParams(period));
                    for (const k of ['sortierung', 'richtung']) {
                      const v = prev.get(k);
                      if (v) next.set(k, v);
                    }
                    return next;
                  }, { replace: true })
                }
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
                <TableHead className="hidden w-8 pr-0 md:table-cell">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    disabled={selectable.length === 0}
                    onCheckedChange={(v) =>
                      setSelection({ key: selectionKey, ids: v === true ? new Set(selectable.map((t) => t.id)) : new Set() })
                    }
                    aria-label="Alle geladenen Buchungen auswählen"
                    title="Alle geladenen Buchungen auswählen"
                  />
                </TableHead>
                <SortHead label="Datum" sortKey="date" active={sortKey} dir={sortDir} onSort={toggleSort} />
                <TableHead>Beschreibung</TableHead>
                <SortHead label="Kategorie" sortKey="category" active={sortKey} dir={sortDir} onSort={toggleSort} className="hidden md:table-cell" />
                <SortHead label="Konto" sortKey="account" active={sortKey} dir={sortDir} onSort={toggleSort} className="hidden lg:table-cell" />
                <SortHead label="Person" sortKey="person" active={sortKey} dir={sortDir} onSort={toggleSort} className="hidden sm:table-cell" />
                <SortHead label="Betrag" sortKey="amount" active={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                {/* Mobil ohne Aktionen-Spalte — der Betrag braucht den Platz, Bearbeiten und Belege stehen im Blatt */}
                <TableHead className="hidden w-10 md:table-cell" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    Buchungen werden geladen…
                  </TableCell>
                </TableRow>
              )}
              {query.isError && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-destructive">
                    Die Buchungen konnten nicht geladen werden: {query.error.message}
                  </TableCell>
                </TableRow>
              )}
              {!query.isLoading && !query.isError && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="space-y-3 py-8 text-center text-muted-foreground">
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
                effectiveGrouping !== 'none' && (
                  <TableRow key={`gruppe-${g.key}`} className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={8} className="py-1.5">
                      {/* Summe direkt neben dem Datum — rechtsbündig verschwände
                          sie bei breiten Tabellen aus dem sichtbaren Bereich */}
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-medium text-foreground">{groupLabel(g.key, effectiveGrouping)}</span>
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

      {selected.size > 0 && <BulkActionBar ids={[...selected]} onClear={clearSelection} />}

      <TransactionDetailSheet
        tx={detailItem}
        onOpenChange={(open) => {
          if (open) return;
          setClicked(null);
          if (focusId !== null) setDismissedAt(location.key);
        }}
        onCloseAutoFocus={(e) => {
          const el = returnFocus.current;
          if (el?.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      />
    </div>
  );
}

/** Sortierbarer Spaltenkopf; aria-sort für Screenreader */
function SortHead({
  label, sortKey, active, dir, onSort, className,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = sortKey === active;
  const Icon = dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 uppercase hover:text-foreground',
          isActive && 'text-foreground',
        )}
        title={`Nach ${label} sortieren`}
      >
        {label}
        {isActive && <Icon className="h-3 w-3" />}
      </button>
    </TableHead>
  );
}
