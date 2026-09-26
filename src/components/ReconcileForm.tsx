import { useState, type ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { amountPlaceholder, currencySymbol, formatCents, parseEuro } from '@/lib/finance';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/**
 * Kontoabgleich: Ist-Saldo eingeben, die Differenz zum berechneten Saldo
 * wird als Korrekturbuchung verbucht. Im Konto-Dialog und direkt an der
 * Karte (Kasse zählen) — dieselbe Logik an beiden Stellen.
 */
export default function ReconcileForm({ accountId, onDone }: { accountId: number; onDone?: () => void }) {
  const { accounts } = useFinanceData();
  const invalidate = useInvalidateFinance();
  // Eingegebener Ist-Saldo als Text (locale-bewusst geparst)
  const [actualBalance, setActualBalance] = useState('');
  const reconcile = trpc.finance.reconcileAccount.useMutation({
    onSuccess: () => {
      toast.success('Differenz verbucht.');
      setActualBalance('');
      invalidate();
      onDone?.();
    },
    onError: (err) => toast.error(err.message),
  });
  // Aktuell berechneter Saldo aus listAccounts
  const sollBalance = accounts.find((a) => a.id === accountId)?.balance ?? 0;
  // parseEuro liefert den Betrag ohne Vorzeichen — führendes „-" ehren
  const parsedActual = parseEuro(actualBalance);
  const signedActual = actualBalance.trim().startsWith('-') ? -parsedActual : parsedActual;
  const hasActual = actualBalance.trim() !== '';
  const difference = signedActual - sollBalance;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Berechneter Saldo</span>
        <span className="font-medium tabular-nums">{formatCents(sollBalance)}</span>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`reconcile-${accountId}`}>Ist-Saldo ({currencySymbol()})</Label>
        <Input
          id={`reconcile-${accountId}`}
          inputMode="decimal"
          placeholder={amountPlaceholder}
          value={actualBalance}
          onChange={(e) => setActualBalance(e.target.value)}
        />
      </div>
      {hasActual && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Differenz</span>
          <span className={cn(
            'font-medium tabular-nums',
            difference > 0 ? 'text-positive' : difference < 0 ? 'text-negative' : 'text-muted-foreground',
          )}>
            {difference > 0 ? '+' : ''}{formatCents(difference)}
          </span>
        </div>
      )}
      <Button
        variant="outline"
        disabled={!hasActual || difference === 0 || reconcile.isPending}
        onClick={() => reconcile.mutate({ accountId, actualBalance: signedActual })}
      >
        Differenz verbuchen
      </Button>
    </div>
  );
}

/** Kontoabgleich als eigener Dialog (Konto-Karte: „Kasse zählen“) */
export function ReconcileDialog({
  accountId, accountName, trigger,
}: {
  accountId: number;
  accountName: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Kontoabgleich „{accountName}“</DialogTitle>
          <DialogDescription>
            Tatsächlichen Stand eingeben — die Differenz wird als Korrekturbuchung ohne Kategorie verbucht.
          </DialogDescription>
        </DialogHeader>
        <ReconcileForm accountId={accountId} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
