import { useState } from 'react';
import { ArrowDown, ArrowUp, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useAuth } from '@/providers/auth';
import { trpc } from '@/providers/trpc';
import {
  DASHBOARD_CARDS, DEFAULT_DASHBOARD_LAYOUT, type DashboardLayout,
} from '@contracts/dashboard';
import { toast } from 'sonner';

const LABELS = new Map<string, string>(DASHBOARD_CARDS.map((c) => [c.id, c.label]));

/**
 * „Anpassen“ (D7): Karten des Dashboards ein-/ausblenden und umsortieren.
 * Gespeichert pro Benutzer am Server (`auth.setDashboardLayout`), damit die
 * Anordnung auf allen Geräten gilt. Pfeil-Knöpfe statt Ziehen: gehen mit
 * Tastatur und auf dem Handy gleich gut.
 */
export default function DashboardCustomizeDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" title="Karten des Dashboards ein- und ausblenden, Reihenfolge ändern">
          <LayoutGrid className="mr-2 h-4 w-4" /> Anpassen
        </Button>
      </DialogTrigger>
      {open && <CustomizeForm close={() => setOpen(false)} />}
    </Dialog>
  );
}

function CustomizeForm({ close }: { close: () => void }) {
  const { user, refresh } = useAuth();
  const [layout, setLayout] = useState<DashboardLayout>(user?.dashboardLayout ?? DEFAULT_DASHBOARD_LAYOUT);
  const save = trpc.auth.setDashboardLayout.useMutation({
    onSuccess: () => {
      toast.success('Dashboard gespeichert.');
      refresh();
      close();
    },
    onError: (err) => toast.error(err.message),
  });

  const move = (index: number, delta: number) =>
    setLayout((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const toggle = (index: number, visible: boolean) =>
    setLayout((prev) => prev.map((c, i) => (i === index ? { ...c, visible } : c)));

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Dashboard anpassen</DialogTitle>
        <DialogDescription>
          Welche Karten du siehst und in welcher Reihenfolge — gilt für dich auf allen Geräten.
          Manche Karten erscheinen nur im laufenden Monat.
        </DialogDescription>
      </DialogHeader>
      <ul className="divide-y rounded-md border">
        {layout.map((card, i) => (
          <li key={card.id} className="flex items-center gap-2 px-3 py-1.5">
            <Checkbox
              id={`card-${card.id}`}
              checked={card.visible}
              onCheckedChange={(v) => toggle(i, v === true)}
            />
            <label htmlFor={`card-${card.id}`} className="min-w-0 flex-1 cursor-pointer text-sm">
              {LABELS.get(card.id) ?? card.id}
            </label>
            <Button
              variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0}
              title="Nach oben" aria-label={`${LABELS.get(card.id)} nach oben`}
              onClick={() => move(i, -1)}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7" disabled={i === layout.length - 1}
              title="Nach unten" aria-label={`${LABELS.get(card.id)} nach unten`}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          variant="ghost"
          disabled={save.isPending || !user?.dashboardCustomized}
          onClick={() => save.mutate({ layout: null })}
        >
          Standard wiederherstellen
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={close}>Abbrechen</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate({ layout })}>Speichern</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
