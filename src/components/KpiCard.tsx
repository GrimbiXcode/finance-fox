import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Kennzahl-Karte für die KPI-Zeilen (Dashboard, Hypotheken, Versicherungen).
 * Mobil stehen vier Karten als 2×2-Raster (`grid-cols-2`) — alle Zahlen auf
 * einen Blick statt viermal scrollen; darum dort kleinere Schrift, engere
 * Ränder und kein Symbol. `to` macht die Zahl zum Link auf die Details,
 * `info` steht neben dem Titel (z. B. ein `InfoTip` mit der Erklärung).
 */
export default function KpiCard({
  title, info, icon, value, valueClassName, to, children,
}: {
  title: string;
  info?: ReactNode;
  icon?: ReactNode;
  value: ReactNode;
  valueClassName?: string;
  to?: string;
  children?: ReactNode;
}) {
  const number = (
    <div className={cn('font-serif text-lg font-semibold tabular-nums sm:text-2xl', valueClassName)}>{value}</div>
  );
  return (
    <Card className="gap-2 py-4 sm:gap-6 sm:py-6">
      <CardHeader className="flex flex-row items-center justify-between gap-1 px-4 pb-0 sm:px-6 sm:pb-2">
        <CardTitle className="flex min-w-0 items-center gap-1 font-sans text-xs font-medium text-muted-foreground sm:text-sm">
          {title}
          {info}
        </CardTitle>
        {icon && <span className="hidden sm:inline">{icon}</span>}
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {to ? (
          <Link to={to} className="block rounded-md hover:underline hover:decoration-dotted hover:underline-offset-4">
            {number}
          </Link>
        ) : number}
        {children}
      </CardContent>
    </Card>
  );
}
