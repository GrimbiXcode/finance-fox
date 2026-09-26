import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

/**
 * Suchbares Auswahlfeld für datengetriebene Optionen (Konten, Kategorien,
 * Personen, Banken, …). Der Trigger sieht aus wie ein SelectTrigger (gleiche
 * Optik, Truncation per `min-w-0`/`truncate`, Hover-Titel mit dem
 * vollständigen Label), der Inhalt ist ein Popover mit cmdk-Suchfeld.
 * Kleine Enum-Auswahlen (2–4 feste Werte wie Buchungsart oder Intervall)
 * bleiben bewusst native Selects — eine Suche wäre dort UX-Rauschen.
 */
export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Auswählen…',
  disabled,
  className,
  pinned,
  pinnedLabel = 'Häufig',
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Optionen, die zusätzlich oben in einer eigenen Gruppe stehen (z. B. die
   * meistgenutzten Kategorien) — die vollständige Liste folgt darunter.
   */
  pinned?: SearchableSelectOption[];
  pinnedLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    // `modal` ist nötig, damit die Liste auch in einem Dialog scrollbar bleibt:
    // der Scroll-Lock des Dialogs würde Wheel-/Touch-Events im (per Portal
    // ausgelagerten) Popover sonst abfangen. Nur das oberste Lock ist aktiv,
    // also übernimmt das Popover mit `modal` selbst — wie bei Radix Select.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={selected?.label ?? placeholder}
          className={cn(
            'border-input flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'dark:bg-input/30 dark:hover:bg-input/50 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate text-left', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-48 p-0">
        <Command>
          <CommandInput placeholder="Suchen…" />
          <CommandList>
            <CommandEmpty>Nichts gefunden.</CommandEmpty>
            {pinned && pinned.length > 0 && (
              <CommandGroup heading={pinnedLabel}>
                {pinned.map((option) => (
                  <CommandItem
                    // cmdk braucht eindeutige Werte — die Option steht unten noch einmal
                    key={`pinned-${option.value}`}
                    value={`${option.label} · ${pinnedLabel}`}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <Check
                      className={cn('size-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={pinned && pinned.length > 0 ? 'Alle' : undefined}>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <Check
                    className={cn('size-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
