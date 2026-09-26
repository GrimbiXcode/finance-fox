import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from 'next-themes';
import {
  ArrowLeftRight, History, Keyboard, Moon, PiggyBank, Plus, Repeat, Search, Tag, Umbrella, Wallet, Zap,
} from 'lucide-react';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useFinanceData } from '@/lib/data';
import { formatCents, formatDate } from '@/lib/finance';
import { navItems } from '@/lib/navigation';
import { useActions } from '@/providers/actions';
import { trpc } from '@/providers/trpc';

/**
 * Befehlspalette (⌘K, Strg+K oder /): Seiten, Aktionen, Konten, Kategorien,
 * Sparziele, Policen und Buchungen an einem Ort. Buchungen sucht der Server
 * (ab zwei Zeichen, über alle Zeiträume); alles andere filtert cmdk lokal.
 */
export default function CommandPalette() {
  const { open, show, close, restoreFocus } = useActions();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const { accounts, categories, goals: allGoals } = useFinanceData();
  // Abgeschlossene Ziele liegen im Archiv, nicht in der Schnellsuche
  const goals = allGoals.filter((g) => g.archivedAt === null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const isOpen = open === 'palette';

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const policies = trpc.insurance.listPolicies.useQuery(undefined, { enabled: isOpen });
  const txSearch = trpc.finance.searchTransactions.useQuery(
    { search: debounced, limit: 6 },
    { enabled: isOpen && debounced.length >= 2 },
  );

  const go = (to: string) => {
    close();
    setQuery('');
    navigate(to);
  };
  const run = (fn: () => void) => {
    setQuery('');
    fn();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => (o ? show('palette') : close())}>
      <DialogContent
        data-command-palette
        className="overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
        onCloseAutoFocus={restoreFocus}
      >
        <DialogTitle className="sr-only">Suchen und Befehle</DialogTitle>
        <DialogDescription className="sr-only">
          Seiten, Aktionen, Konten, Kategorien und Buchungen finden
        </DialogDescription>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:py-2">
          <CommandInput
            placeholder="Suchen: Seite, Konto, Kategorie, Buchung…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>Nichts gefunden.</CommandEmpty>
            <CommandGroup heading="Aktionen">
              <CommandItem value="Neue Buchung erfassen" onSelect={() => run(() => show('transaction'))}>
                <Plus /> Neue Buchung
                <CommandShortcut>N</CommandShortcut>
              </CommandItem>
              <CommandItem value="Schnellerfassung schnell buchen" onSelect={() => run(() => show('quick'))}>
                <Zap /> Schnellerfassung
                <CommandShortcut>S</CommandShortcut>
              </CommandItem>
              <CommandItem value="Neue Dauerbuchung wiederkehrend anlegen" onSelect={() => go('/wiederkehrend?neu=1')}>
                <Repeat /> Neue Dauerbuchung
              </CommandItem>
              <CommandItem
                value="Dunkelmodus hell dunkel umschalten"
                onSelect={() => run(() => { setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); close(); })}
              >
                <Moon /> {resolvedTheme === 'dark' ? 'Heller Modus' : 'Dunkler Modus'}
              </CommandItem>
              <CommandItem value="Tastaturkürzel Hilfe" onSelect={() => run(() => show('shortcuts'))}>
                <Keyboard /> Tastaturkürzel
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Seiten">
              {navItems.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`Seite ${item.label} ${item.keywords?.join(' ') ?? ''}`}
                  onSelect={() => go(item.to)}
                >
                  <item.icon /> {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {debounced.length >= 2 && (txSearch.data?.items.length ?? 0) > 0 && (
              <CommandGroup heading={`Buchungen (${txSearch.data!.total} Treffer)`}>
                {txSearch.data!.items.map((t) => (
                  <CommandItem
                    key={t.id}
                    // Der Suchbegriff gehört in den Wert, sonst filtert cmdk
                    // die Server-Treffer wieder heraus
                    value={`Buchung ${t.id} ${t.note} ${debounced}`}
                    onSelect={() => go(`/transaktionen?${new URLSearchParams({ monat: t.date.slice(0, 7), fokus: String(t.id) })}`)}
                  >
                    <ArrowLeftRight />
                    <span className="min-w-0 flex-1 truncate">{t.note || 'ohne Notiz'}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDate(t.date)} · {formatCents(t.amount)}
                    </span>
                  </CommandItem>
                ))}
                {txSearch.data!.total > txSearch.data!.items.length && (
                  <CommandItem
                    value={`Alle Buchungen suchen ${debounced}`}
                    onSelect={() => go(`/transaktionen?${new URLSearchParams({ zeit: 'alle', q: debounced })}`)}
                  >
                    <Search /> Alle {txSearch.data!.total} Treffer anzeigen
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            <CommandGroup heading="Konten">
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`Konto ${a.name} ${a.iban ?? ''}`}
                  onSelect={() => go(`/transaktionen?${new URLSearchParams({ zeit: 'alle', konto: String(a.id) })}`)}
                >
                  <Wallet />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatCents(a.balance)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Kategorien (Buchungen dieses Monats)">
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`Kategorie ${c.name}`}
                  onSelect={() => go(`/transaktionen?kategorie=${c.id}`)}
                >
                  <Tag /> {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {goals.length > 0 && (
              <CommandGroup heading="Sparziele">
                {goals.map((g) => (
                  <CommandItem key={g.id} value={`Sparziel ${g.name}`} onSelect={() => go('/sparziele')}>
                    <PiggyBank /> {g.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {(policies.data?.length ?? 0) > 0 && (
              <CommandGroup heading="Versicherungen">
                {policies.data!.map((p) => (
                  <CommandItem key={p.id} value={`Police ${p.name} ${p.insurer}`} onSelect={() => go('/versicherungen')}>
                    <Umbrella /> {p.name}
                    {p.insurer && <span className="text-xs text-muted-foreground">{p.insurer}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Verlauf">
              <CommandItem value="Aktivitäten Verlauf wer hat was geändert" onSelect={() => go('/verlauf')}>
                <History /> Wer hat was geändert?
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
