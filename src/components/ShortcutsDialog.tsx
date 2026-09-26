import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { SHORTCUTS, useActions } from '@/providers/actions';

/** Übersicht der Tastaturkürzel („?“) */
export default function ShortcutsDialog() {
  const { open, show, close, restoreFocus } = useActions();
  return (
    <Dialog open={open === 'shortcuts'} onOpenChange={(o) => (o ? show('shortcuts') : close())}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={restoreFocus}>
        <DialogHeader>
          <DialogTitle>Tastaturkürzel</DialogTitle>
          <DialogDescription>
            Einzeltasten wirken, solange kein Eingabefeld, keine Auswahlliste
            und kein Dialog aktiv ist. Unter Windows und Linux steht Strg statt ⌘.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y text-sm">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-3 py-2">
              <span>{s.label}</span>
              <KbdGroup>
                {s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
              </KbdGroup>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
