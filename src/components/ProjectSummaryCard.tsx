import { Link } from 'react-router';
import { Archive, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { formatCents, formatDate } from '@/lib/finance';
import { pencil, pencilSlot } from '@/lib/pencil';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';

/**
 * „Was hat das Projekt gekostet?“ — Summe, Zeitraum, je Person bezahlt und
 * getragen, Verteilung auf Kategorien. Erscheint auf der Aufteilung, sobald
 * ein Projekt gewählt ist.
 */
export default function ProjectSummaryCard({ projectId }: { projectId: number }) {
  const { users, projects } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const query = trpc.analysis.projectSummary.useQuery({ projectId });
  const setClosed = trpc.finance.setProjectClosed.useMutation({
    onSuccess: (res) => {
      toast.success(res.closedAt ? 'Projekt abgeschlossen.' : 'Projekt wieder geöffnet.');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const s = query.data;
  if (!s) return null;
  const closedAt = projects.find((p) => p.id === projectId)?.closedAt ?? null;
  const maxCategory = Math.max(...s.categories.map((c) => c.amount), 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: pencil(s.project.color) }} />
              {s.project.name}
              {closedAt && <Badge variant="stamp" tone="ink">Abgeschlossen</Badge>}
            </CardTitle>
            <CardDescription>
              {s.count === 0
                ? 'Noch keine Ausgaben in diesem Projekt.'
                : `${s.count} ${s.count === 1 ? 'Ausgabe' : 'Ausgaben'}${s.from ? ` vom ${formatDate(s.from)}` : ''}${s.to && s.to !== s.from ? ` bis ${formatDate(s.to)}` : ''}`}
              {closedAt && ` · abgeschlossen am ${formatDate(closedAt)}`}
            </CardDescription>
          </div>
          {/* Abschließen (H2): danach nicht mehr in den Buchungs-Dialogen
              angeboten; Salden und Ausgleich bleiben hier erreichbar */}
          <Button
            variant="outline"
            size="sm"
            disabled={setClosed.isPending}
            title={closedAt
              ? 'Projekt wieder für neue Buchungen anbieten'
              : 'Projekt beenden: erscheint nicht mehr bei neuen Buchungen, bleibt in Filtern und Auswertungen'}
            onClick={() => setClosed.mutate({ id: projectId, closed: !closedAt })}
          >
            {closedAt
              ? <><ArchiveRestore className="mr-1.5 h-4 w-4" /> Wieder öffnen</>
              : <><Archive className="mr-1.5 h-4 w-4" /> Abschließen</>}
          </Button>
        </div>
      </CardHeader>
      {s.count > 0 && (
        <CardContent className="grid gap-6 md:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Gesamtkosten</div>
            <div className="font-serif text-2xl font-semibold tabular-nums">{formatCents(s.total)}</div>
            {s.settledCount > 0 && (
              <div className="text-xs text-muted-foreground">
                ohne {s.settledCount === 1 ? 'einen Ausgleich' : `${s.settledCount} Ausgleiche`} über {formatCents(s.settledTotal)}
              </div>
            )}
            <Link
              to={`/transaktionen?${new URLSearchParams({ zeit: 'alle', typ: 'expense', projekt: String(s.project.id) })}`}
              className="text-xs text-stamp hover:underline"
            >
              Alle Buchungen
            </Link>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Je Person: bezahlt · getragen</div>
            <ul className="space-y-1 text-sm">
              {s.persons.map((p) => {
                const u = users.find((x) => x.id === p.userId);
                const diff = p.paid - p.share;
                // Nach verbuchten Ausgleichen noch offen
                const open = diff + p.settled;
                return (
                  // Name und Zahlen untereinander: nebeneinander blieb vom Namen
                  // in der Drittel-Spalte nur „D…“
                  <li key={p.userId}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pencil(u?.color) }} />
                      <span className="truncate" title={u?.name}>{u?.name ?? '?'}</span>
                    </span>
                    <span className="block pl-3.5 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCents(p.paid)} · {formatCents(p.share)}
                      {open !== 0 ? (
                        <span className={cn('ml-1', open > 0 ? 'text-positive' : 'text-negative')} title="nach Ausgleichen noch offen">
                          ({open > 0 ? '+' : ''}{formatCents(open)})
                        </span>
                      ) : diff !== 0 && (
                        <span className="ml-1">(ausgeglichen)</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Nach Kategorie</div>
            <ul className="space-y-1.5 text-xs">
              {s.categories.map((c, i) => (
                <li key={c.categoryId}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="font-mono tabular-nums">{formatCents(c.amount)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(c.amount / maxCategory) * 100}%`, backgroundColor: c.color ? pencil(c.color) : pencilSlot(i + 1) }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
