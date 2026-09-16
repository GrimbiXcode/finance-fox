import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-7 w-7 rounded-[5px] border-[1.5px]",
  md: "h-9 w-9 rounded-md border-2",
  lg: "h-12 w-12 rounded-md border-2",
} as const;

/**
 * Markenzeichen im Papier-Design: der Fuchs hinter dem Kassenbuch als
 * Stempel – grüner Rahmen und grüne Tinte auf Blatt. Dieselbe Zeichnung wie
 * `public/icons/icon.svg`, in zwei Stufen: `lg` (Login, Einrichtung,
 * Ladebildschirm) zeigt die Buchungszeilen, `sm`/`md` (Seitenleiste,
 * Kopfzeile) nur die Summenlinie, damit bei 20–30 px nichts zu Rauschen wird.
 */
export default function BrandMark({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const full = size === "lg";
  const sheetStroke = full ? 4 : 5;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border-stamp bg-card text-stamp",
        SIZES[size],
        className
      )}
      aria-hidden
    >
      <svg viewBox="0 0 100 100" className="h-[80%] w-[80%]">
        {/* Kopf: Ohren, Stirn, Wangen; die Schnauze läuft hinter dem Blatt zusammen */}
        <path
          d="M19 9 L40 32 C44 28 56 28 60 32 L81 9 C82 22 78 34 77 42 C74 54 66 66 64 72 L36 72 C34 66 26 54 23 42 C22 34 18 22 19 9 Z"
          fill="currentColor"
        />
        <g fill="hsl(var(--card))">
          <ellipse cx="37" cy="44.5" rx="3.3" ry="4.3" transform="rotate(-14 37 44.5)" />
          <ellipse cx="63" cy="44.5" rx="3.3" ry="4.3" transform="rotate(14 63 44.5)" />
        </g>
        {/* Blatt mit Eselsohr */}
        <path
          d="M14 50 H72 L86 64 V88 H14 Z"
          fill="hsl(var(--card))"
          stroke="currentColor"
          strokeWidth={sheetStroke}
          strokeLinejoin="round"
        />
        <path d="M72 50 V64 H86" fill="none" stroke="currentColor" strokeWidth={sheetStroke} strokeLinejoin="round" />
        {full ? (
          // Kassenbuch: Text links, Betrag rechts, Summe mit Doppelstrich
          <g stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
            <line x1="24" y1="63" x2="46" y2="63" />
            <line x1="60" y1="63" x2="70" y2="63" />
            <line x1="24" y1="71" x2="50" y2="71" />
            <line x1="68" y1="71" x2="76" y2="71" />
            <line x1="24" y1="80" x2="76" y2="80" />
            <line x1="24" y1="83.5" x2="76" y2="83.5" />
          </g>
        ) : (
          <g stroke="currentColor" strokeWidth={3.2} strokeLinecap="round">
            <line x1="25" y1="73" x2="75" y2="73" />
            <line x1="25" y1="79" x2="75" y2="79" />
          </g>
        )}
      </svg>
    </div>
  );
}
