import { useState } from 'react';
import { History } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_GROUPS } from '@/lib/auditLabels';
import { useFinanceData } from '@/lib/data';
import { formatDate, getUserLocale } from '@/lib/finance';
import { CHART } from '@/lib/chartColors';
import { pencil } from '@/lib/pencil';
import { trpc } from '@/providers/trpc';

const timeFormat = new Intl.DateTimeFormat(getUserLocale(), { timeStyle: 'short' });
type RangeKey = 'all' | 'today' | '7' | '30' | 'year';
const RANGE_LABELS: Record<RangeKey, string> = {
  all: 'Gesamter Zeitraum', today: 'Heute', '7': 'Letzte 7 Tage', '30': 'Letzte 30 Tage', year: 'Dieses Jahr',
};
/** Beginn des Zeitfensters in lokaler Zeit (Mitternacht) als Epoch-ms */
function sinceFor(range: RangeKey): number | undefined {
  if (range === 'all') return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === 'year') d.setMonth(0, 1);
  else if (range !== 'today') d.setDate(d.getDate() - Number(range) + 1);
  return d.getTime();
}
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * „Wer hat was gebucht oder geändert?“ — die Chronik des Haushalts als eigene
 * Seite (vorher ganz unten in den Einstellungen). Filter nach Person und
 * Bereich; der Server liefert nur Einträge, die man sehen darf (fremde
 * Vorsorge und Buchungen auf fremden Privatkonten bleiben verborgen).
 */
export default function Activity() {
  const { users } = useFinanceData();
  const [limit, setLimit] = useState(100);
  const [group, setGroup] = useState('all');
  const [person, setPerson] = useState('all');
  const [range, setRange] = useState<RangeKey>('all');
  const entities = group === 'all' || group === 'system'
    ? undefined
    : AUDIT_ENTITY_GROUPS.find(([key]) => key === group)?.[2];
  const query = trpc.finance.listAuditLog.useQuery({
    limit,
    entities,
    userId: person !== 'all' ? Number(person) : undefined,
    since: sinceFor(range),
  });
  const entries = (query.data ?? []).filter((e) => group !== 'system' || e.userName === null);

  // Nach Tagen gruppieren — „heute“ und „gestern“ statt Datum
  const today = dayKey(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);
  const days: { key: string; items: typeof entries }[] = [];
  for (const e of entries) {
    const key = dayKey(new Date(e.createdAt));
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(e);
    else days.push({ key, items: [e] });
  }
  const dayLabel = (key: string) =>
    key === today ? 'Heute' : key === yesterday ? 'Gestern' : formatDate(key);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Verlauf</h1>
        <p className="text-sm text-muted-foreground">
          Wer hat was gebucht oder geändert — die Chronik des Haushalts
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Aktivitäten
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <SearchableSelect
                value={person}
                onValueChange={setPerson}
                className="w-44"
                options={[
                  { value: 'all', label: 'Alle Personen' },
                  ...users.map((u) => ({ value: String(u.id), label: u.name })),
                ]}
              />
              <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
                <SelectTrigger className="w-44 min-w-0 [&>span]:truncate" title={RANGE_LABELS[range]}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
                    <SelectItem key={k} value={k}>{RANGE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger className="w-44 min-w-0 [&>span]:truncate" title="Bereich">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Bereiche</SelectItem>
                  {AUDIT_ENTITY_GROUPS.map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription>
            Private Vorsorge-Daten und Buchungen auf Privatkonten erscheinen nur
            bei denen, die sie sehen dürfen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {query.isLoading ? 'Lade…' : 'Keine Einträge für diese Auswahl.'}
            </p>
          )}
          {days.map((d) => (
            <section key={d.key}>
              <h2 className="mb-1 text-sm font-semibold">{dayLabel(d.key)}</h2>
              <ul className="divide-y">
                {d.items.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm">
                    <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {timeFormat.format(new Date(e.createdAt))}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 font-medium">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pencil(e.userColor) ?? CHART.muted }} />
                      {e.userName ?? 'System'}
                    </span>
                    <span>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</span>
                    {e.detail && <span className="min-w-0 text-muted-foreground">{e.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {(query.data?.length ?? 0) >= limit && (
            <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => setLimit((l) => l + 100)}>
              Mehr laden
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
