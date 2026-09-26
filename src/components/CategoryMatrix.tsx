import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCents, formatMonthYearShort, getUserLocale } from '@/lib/finance';
import { pencil } from '@/lib/pencil';
import { trpc } from '@/providers/trpc';
import { useScope } from '@/providers/scope';
import { cn } from '@/lib/utils';

/** Ganze Währungseinheiten ohne Symbol — die Matrix bleibt so schmal genug */
const units = (cents: number) => Math.round(cents / 100).toLocaleString(getUserLocale());

/**
 * Kategorie × Monat: Zeilen = Oberkategorien (aufklappbar zu den
 * Unterkategorien), Spalten = Monate. Die Einfärbung ist sequenziell in
 * einem Farbton und **pro Zeile** normiert — so fällt der teure Monat einer
 * Kategorie auf, auch wenn die Kategorie insgesamt klein ist. Jede Zelle
 * führt zu den Buchungen dahinter.
 */
export default function CategoryMatrix() {
  const [months, setMonths] = useState(12);
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { userId } = useScope();
  const query = trpc.analysis.categoryMatrix.useQuery({ months, type, userId });
  const data = query.data;
  // Schmale Bildschirme: bei den jüngsten Monaten beginnen — die ältesten
  // liegen links, erreichbar per Wischen. Nur beim Wechsel des Zeitraums,
  // nicht beim Auf-/Zuklappen einer Zeile.
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastMonth = data?.months[data.months.length - 1];
  useEffect(() => {
    const box = wrapRef.current?.querySelector('[data-slot="table-container"]');
    if (box) box.scrollLeft = box.scrollWidth;
  }, [lastMonth, months]);

  const roots = data?.rows.filter((r) => r.parentId === null) ?? [];
  const childrenOf = (id: number) => data?.rows.filter((r) => r.parentId === id) ?? [];
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cellLink = (categoryId: number, month: string) =>
    `/transaktionen?${new URLSearchParams({ monat: month, typ: type, kategorie: String(categoryId) })}`;

  const renderRow = (row: NonNullable<typeof data>['rows'][number], isChild: boolean) => {
    const max = Math.max(...row.values, 1);
    const children = isChild ? [] : childrenOf(row.categoryId);
    return (
      <TableRow key={row.categoryId} className={cn(isChild && 'text-muted-foreground')}>
        <TableCell className="sticky left-0 z-10 min-w-40 bg-card">
          <span className={cn('flex items-center gap-1.5', isChild && 'pl-5')}>
            {!isChild && children.length > 0 ? (
              <button
                type="button"
                onClick={() => toggle(row.categoryId)}
                className="rounded p-0.5 hover:bg-muted"
                title={open.has(row.categoryId) ? 'Unterkategorien ausblenden' : 'Unterkategorien anzeigen'}
              >
                {open.has(row.categoryId) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : !isChild && <span className="inline-block w-[18px]" />}
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pencil(row.color) }} />
            <span className="truncate" title={row.name}>{row.name}</span>
          </span>
        </TableCell>
        {row.values.map((v, i) => (
          <TableCell
            key={data!.months[i]}
            className="p-0 text-right font-mono text-xs tabular-nums"
            // Sequenziell in einem Farbton, pro Zeile normiert; Text bleibt Tinte
            style={v > 0 ? { backgroundColor: `hsl(var(--pencil-1) / ${(0.06 + (v / max) * 0.3).toFixed(2)})` } : undefined}
          >
            {v > 0 ? (
              <Link
                to={cellLink(row.categoryId, data!.months[i])}
                className="block px-2 py-2 hover:underline"
                title={`${row.name}, ${formatMonthYearShort(data!.months[i])}: ${formatCents(v)}`}
              >
                {units(v)}
              </Link>
            ) : <span className="block px-2 py-2 text-muted-foreground/50">·</span>}
          </TableCell>
        ))}
        <TableCell className="text-right font-mono text-xs font-medium tabular-nums" title={formatCents(row.total)}>{units(row.total)}</TableCell>
        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground" title={formatCents(row.average)}>{units(row.average)}</TableCell>
      </TableRow>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>Monatsmatrix</CardTitle>
            <CardDescription>
              Beträge in ganzen Einheiten der Währung · je dunkler, desto teurer der Monat für diese Kategorie · Klick zeigt die Buchungen
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={type} onValueChange={(v) => setType(v as 'expense' | 'income')}>
              <SelectTrigger className="w-32" title="Art"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Ausgaben</SelectItem>
                <SelectItem value="income">Einnahmen</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
              <SelectTrigger className="w-36" title="Zeitraum"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 Monate</SelectItem>
                <SelectItem value="12">12 Monate</SelectItem>
                <SelectItem value="24">24 Monate</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!data ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">{query.isLoading ? 'Wird berechnet…' : 'Keine Daten.'}</p>
        ) : roots.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">Keine Buchungen in diesem Zeitraum.</p>
        ) : (
          <div ref={wrapRef}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-card">Kategorie</TableHead>
                {data.months.map((m) => (
                  <TableHead key={m} className="text-right">{formatMonthYearShort(m)}</TableHead>
                ))}
                <TableHead className="text-right">Summe</TableHead>
                <TableHead className="text-right">Ø Monat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roots.flatMap((r) => [
                renderRow(r, false),
                ...(open.has(r.categoryId) ? childrenOf(r.categoryId).map((c) => renderRow(c, true)) : []),
              ])}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-card font-semibold">Gesamt</TableCell>
                {data.totals.map((v, i) => (
                  <TableCell key={data.months[i]} className="text-right font-mono text-xs font-semibold tabular-nums">
                    {units(v)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono text-xs font-semibold tabular-nums" title={formatCents(data.total)}>{units(data.total)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums" title={formatCents(data.average)}>{units(data.average)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
