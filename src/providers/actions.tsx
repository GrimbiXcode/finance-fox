import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Globale Aktionen, die von überall ausgelöst werden: Befehlspalette (⌘K),
 * Tastaturkürzel und Knöpfe öffnen dieselben Dialoge, die das Layout einmal
 * rendert — statt dass jede Seite einen eigenen Dialog mitbringt.
 */
type Dialog = 'transaction' | 'quick' | 'palette' | 'shortcuts';

interface ActionsValue {
  open: Dialog | null;
  /** Zählt jedes Öffnen — als `key` setzt er Formulare je Öffnen neu auf */
  seq: number;
  show: (dialog: Dialog) => void;
  close: () => void;
  /**
   * Für `onCloseAutoFocus` der globalen Dialoge: Radix gäbe den Fokus an
   * einen Auslöser zurück — per Kürzel geöffnet gibt es keinen, der Fokus
   * landete auf <body>. Stattdessen zurück aufs zuvor fokussierte Element.
   */
  restoreFocus: (e: Event) => void;
}

const ActionsContext = createContext<ActionsValue | null>(null);

/**
 * Gehört die Taste einem Bedienelement? Eingabefelder, aber auch Auswahl-
 * listen und Menüs (Radix-Select-Auslöser haben `role="combobox"`, deren
 * Listen `listbox`) — dort bedeutet ein Buchstabe „springe zum Eintrag“.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return true;
  return target.closest('[role="combobox"], [role="listbox"], [role="menu"], [role="option"]') !== null;
}

/** Offene Dialoge, Auswahllisten oder Menüs — dann keine Einzeltasten */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]';

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Dialog | null>(null);
  const [seq, setSeq] = useState(0);
  const lastFocus = useRef<HTMLElement | null>(null);
  const show = useCallback((dialog: Dialog) => {
    // Nur beim Öffnen aus der Seite merken — nicht, wenn ein globaler Dialog
    // (Befehlspalette) den nächsten öffnet
    if (!document.activeElement?.closest('[role="dialog"]')) {
      lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setSeq((n) => n + 1);
    setOpen(dialog);
  }, []);
  const close = useCallback(() => setOpen(null), []);
  const restoreFocus = useCallback((e: Event) => {
    const el = lastFocus.current;
    if (el && el.isConnected && el !== document.body) {
      e.preventDefault();
      el.focus();
    }
  }, []);

  // Tastaturkürzel: ⌘K/Strg+K immer, Einzeltasten nur außerhalb von
  // Eingabefeldern und wenn kein anderer Dialog offen ist
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Offene Palette schließen; über einem anderen Dialog nichts tun —
        // sonst ersetzte sie eine halb ausgefüllte Buchung oder stapelte
        // sich über einen Seiten-Dialog
        if (document.querySelector('[data-command-palette]')) setOpen(null);
        else if (!document.querySelector('[role="dialog"], [role="alertdialog"]')) show('palette');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTyping(e.target)) return;
      if (document.querySelector(OVERLAY)) return;
      const map: Record<string, Dialog> = { n: 'transaction', s: 'quick', '/': 'palette', '?': 'shortcuts' };
      const dialog = map[e.key];
      if (dialog) {
        e.preventDefault();
        show(dialog);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  const value = useMemo(
    () => ({ open, seq, show, close, restoreFocus }),
    [open, seq, show, close, restoreFocus],
  );
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

export function useActions(): ActionsValue {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions muss innerhalb von ActionsProvider stehen');
  return ctx;
}

/** Übersicht der Kürzel (Hilfe-Dialog, Tooltips) */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['⌘', 'K'], label: 'Suchen und Befehle (auch Strg+K oder /)' },
  { keys: ['N'], label: 'Neue Buchung' },
  { keys: ['S'], label: 'Schnellerfassung' },
  { keys: ['⌘', 'Enter'], label: 'Im Buchungsdialog: speichern' },
  { keys: ['⌘', '⇧', 'Enter'], label: 'Im Buchungsdialog: speichern & weitere' },
  { keys: ['?'], label: 'Diese Übersicht' },
];
