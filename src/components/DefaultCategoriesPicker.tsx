import { useState, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { DEFAULT_CATEGORIES } from '@contracts/defaultCategories';
import { useInvalidateFinance } from '@/lib/data';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/**
 * Auswahl der Startkategorien (`DEFAULT_CATEGORIES`) — im Setup-Wizard und in
 * den Einstellungen („Vorschläge ergänzen“). Jede Oberkategorie ist einzeln
 * abwählbar, ihre Unterkategorien stehen klein daneben. Bereits vorhandene
 * werden markiert; der Server ergänzt dort nur fehlende Unterkategorien.
 */
export default function DefaultCategoriesPicker({
  submitLabel,
  onDone,
  secondary,
}: {
  submitLabel: string;
  /** Nach dem Anlegen (Anzahl neu angelegter Kategorien) */
  onDone: (created: number) => void;
  /** Zusätzlicher Knopf links neben dem Absenden (z. B. „Überspringen“) */
  secondary?: ReactNode;
}) {
  const invalidate = useInvalidateFinance();
  const existing = trpc.finance.listCategories.useQuery().data ?? [];
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(DEFAULT_CATEGORIES.map((c) => c.key)),
  );

  const add = trpc.finance.addDefaultCategories.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.created === 0
          ? 'Alle gewählten Kategorien sind schon vorhanden.'
          : `${res.created} Kategorien angelegt.`,
      );
      invalidate();
      onDone(res.created);
    },
    onError: (err) => toast.error(err.message),
  });

  const exists = (name: string, type: string) =>
    existing.some(
      (c) => c.parentId === null && c.type === type && c.name.toLowerCase() === name.toLowerCase(),
    );
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const group = (type: 'income' | 'expense', title: string) => (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {DEFAULT_CATEGORIES.filter((c) => c.type === type).map((c) => (
        <label
          key={c.key}
          htmlFor={`default-cat-${c.key}`}
          className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
        >
          <Checkbox
            id={`default-cat-${c.key}`}
            checked={selected.has(c.key)}
            onCheckedChange={() => toggle(c.key)}
            className="mt-0.5"
          />
          <span className="min-w-0 text-sm">
            <span className="font-medium">{c.name}</span>
            {exists(c.name, c.type) && (
              <span className="ml-1.5 whitespace-nowrap text-xs text-muted-foreground">(vorhanden)</span>
            )}
            {c.children.length > 0 && (
              <span className="block text-xs text-muted-foreground">{c.children.join(' · ')}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        {group('income', 'Einnahmen')}
        {group('expense', 'Ausgaben')}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => setSelected(new Set(DEFAULT_CATEGORIES.map((c) => c.key)))}
          >
            Alle
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Keine
          </Button>
        </div>
        <div className="flex gap-2">
          {secondary}
          <Button
            type="button"
            disabled={selected.size === 0 || add.isPending}
            onClick={() => add.mutate({ keys: [...selected] })}
          >
            {add.isPending ? 'Lege an…' : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
