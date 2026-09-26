import { Input } from '@/components/ui/input';
import { todayISO } from '@/lib/finance';
import { cn } from '@/lib/utils';

const yesterdayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Datumsfeld mit Schnellwahl „Heute“/„Gestern“ — die zwei Tage, an denen
 * fast alle Belege entstehen. Bewusst das native Datumsfeld: Es zeigt das
 * Datum im Format des Geräts und bringt auf dem Handy den System-Kalender
 * mit (siehe Entscheidung E-24 in docs/usability-analyse.md).
 */
export default function DateField({
  id, value, onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const today = todayISO();
  const yesterday = yesterdayISO();
  const chip = (date: string, label: string) => (
    <button
      type="button"
      onClick={() => onChange(date)}
      aria-pressed={value === date}
      className={cn(
        'rounded px-1.5 text-xs transition-colors',
        value === date ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-1">
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex gap-1">
        {chip(today, 'Heute')}
        {chip(yesterday, 'Gestern')}
      </div>
    </div>
  );
}
