import type { ReactNode } from "react";
import { moneyLabel } from "@/lib/chartTheme";

/**
 * Tooltip des Papier-Designs für recharts – ein kleines Blatt. Konstanten und
 * Helfer: `lib/chartTheme.ts`, Schraffur-Definitionen: `lib/chartDefs.tsx`.
 */

type TooltipItem = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: { fill?: string } & Record<string, unknown>;
};

/**
 * Tooltip als kleines Blatt: Titel in Serife, je Serie ein Farbpunkt, Name
 * und Wert in Mono. `content={<PaperTooltip … />}` auf `<Tooltip>`.
 */
export function PaperTooltip({
  active,
  payload,
  label,
  formatter = moneyLabel,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  formatter?: (
    value: number | string,
    name: string,
    item: TooltipItem
  ) => ReactNode;
  labelFormatter?: (label: string | number) => ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-[3px] border border-rule-strong bg-card px-2.5 py-2 text-xs text-card-foreground shadow-lift">
      {label !== undefined && label !== "" && (
        <div className="mb-1 font-serif text-[13px] font-semibold">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="space-y-0.5">
        {payload.map((item, i) => (
          <div
            key={`${String(item.dataKey ?? item.name)}-${i}`}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color ?? item.payload?.fill }}
              />
              <span className="truncate">{String(item.name ?? "")}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {formatter(item.value ?? 0, String(item.name ?? ""), item)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
