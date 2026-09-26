import type { ReactNode } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ChecklistItem {
  key: string;
  done: boolean;
  label: string;
  /** Was die Angabe freischaltet („→ Nettolohn und Beiträge“) */
  unlocks: string;
  action?: ReactNode;
}

/**
 * Einrichtungs-Checkliste der Fachmodule (Vorsorge, Hypotheken,
 * Versicherungen): welche Angaben fehlen noch und was sie freischalten —
 * statt Nullwerten und leerer Diagramme. Verschwindet, sobald alles da ist.
 */
export default function SetupChecklist({
  title, description, items,
}: {
  title: string;
  description?: string;
  items: ChecklistItem[];
}) {
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
          {title}
          <span className="font-sans text-xs font-normal text-muted-foreground tabular-nums">
            {done} von {items.length} erledigt
          </span>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-label="erledigt" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="offen" />
              )}
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm', item.done && 'text-muted-foreground line-through')}>{item.label}</div>
                <div className="text-xs text-muted-foreground">→ {item.unlocks}</div>
              </div>
              {!item.done && item.action}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
