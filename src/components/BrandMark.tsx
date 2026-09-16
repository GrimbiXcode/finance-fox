import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-7 w-7 rounded-[5px] border-[1.5px]",
  md: "h-9 w-9 rounded-md border-2",
  lg: "h-12 w-12 rounded-md border-2",
} as const;

/**
 * Markenzeichen im Papier-Design: der Fuchs aus `public/icons/icon.svg` als
 * Stempel – grüner Umriss und grüne Tinte auf Blatt, statt weiß auf grüner
 * Kachel. Wird in Seitenleiste, Kopfzeile, Login/Einrichtung und dem
 * Ladebildschirm verwendet.
 */
export default function BrandMark({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border-stamp bg-card text-stamp",
        SIZES[size],
        className
      )}
      aria-hidden
    >
      <svg
        viewBox="0 0 512 512"
        className="h-[68%] w-[68%]"
        fill="currentColor"
      >
        <path d="M156 108 L216 196 L128 208 Z" />
        <path d="M356 108 L296 196 L384 208 Z" />
        <path d="M256 176C196 176 148 224 148 284C148 340 196 392 256 424C316 392 364 340 364 284C364 224 316 176 256 176Z" />
        <g fill="hsl(var(--card))">
          <circle cx="214" cy="272" r="16" />
          <circle cx="298" cy="272" r="16" />
          <circle cx="256" cy="352" r="12" />
        </g>
      </svg>
    </div>
  );
}
