import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useFinanceData } from '@/lib/data';
import { formatCents } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';

export type NoteSuggestion = inferRouterOutputs<AppRouter>['finance']['noteSuggestions'][number];

/**
 * Notizfeld mit Vorschlägen aus früheren Buchungen: nach zwei Zeichen
 * erscheinen passende Notizen (häufigste zuerst) mit Kategorie und letztem
 * Betrag. Die Auswahl übergibt der aufrufende Dialog an `onPick` und belegt
 * damit Kategorie, Konto usw. vor — „Coop“ tippen, Enter, Betrag, fertig.
 */
export default function NoteSuggestInput({
  id, value, onChange, onPick, type, placeholder, className, autoFocus,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (suggestion: NoteSuggestion) => void;
  type: 'income' | 'expense' | 'transfer';
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const { categories } = useFinanceData();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 200);
    return () => clearTimeout(timer);
  }, [value]);

  const query = trpc.finance.noteSuggestions.useQuery(
    { query: debounced, type },
    { enabled: focused && debounced.length >= 2 && debounced.length <= 100, staleTime: 30_000 },
  );
  // Die eben gewählte Notiz nicht erneut vorschlagen
  const suggestions = (query.data ?? []).filter(
    (s) => s.note.toLowerCase() !== value.trim().toLowerCase(),
  );
  const open = focused && !dismissed && value.trim().length >= 2 && suggestions.length > 0;

  const pick = (s: NoteSuggestion) => {
    onPick(s);
    setDismissed(true);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        className={className}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        // Verzögert, damit ein Klick auf einen Vorschlag noch ankommt
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            pick(suggestions[Math.min(active, suggestions.length - 1)]);
          } else if (e.key === 'Escape') {
            // Nur die Vorschläge schließen, nicht den Dialog
            e.preventDefault();
            e.stopPropagation();
            setDismissed(true);
          }
        }}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {suggestions.map((s, i) => {
            const cat = categories.find((c) => c.id === s.categoryId);
            return (
              <li key={s.note} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left',
                    i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(s)}
                >
                  <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{s.note}</span>
                  {cat && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{cat.name}</span>}
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatCents(s.amount)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
