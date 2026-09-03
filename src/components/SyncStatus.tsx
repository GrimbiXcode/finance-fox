import { Link } from "react-router";
import {
  AlertTriangle,
  Check,
  CloudOff,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useOffline } from "@/providers/offline";
import { formatSyncTime } from "@/lib/syncTime";

/**
 * Abgleich-Anzeige in der Kopfzeile.
 *
 * Sie beantwortet die drei Fragen, die unterwegs zählen: Bin ich im Heimnetz?
 * Wartet noch etwas auf die Übertragung? Gibt es etwas zu entscheiden?
 * Ohne Offline-Betrieb (kein HTTPS, Dev-Server) erscheint sie gar nicht.
 */
export default function SyncStatus() {
  const { status, available, syncNow } = useOffline();
  if (!available || !status) return null;

  const conflicts = status.conflicts;
  const pending = status.pending;

  const icon = status.syncing ? (
    <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
  ) : conflicts > 0 ? (
    <AlertTriangle className="h-4 w-4 text-amber-600" />
  ) : pending > 0 ? (
    <UploadCloud className="h-4 w-4 text-muted-foreground" />
  ) : status.reachable ? (
    <Check className="h-4 w-4 text-emerald-600" />
  ) : (
    <CloudOff className="h-4 w-4 text-muted-foreground" />
  );

  const label = status.syncing
    ? "Abgleich läuft"
    : conflicts > 0
      ? `${conflicts} Konflikt${conflicts === 1 ? "" : "e"} zu entscheiden`
      : pending > 0
        ? `${pending} Änderung${pending === 1 ? "" : "en"} warten auf das Heimnetz`
        : status.reachable
          ? "Alles abgeglichen"
          : "Offline — Änderungen werden gesammelt";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title={label} className="relative">
          {icon}
          {(conflicts > 0 || pending > 0) && (
            <span
              className={`absolute right-1 top-1 h-2 w-2 rounded-full ${
                conflicts > 0 ? "bg-amber-500" : "bg-sky-500"
              }`}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            Zuletzt abgeglichen: {formatSyncTime(status.lastSyncAt)}
          </p>
          {!status.reachable && (
            <p className="text-xs text-muted-foreground">
              Die App arbeitet mit dem zuletzt abgeglichenen Stand weiter.
              Sobald der Heimserver wieder erreichbar ist, geht alles von selbst
              raus.
            </p>
          )}
        </div>

        {conflicts > 0 && (
          <Link
            to="/abgleich"
            className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="min-w-0">
              {conflicts === 1 ? "Ein Datensatz" : `${conflicts} Datensätze`}{" "}
              wurde{conflicts === 1 ? "" : "n"} doppelt geändert — jetzt
              entscheiden
            </span>
          </Link>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={status.syncing}
          onClick={syncNow}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${status.syncing ? "animate-spin" : ""}`}
          />
          Jetzt abgleichen
        </Button>
      </PopoverContent>
    </Popover>
  );
}
