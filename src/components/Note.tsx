import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Notizzettel (Papier-Design): ein gelber Zettel, der auf dem Blatt klebt –
 * für Hinweise und Erinnerungen (Zinsbindung läuft ab, Kündigungsfrist,
 * fehlende Angaben). Fehler beim Speichern gehören nicht hierher, die
 * stehen als Zeile in Rotstift unter dem Feld.
 */
export default function Note({
  title,
  icon: Icon,
  children,
  className,
  tilt = -0.6,
}: {
  title?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  /** Leichte Drehung in Grad – jeder Zettel darf etwas anders liegen */
  tilt?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-[2px] bg-note px-4 py-3 text-sm text-note-foreground shadow-note",
        className
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {title && (
        <div className="mb-1 flex items-center gap-2 font-serif text-[15px] font-semibold">
          {Icon && <Icon className="h-4 w-4 shrink-0" />}
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
