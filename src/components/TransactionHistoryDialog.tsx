import { useState, type ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { trpc } from '@/providers/trpc';
import { formatCents, formatDate, getUserLocale } from '@/lib/finance';

/** Deutsche Feldnamen der Änderungshistorie (Server liefert die Feld-Keys) */
const FIELD_LABELS: Record<string, string> = {
  amount: 'Betrag',
  date: 'Datum',
  note: 'Notiz',
  categoryId: 'Kategorie',
  accountId: 'Konto',
  toAccountId: 'Zielkonto',
  userId: 'Person',
  projectId: 'Projekt',
  tags: 'Tags',
  splits: 'Aufteilung',
};

/** Werte je nach Feldtyp lesbar formatieren (Beträge in Cent, Datum ISO) */
const formatValue = (field: string, value: string | number | null): string => {
  if (value === null || value === '') return '—';
  if (field === 'amount') return formatCents(Number(value));
  if (field === 'date') return formatDate(String(value));
  return String(value);
};

/** Zeitpunkt eines Verlaufs-Eintrags locale-konform (Datum + Uhrzeit) */
const dateTimeFormatter = new Intl.DateTimeFormat(getUserLocale(), {
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * Änderungsverlauf einer Buchung: kompakter Dialog mit allen Einträgen
 * (neueste zuerst) — Zeitpunkt, Person mit Farbe, Feld-Diffs als lesbare
 * Zeilen „Betrag: 12,34 € → 15,00 €" und der optionale Kommentar kursiv.
 */
export default function TransactionHistoryDialog({
  transactionId,
  note,
  trigger,
}: {
  transactionId: number;
  note: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const changes = trpc.finance.listTransactionChanges.useQuery(
    { transactionId },
    { enabled: open },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Änderungsverlauf</DialogTitle>
          <DialogDescription>{note || 'Buchung'} — neueste Änderung zuerst.</DialogDescription>
        </DialogHeader>
        {changes.isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">Lade Verlauf…</p>
        ) : (changes.data?.length ?? 0) === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Keine Änderungen vorhanden.</p>
        ) : (
          <div className="space-y-4 py-2">
            {changes.data!.map((entry) => (
              <div key={entry.id} className="space-y-1 border-b pb-3 last:border-0">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.userColor }} />
                    {entry.userName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {dateTimeFormatter.format(new Date(entry.createdAt))}
                  </span>
                </div>
                <ul className="space-y-0.5 text-sm text-muted-foreground">
                  {entry.changes.map((c, idx) => (
                    <li key={idx}>
                      {FIELD_LABELS[c.field] ?? c.field}: {formatValue(c.field, c.from)} → {formatValue(c.field, c.to)}
                    </li>
                  ))}
                </ul>
                {entry.comment && (
                  <p className="text-sm italic text-muted-foreground">„{entry.comment}“</p>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
