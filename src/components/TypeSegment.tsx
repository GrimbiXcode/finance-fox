import { cn } from '@/lib/utils';
import { radioKeyDown } from '@/lib/radio';

type TxType = 'expense' | 'income' | 'transfer';
const LABELS: Record<TxType, string> = { expense: 'Ausgabe', income: 'Einnahme', transfer: 'Umbuchung' };

/**
 * Buchungsart als Segment — derselbe Schalter im Buchungs- und im
 * Dauerbuchungs-Dialog: gewählte Art hell hinterlegt, Ton statt Füllung
 * (Ausgabe rot, Einnahme grün), damit die Farbe nicht wie ein Warnknopf wirkt.
 */
export default function TypeSegment({
  value, onChange, disabled, disabledTitle,
}: {
  value: TxType;
  onChange: (value: TxType) => void;
  disabled?: boolean;
  /** Erklärung, warum die Art nicht änderbar ist (Bearbeiten-Modus) */
  disabledTitle?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Buchungsart" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
      {(Object.keys(LABELS) as TxType[]).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          tabIndex={value === t ? 0 : -1}
          onKeyDown={(e) => radioKeyDown(e, Object.keys(LABELS) as TxType[], value, onChange)}
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
          onClick={() => onChange(t)}
          className={cn(
            'rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-muted-foreground',
            value === t && 'bg-background text-foreground shadow-sm',
            value === t && t === 'expense' && 'text-negative',
            value === t && t === 'income' && 'text-positive',
          )}
        >
          {LABELS[t]}
        </button>
      ))}
    </div>
  );
}
