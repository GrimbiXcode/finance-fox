import { useMemo, useState } from 'react';
import { useActions, type QuickMode } from '@/providers/actions';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/SearchableSelect';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import { amountPlaceholder, formatAmountInput, formatCents, parseEuro, todayISO } from '@/lib/finance';
import NoteSuggestInput from '@/components/NoteSuggestInput';
import { pencil } from '@/lib/pencil';
import { cn } from '@/lib/utils';
import { radioKeyDown } from '@/lib/radio';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

const MODE_LABELS: Record<QuickMode, string> = {
  expense: 'Ausgabe',
  income: 'Einnahme',
  withdrawal: 'Abhebung',
};

/**
 * Schnellerfassung: Betrag + Notiz, fertig. Die Art wählt ein Schalter
 * („Ausgabe | Einnahme“, dazu „Abhebung“, sobald es ein Bargeldkonto gibt);
 * ein „-“ vor dem Betrag gilt weiterhin als Einnahme. Kategorie: die
 * zuletzt verwendete der Art oder ein angetippter Chip der häufigsten.
 * Datum (heute) und Person (aktueller User) werden gesetzt. Das Konto ist
 * pro Benutzer konfigurierbar (users.quickAccountId via
 * auth.setQuickAccount) — Default: erstes Konto mit „edit"-Recht. Nach dem
 * Buchen bietet der Toast zehn Sekunden lang „Rückgängig“.
 */
export default function QuickAddDialog() {
  // Offen-Zustand global, damit auch das Kürzel „S“, die Befehlspalette und
  // „Abhebung nachtragen“ an der Kasse die Schnellerfassung öffnen
  const { open: dialog, quick, show, close, restoreFocus } = useActions();
  const open = dialog === 'quick';
  const setOpen = (next: boolean) => (next ? show('quick') : close());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" title="Schnellbuchung erfassen (Taste S)">
          <Zap className="h-4 w-4" />
          <span className="hidden sm:inline">Schnell</span>
        </Button>
      </DialogTrigger>
      {open && (
        <QuickAddForm
          initialMode={quick.quickMode ?? 'expense'}
          initialCashId={quick.cashAccountId}
          close={() => setOpen(false)}
          onCloseAutoFocus={restoreFocus}
        />
      )}
    </Dialog>
  );
}

