import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';

/**
 * Info-Symbol neben einem Fachbegriff (A8): antippen öffnet Satz, Formel
 * und Beispiel. Popover statt Tooltip — Tooltips gibt es auf dem Handy nicht.
 */
export default function InfoTip({ term }: { term: GlossaryKey }) {
  const entry = GLOSSARY[term];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-stamp"
          aria-label={`Was heißt „${entry.term}“?`}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-sm" align="start">
        <p className="font-serif font-semibold">{entry.term}</p>
        <p className="text-muted-foreground">{entry.text}</p>
        {'formula' in entry && entry.formula && (
          <p className="rounded bg-muted px-2 py-1 font-mono text-xs">{entry.formula}</p>
        )}
        {'example' in entry && entry.example && (
          <p className="text-xs text-muted-foreground">Beispiel: {entry.example}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
