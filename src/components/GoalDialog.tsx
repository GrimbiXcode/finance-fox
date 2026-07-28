import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInvalidateFinance } from '@/lib/data';
import { amountPlaceholder, currencySymbol, parseEuro } from '@/lib/finance';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/** Farbpalette für Sparziele (wie bisher auf der Ziele-Seite) */
const GOAL_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#6366f1'];

/** Sparziel, wie es finance.listGoals liefert (nur die hier benötigten Felder) */
export interface DialogGoal {
  id: number;
  name: string;
  targetAmount: number | null; // null = offenes Ziel ohne Zielbetrag
  color: string;
  deadline: string | null;
}

/** Dialog zum Anlegen (ohne `goal`) und Bearbeiten (mit `goal`) eines Sparziels */
export default function GoalDialog({ goal, trigger }: { goal?: DialogGoal; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <GoalDialogForm goal={goal} close={() => setOpen(false)} />}
    </Dialog>
  );
}

/** Formular-Inhalt; wird bei jedem Öffnen neu gemountet, damit die Initialwerte stimmen */
function GoalDialogForm({ goal, close }: { goal?: DialogGoal; close: () => void }) {
  const invalidate = useInvalidateFinance();
  const isEdit = !!goal;
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(
    goal?.targetAmount != null ? (goal.targetAmount / 100).toFixed(2).replace('.', ',') : '',
  );
  const [color, setColor] = useState(goal?.color ?? GOAL_COLORS[0]);
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');

  const createGoal = trpc.finance.createGoal.useMutation({
    onSuccess: () => { toast.success('Sparziel angelegt.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const updateGoal = trpc.finance.updateGoal.useMutation({
    onSuccess: () => { toast.success('Sparziel gespeichert.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const deleteGoal = trpc.finance.deleteGoal.useMutation({
    onSuccess: () => { toast.success('Sparziel gelöscht.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    // Leerer Zielbetrag = offenes Ziel (null); sonst muss der Betrag > 0 sein
    const targetCents = target.trim() === '' ? null : parseEuro(target);
    if (!name.trim()) {
      toast.error('Name angeben.');
      return;
    }
    if (targetCents !== null && targetCents <= 0) {
      toast.error('Zielbetrag größer 0 angeben oder leer lassen.');
      return;
    }
    if (isEdit && goal) {
      updateGoal.mutate({
        id: goal.id,
        name: name.trim(),
        targetAmount: targetCents,
        color,
        deadline: deadline || null,
      });
    } else {
      createGoal.mutate({
        name: name.trim(),
        targetAmount: targetCents,
        color,
        deadline: deadline || undefined,
      });
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Sparziel bearbeiten' : 'Neues Sparziel'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Name, Zielbetrag, Farbe und Stichtag anpassen.'
            : 'Lege ein Sparziel an und verknüpfe es danach mit einem Konto.'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input placeholder="z. B. Urlaub, Notgroschen" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Zielbetrag ({currencySymbol()})</Label>
          <Input inputMode="decimal" placeholder={amountPlaceholder} value={target} onChange={(e) => setTarget(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Leer lassen für ein offenes Ziel — dann zählt nur der angesparte Betrag.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Farbe</Label>
          <div className="flex items-center gap-1.5">
            {GOAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => setColor(c)}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition-transform',
                  color === c ? 'scale-110 border-foreground' : 'border-transparent',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Stichtag (optional)</Label>
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>

        {isEdit && goal && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">Gefahrenzone</p>
            <p className="text-xs text-muted-foreground">
              Das Sparziel wird unwiderruflich gelöscht. Konto-Verknüpfungen und
              Bestands-Beiträge werden entfernt, die Konten selbst bleiben bestehen.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleteGoal.isPending}>
                  Sparziel endgültig löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sparziel wirklich löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{goal.name}“ wird unwiderruflich gelöscht. Verknüpfungen und
                    Bestands-Beiträge werden entfernt.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteGoal.mutate({ id: goal.id })}
                  >
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>Abbrechen</Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={createGoal.isPending || updateGoal.isPending}
        >
          {isEdit ? 'Speichern' : 'Anlegen'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