function QuickAddForm({
  initialMode, initialCashId, close, onCloseAutoFocus,
}: {
  initialMode: QuickMode;
  initialCashId?: number;
  close: () => void;
  onCloseAutoFocus: (e: Event) => void;
}) {
  const { user } = useAuth();
  const { accounts, banks, categories } = useFinanceData();
  const usage = trpc.finance.categoryUsage.useQuery();
  const invalidate = useInvalidateFinance();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<QuickMode>(initialMode);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // Kategorie aus Chip oder Vorschlag (sonst: zuletzt verwendete der Art)
  const [picked, setPicked] = useState<{ categoryId: number | null; type: 'income' | 'expense' } | null>(null);

  const editableAccounts = useMemo(
    () => accounts.filter((a) => a.access === 'edit'),
    [accounts],
  );
  // Konfiguriertes Konto, falls vorhanden und noch bearbeitbar — sonst
  // automatisch das erste Konto mit „edit"-Recht
  const configured = editableAccounts.find((a) => a.id === user?.quickAccountId);
  const account = configured ?? editableAccounts[0];
  // Abhebung: von einem Konto (nie einer Kasse) auf ein Bargeldkonto. Ist
  // das Schnellkonto selbst die Kasse — typisch, die Schnellerfassung ist
  // fürs Bargeld da —, kommt das Geld vom ersten anderen Konto.
  const nonCash = editableAccounts.filter((a) => a.type !== 'cash');
  const [sourceId, setSourceId] = useState<number | undefined>(undefined);
  const withdrawSource =
    nonCash.find((a) => a.id === sourceId) ??
    (account && account.type !== 'cash' ? account : nonCash[0]);
  const cashAccounts = accounts.filter((a) => a.type === 'cash');
  const [cashId, setCashId] = useState<number | undefined>(initialCashId);
  const cash = cashAccounts.find((a) => a.id === cashId) ?? cashAccounts[0];
  const canWithdraw = !!withdrawSource && !!cash;
  // „-50“ bleibt eine Einnahme — auch wenn der Schalter auf Ausgabe steht
  const type: 'income' | 'expense' | 'transfer' =
    mode === 'withdrawal' ? 'transfer'
      : mode === 'income' || amount.trim().startsWith('-') ? 'income' : 'expense';

  const setQuickAccount = trpc.auth.setQuickAccount.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const createTx = trpc.finance.createTransaction.useMutation({
    onSuccess: (data, vars) => {
      const label = vars.type === 'income' ? 'Einnahme' : vars.type === 'expense' ? 'Ausgabe' : 'Abhebung';
      toast.success(`${label} über ${formatCents(vars.amount)} erfasst.`, {
        duration: 10_000,
        action: {
          label: 'Rückgängig',
          // Der Dialog ist dann schon zu — deshalb über den Client direkt
          onClick: () => {
            utils.client.finance.deleteTransaction
              .mutate({ id: data.id })
              .then(() => {
                toast('Buchung zurückgenommen.');
                invalidate();
              })
              .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Rückgängig fehlgeschlagen.'));
          },
        },
      });
      invalidate();
      close();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    // parseEuro liefert den Absolutbetrag — das Vorzeichen kommt aus der Eingabe
    const cents = parseEuro(amount);
    if (cents <= 0) {
      toast.error('Bitte einen gültigen Betrag eingeben.');
      return;
    }
    if (!account || !user) {
      toast.error('Kein bearbeitbares Konto vorhanden.');
      return;
    }
    if (type === 'transfer') {
      if (!canWithdraw) {
        toast.error('Für eine Abhebung braucht es ein Bargeldkonto und ein anderes Konto mit Bearbeitungsrecht.');
        return;
      }
      createTx.mutate({
        type: 'transfer',
        accountId: withdrawSource!.id,
        toAccountId: cash!.id,
        amount: cents,
        userId: user.id,
        date: todayISO(),
        note: note.trim() || 'Bargeldbezug',
      });
      return;
    }
    // Kategorie des Chips/Vorschlags nur, wenn die Art noch passt (das
    // Vorzeichen kann danach geändert worden sein); sonst die zuletzt
    // verwendete der Art (ohne Stornos)
    const pickedCategory = picked && picked.type === type ? picked.categoryId : null;
    const categoryId = pickedCategory ?? usage.data?.[type].last ?? null;
    createTx.mutate({
      type,
      accountId: account.id,
      amount: cents,
      categoryId: categoryId ?? undefined,
      userId: user.id,
      date: todayISO(),
      note: note.trim(),
    });
  };

  // Häufigste Kategorien der Art als Chips (B3); die aktive ist markiert
  const activeCategory = type === 'transfer'
    ? null
    : (picked && picked.type === type ? picked.categoryId : usage.data?.[type].last ?? null);
  const chips = type === 'transfer'
    ? []
    : [...new Set([...(usage.data?.[type].frequent ?? []), ...(activeCategory ? [activeCategory] : [])])]
        .map((id) => categories.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .slice(0, 6);
  // „Abhebung“ nur, wenn es eine Kasse gibt — oder wenn sie ausdrücklich
  // verlangt wurde (dann mit Hinweis, statt still als Ausgabe zu buchen)
  const modes: QuickMode[] = canWithdraw || mode === 'withdrawal' ? ['expense', 'income', 'withdrawal'] : ['expense', 'income'];

  return (
    <DialogContent
      onCloseAutoFocus={onCloseAutoFocus}
      className="sm:max-w-md"
      onEscapeKeyDown={(e) => {
        // Bei offener Vorschlagsliste schließt Escape nur die Liste
        if ((e.target as HTMLElement | null)?.getAttribute?.('aria-expanded') === 'true') e.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Schnellerfassung</DialogTitle>
        <DialogDescription>
          Betrag und Notiz genügen — Kategorie, Datum und Person setzt die App.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Art" className="flex rounded-lg border bg-muted/40 p-1 text-sm">
          {modes.map((m) => {
            const active = (m === 'income' ? type === 'income' : m === 'expense' ? type === 'expense' : type === 'transfer');
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onKeyDown={(e) => radioKeyDown(e, modes, mode, (next) => {
                  setMode(next);
                  if (next !== 'income') setAmount((a) => a.replace(/^\s*-/, ''));
                })}
                onClick={() => {
                  setMode(m);
                  // Ein Minus im Betrag widerspräche dem Schalter
                  if (m !== 'income') setAmount((a) => a.replace(/^\s*-/, ''));
                }}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 transition-colors',
                  active ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  active && m === 'income' && 'text-positive',
                  active && m === 'expense' && 'text-negative',
                )}
              >
                {MODE_LABELS[m]}
              </button>
            );
          })}
        </div>
        {/* Mobil bricht „Buchen“ in eine eigene Zeile — sonst blieb für die Notiz kaum Platz */}
        <form
          className="flex flex-wrap gap-2 sm:flex-nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            inputMode="decimal"
            placeholder={amountPlaceholder}
            aria-label="Betrag"
            className="w-28 sm:w-32"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="min-w-40 flex-1">
            <NoteSuggestInput
              placeholder={type === 'transfer' ? 'Notiz (optional, sonst „Bargeldbezug“)' : 'Notiz (optional)'}
              type={type}
              value={note}
              onChange={(v) => {
                setNote(v);
                setPicked(null);
              }}
              onPick={(s) => {
                setNote(s.note);
                if (type !== 'transfer') setPicked({ categoryId: s.categoryId, type });
                if (parseEuro(amount) <= 0) setAmount(formatAmountInput(s.amount));
              }}
            />
          </div>
          <Button type="submit" className="w-full sm:w-auto" disabled={createTx.isPending || (type === 'transfer' && !canWithdraw)}>
            Buchen
          </Button>
        </form>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kategorie">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={activeCategory === c.id}
                onClick={() => setPicked({ categoryId: c.id, type: type as 'income' | 'expense' })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  activeCategory === c.id ? 'border-foreground/40 bg-background font-medium' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: pencil(c.color) }} />
                {c.name}
              </button>
            ))}
          </div>
        )}
        {type === 'transfer' && !canWithdraw && (
          <p className="text-sm text-negative">
            Für eine Abhebung braucht es ein Bargeldkonto und ein anderes Konto mit Bearbeitungsrecht.
          </p>
        )}
        {type === 'transfer' && canWithdraw && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Von</span>
              <SearchableSelect
                value={String(withdrawSource!.id)}
                onValueChange={(v) => setSourceId(Number(v))}
                options={nonCash.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }))}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Auf (Bargeld)</span>
              <SearchableSelect
                value={String(cash!.id)}
                onValueChange={(v) => setCashId(Number(v))}
                options={cashAccounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }))}
              />
            </div>
          </div>
        )}
        {type !== 'transfer' && (
        <div className="space-y-1">
          <SearchableSelect
            value={account ? String(account.id) : ''}
            onValueChange={(v) => {
              const id = Number(v);
              if (id !== user?.quickAccountId) setQuickAccount.mutate({ accountId: id });
            }}
            options={editableAccounts.map((a) => ({
              value: String(a.id),
              label: accountLabel(a, banks),
            }))}
            placeholder="Konto wählen"
            disabled={editableAccounts.length === 0 || setQuickAccount.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Buchungskonto — deine Wahl wird für die Schnellerfassung gespeichert.
          </p>
        </div>
        )}
      </div>
    </DialogContent>
  );
}
