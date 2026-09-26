import { Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

const buchungen = (n: number) => (n === 1 ? '1 Buchung' : `${n} Buchungen`);

/**
 * Aktionsleiste der Massenbearbeitung: erscheint unten, sobald Buchungen
 * markiert sind. Jede Auswahl in einem Feld wirkt sofort auf alle
 * markierten Buchungen (Server: `finance.bulkUpdateTransactions`, eine
 * Transaktion, Verlauf je Buchung). Buchungen, zu denen eine Kategorie
 * nicht passt (andere Art, Umbuchung), meldet der Server als übersprungen.
 */
export default function BulkActionBar({
  ids, onClear,
}: {
  ids: number[];
  onClear: () => void;
}) {
  const { categories, projects, users, tags } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const update = trpc.finance.bulkUpdateTransactions.useMutation({
    onSuccess: (res) => {
      const parts = [`${buchungen(res.updated)} geändert`];
      if (res.skipped > 0) parts.push(`${res.skipped} übersprungen (Umbuchung oder Kategorie einer anderen Art)`);
      if (res.unchanged > 0) parts.push(`${res.unchanged} schon so`);
      toast.success(parts.join(' · '));
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = trpc.finance.bulkDeleteTransactions.useMutation({
    onSuccess: (res) => {
      toast.success(`${buchungen(res.deleted)} gelöscht.`);
      invalidate();
      onClear();
    },
    onError: (err) => toast.error(err.message),
  });
  const busy = update.isPending || remove.isPending;

  const grouped = categories
    .filter((c) => c.parentId === null)
    .flatMap((root) => [root, ...categories.filter((c) => c.parentId === root.id)]);
  const typeLabel = { income: 'Einnahme', expense: 'Ausgabe' } as Record<string, string>;

  return (
    <div
      role="region"
      aria-label="Massenbearbeitung"
      className="sticky bottom-20 z-30 flex flex-wrap items-center gap-2 rounded-lg border bg-popover p-2 shadow-lg md:bottom-4"
    >
      <span className="px-2 text-sm font-medium tabular-nums">{ids.length} ausgewählt</span>
      <SearchableSelect
        value=""
        placeholder="Kategorie setzen…"
        className="w-44"
        disabled={busy}
        onValueChange={(v) => update.mutate({ ids, categoryId: v === 'none' ? null : Number(v) })}
        options={[
          { value: 'none', label: 'Kategorie entfernen' },
          ...grouped.map((c) => ({
            value: String(c.id),
            label: `${c.parentId ? '  ' : ''}${c.name} (${typeLabel[c.type] ?? c.type})`,
          })),
        ]}
      />
      {projects.length > 0 && (
        <SearchableSelect
          value=""
          placeholder="Projekt setzen…"
          className="w-40"
          disabled={busy}
          onValueChange={(v) => update.mutate({ ids, projectId: v === 'none' ? null : Number(v) })}
          options={[
            { value: 'none', label: 'Aus Projekt nehmen' },
            // Abgeschlossene Projekte nehmen keine Buchungen mehr auf
            ...projects.filter((p) => !p.closedAt).map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        />
      )}
      {users.length > 1 && (
        <SearchableSelect
          value=""
          placeholder="Person setzen…"
          className="w-40"
          disabled={busy}
          onValueChange={(v) => update.mutate({ ids, userId: Number(v) })}
          options={users.filter((u) => u.active).map((u) => ({ value: String(u.id), label: u.name }))}
        />
      )}
      {tags.length > 0 && (
        <>
          <SearchableSelect
            value=""
            placeholder="Tag hinzufügen…"
            className="w-40"
            disabled={busy}
            onValueChange={(v) => update.mutate({ ids, addTagIds: [Number(v)] })}
            options={tags.map((t) => ({ value: String(t.id), label: t.name }))}
          />
          <SearchableSelect
            value=""
            placeholder="Tag entfernen…"
            className="w-40"
            disabled={busy}
            onValueChange={(v) => update.mutate({ ids, removeTagIds: [Number(v)] })}
            options={tags.map((t) => ({ value: String(t.id), label: t.name }))}
          />
        </>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={busy}>
            <Trash2 className="mr-1.5 h-4 w-4" /> Löschen
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{buchungen(ids.length)} löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Buchungen, ihre Belege und ihr Änderungsverlauf werden endgültig
              entfernt; die Kontosalden ändern sich entsprechend. Zum Rückgängigmachen
              einer einzelnen Buchung mit Nachweis gibt es „Stornieren“ im Detail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate({ ids })}
            >
              Endgültig löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" title="Auswahl aufheben" onClick={onClear}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
