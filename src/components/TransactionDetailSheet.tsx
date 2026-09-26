import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, Copy, History, Paperclip, Pencil, Repeat, Trash2, Undo2 } from 'lucide-react';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import TransactionDialog from '@/components/TransactionDialog';
import TransactionAttachmentsDialog from '@/components/TransactionAttachmentsDialog';
import TransactionHistoryDialog from '@/components/TransactionHistoryDialog';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { formatCents, formatDate, todayISO } from '@/lib/finance';
import { nextOccurrenceAfter } from '@contracts/planning';
import { useIsMobile } from '@/hooks/use-mobile';
import { pencil } from '@/lib/pencil';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';

export type TxItem = inferRouterOutputs<AppRouter>['finance']['searchTransactions']['items'][number];

const TYPE_LABEL = { income: 'Einnahme', expense: 'Ausgabe', transfer: 'Umbuchung' } as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/**
 * Alles zu einer Buchung an einem Ort: Details, Tags, Aufteilung, Belege,
 * Verlauf — und die seltenen Aktionen (Stornieren, Löschen), die vorher als
 * Symbolreihe jede Tabellenzeile füllten. Mobil öffnet ein Tipp auf die
 * Zeile dieses Blatt von unten, am Desktop von rechts.
 */
export default function TransactionDetailSheet({
  tx, onOpenChange, onCloseAutoFocus,
}: {
  tx: TxItem | null;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const isMobile = useIsMobile();
  const { accounts, categories, users, projects, tags } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const deleteTx = trpc.finance.deleteTransaction.useMutation({
    onSuccess: () => { toast.success('Buchung gelöscht.'); invalidate(); onOpenChange(false); },
    onError: (err) => toast.error(err.message),
  });
  const reverseTx = trpc.finance.reverseTransaction.useMutation({
    onSuccess: () => { toast.success('Buchung storniert.'); invalidate(); onOpenChange(false); },
    onError: (err) => toast.error(err.message),
  });
  const setTxTags = trpc.finance.setTransactionTags.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const t = tx;
  const account = accounts.find((a) => a.id === t?.accountId);
  const toAccount = accounts.find((a) => a.id === t?.toAccountId);
  const cat = categories.find((c) => c.id === t?.categoryId);
  const parent = categories.find((c) => c.id === cat?.parentId);
  const user = users.find((u) => u.id === t?.userId);
  const project = projects.find((p) => p.id === t?.projectId);
  const canEdit = account?.access === 'edit';

  return (
    <Sheet open={t !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn('overflow-y-auto', isMobile ? 'max-h-[90vh]' : 'w-full sm:max-w-md')}
      >
        {t && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{t.note || (t.type === 'transfer' ? 'Umbuchung' : 'ohne Notiz')}</SheetTitle>
              <SheetDescription>{TYPE_LABEL[t.type]} vom {formatDate(t.date)}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <div className={cn(
                'font-serif text-3xl font-semibold tabular-nums',
                t.type === 'income' ? 'text-positive' : t.type === 'expense' ? 'text-negative' : '',
              )}>
                {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{formatCents(t.amount)}
              </div>
              <div className="flex flex-wrap gap-1">
                {t.stornoOfId !== null && <Badge variant="stamp" tone="ink">Storno</Badge>}
                {t.isReversed && <Badge variant="stamp" tone="ink">Storniert</Badge>}
                {t.recurringId !== null && <Badge variant="stamp">aus Dauerbuchung</Badge>}
              </div>

              <div className="divide-y rounded-md border px-3">
                <Field label="Konto">
                  {t.type === 'transfer' ? (
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {account?.name ?? '?'} <ArrowRight className="h-3.5 w-3.5" /> {toAccount?.name ?? '?'}
                    </span>
                  ) : (account?.name ?? '?')}
                </Field>
                {t.type !== 'transfer' && (
                  <Field label="Kategorie">
                    {cat ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pencil(cat.color) }} />
                        {parent ? `${parent.name} › ${cat.name}` : cat.name}
                      </span>
                    ) : <span className="text-muted-foreground">ohne Kategorie</span>}
                  </Field>
                )}
                <Field label={t.type === 'expense' ? 'Bezahlt von' : 'Person'}>{user?.name ?? '?'}</Field>
                {project && <Field label="Projekt">{project.name}</Field>}
                {t.splits.length > 0 && (
                  <Field label="Aufteilung">
                    <ul className="space-y-0.5">
                      {t.splits.map((s) => (
                        <li key={s.userId} className="flex justify-between gap-2">
                          <span>{users.find((u) => u.id === s.userId)?.name ?? '?'}</span>
                          <span className="font-mono tabular-nums">{formatCents(s.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </Field>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="text-sm font-medium">Tags</div>
                {tags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Noch keine Tags — in den Einstellungen anlegen.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const active = t.tags.some((x) => x.id === tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          disabled={setTxTags.isPending || !canEdit}
                          title={canEdit ? undefined : 'Nur mit Bearbeitungsrecht auf dem Konto'}
                          onClick={() => {
                            const current = t.tags.map((x) => x.id);
                            const next = active ? current.filter((id) => id !== tag.id) : [...current, tag.id];
                            setTxTags.mutate({ transactionId: t.id, tagIds: next });
                          }}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                            active ? 'border-transparent bg-stamp text-stamp-foreground' : 'bg-muted/40 text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {active ? <Check className="h-3 w-3" /> : (
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: pencil(tag.color) }} />
                          )}
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {canEdit && (
                  <TransactionDialog
                    key={`${t.id}:${t.changeCount}:${t.tags.map((x) => x.id).join(',')}`}
                    transaction={t}
                    trigger={<Button variant="outline"><Pencil className="mr-2 h-4 w-4" /> Bearbeiten</Button>}
                  />
                )}
                <TransactionAttachmentsDialog
                  transactionId={t.id}
                  note={t.note}
                  attachments={t.attachments}
                  trigger={
                    <Button variant="outline">
                      <Paperclip className="mr-2 h-4 w-4" /> Belege{t.attachments.length > 0 ? ` (${t.attachments.length})` : ''}
                    </Button>
                  }
                />
                {/* Duplizieren: „wie letzte Woche“ — vorbefüllt, Datum heute */}
                {canEdit && t.stornoOfId === null && (
                  <TransactionDialog
                    template={t}
                    trigger={<Button variant="outline"><Copy className="mr-2 h-4 w-4" /> Duplizieren</Button>}
                  />
                )}
                {/* Aus einer Buchung eine Dauerbuchung: vorbefüllter Dialog, erste
                    Fälligkeit ein Monat nach der Buchung, frühestens morgen */}
                {canEdit && t.stornoOfId === null && t.recurringId === null && (
                  <Button variant="outline" asChild>
                    <Link
                      to={`/wiederkehrend?${new URLSearchParams({
                        neu: '1',
                        typ: t.type,
                        von: String(t.accountId),
                        ...(t.toAccountId ? { nach: String(t.toAccountId) } : {}),
                        ...(t.categoryId ? { kategorie: String(t.categoryId) } : {}),
                        betrag: String(t.amount),
                        notiz: t.note,
                        person: String(t.userId),
                        start: nextOccurrenceAfter(t.date, 'monthly', todayISO()),
                        basis: t.date,
                        quelle: String(t.id),
                      })}`}
                      onClick={() => onOpenChange(false)}
                    >
                      <Repeat className="mr-2 h-4 w-4" /> Wiederkehrend
                    </Link>
                  </Button>
                )}
                {t.changeCount > 0 && (
                  <TransactionHistoryDialog
                    transactionId={t.id}
                    note={t.note}
                    trigger={<Button variant="outline"><History className="mr-2 h-4 w-4" /> Verlauf ({t.changeCount})</Button>}
                  />
                )}
                {canEdit && t.stornoOfId === null && !t.isReversed && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline"><Undo2 className="mr-2 h-4 w-4" /> Stornieren</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Buchung stornieren?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Es wird eine Gegenbuchung erstellt:{' '}
                          {t.type === 'expense' ? 'Einnahme' : t.type === 'income' ? 'Ausgabe' : 'Umbuchung'} über{' '}
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
                {canEdit && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive"><Trash2 className="mr-2 h-4 w-4" /> Löschen</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Buchung wirklich löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Die Buchung „{t.note || (t.type === 'transfer' ? 'Umbuchung' : 'ohne Notiz')}“ über{' '}
                          {formatCents(t.amount)} vom {formatDate(t.date)} wird endgültig gelöscht.{' '}
                          {t.type === 'transfer'
                            ? `Der Saldo von „${account?.name ?? '?'}“ ändert sich um +${formatCents(t.amount)}, der von „${toAccount?.name ?? '?'}“ um −${formatCents(t.amount)}.`
                            : `Der Saldo von „${account?.name ?? '?'}“ ändert sich um ${t.type === 'income' ? '−' : '+'}${formatCents(t.amount)}.`}{' '}
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
                )}
              </div>
              {!canEdit && (
                <p className="text-xs text-muted-foreground">
                  Für dieses Konto hast du nur Leserecht — bearbeiten, stornieren und löschen kann nur, wer das Konto bearbeiten darf.
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
