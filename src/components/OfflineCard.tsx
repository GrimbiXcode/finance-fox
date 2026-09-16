import { useState } from "react";
import { CloudOff, HardDrive, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useOffline } from "@/providers/offline";
import { askWorker, offlineUnsupportedReason } from "@/lib/serviceWorker";
import type { OfflineUnsupportedReason } from "@/lib/serviceWorker";
import { formatBytes } from "@/lib/finance";

/**
 * Karte „Offline-Betrieb" in den Einstellungen.
 *
 * Wichtigster Zweck: erklären, **warum** der Offline-Betrieb gerade nicht zur
 * Verfügung steht. Der häufigste Fall im Heimnetz ist ein Aufruf über
 * `http://192.168.x.x:8080` — Browser lassen Service Worker dort grundsätzlich
 * nicht zu, und ohne Service Worker gibt es keine Offline-App. Ohne diesen
 * Hinweis sähe es so aus, als sei die Funktion kaputt.
 */
const UNSUPPORTED_TEXTS: Record<
  OfflineUnsupportedReason,
  { title: string; body: string }
> = {
  "insecure-context": {
    title: "Offline-Betrieb nicht möglich — keine HTTPS-Verbindung",
    body:
      "Browser erlauben Offline-Apps nur über https:// (oder localhost). " +
      "Diese Seite läuft über eine unverschlüsselte Verbindung. Wie du im " +
      "Heimnetz mit wenigen Handgriffen auf HTTPS kommst, steht in der README " +
      "unter „HTTPS im Heimnetz“ — inklusive fertigem docker-compose-Profil.",
  },
  "no-service-worker": {
    title: "Offline-Betrieb von diesem Browser nicht unterstützt",
    body:
      "Der Browser stellt keine Service Worker bereit. In einem privaten " +
      "Fenster ist das normal — dort bleibt die App online-only.",
  },
  development: {
    title: "Offline-Betrieb im Entwicklungsmodus abgeschaltet",
    body:
      "Der Dev-Server liefert die Dateien ungebündelt aus; ein Precache würde " +
      "mit dem Hot-Reload kollidieren. Zum Prüfen: npm run build && npm start.",
  },
};

/** Auswahl für das Speicher-Budget der Beleg-Dateien */
const BUDGETS = [
  { bytes: 0, label: "Keine Belege vorhalten" },
  { bytes: 100 * 1024 * 1024, label: "100 MB" },
  { bytes: 200 * 1024 * 1024, label: "200 MB" },
  { bytes: 500 * 1024 * 1024, label: "500 MB" },
  { bytes: 2 * 1024 * 1024 * 1024, label: "2 GB" },
];

export default function OfflineCard() {
  const reason = offlineUnsupportedReason();
  const { status } = useOffline();
  const [resetting, setResetting] = useState(false);

  async function resetOffline() {
    setResetting(true);
    try {
      // Erst den Worker aufräumen lassen und auf seine Bestätigung warten —
      // danach ist er abgemeldet und könnte es nicht mehr.
      await askWorker({ type: "ff:reset" });
      const registrations =
        (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(registrations.map(r => r.unregister()));
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
      toast.success("Offline-Daten verworfen — die Seite lädt neu.");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setResetting(false);
      toast.error(
        err instanceof Error ? err.message : "Zurücksetzen fehlgeschlagen."
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Offline-Betrieb
          {reason === null ? (
            <Badge variant="secondary">aktiv</Badge>
          ) : (
            <Badge variant="outline">nicht verfügbar</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Damit die App auch unterwegs — ohne Verbindung zum Heimserver —
          nutzbar bleibt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reason !== null ? (
          <div className="flex gap-3 rounded-md border border-warning/40 bg-warning/5 p-3">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">
                {UNSUPPORTED_TEXTS[reason].title}
              </p>
              <p className="text-sm text-muted-foreground">
                {UNSUPPORTED_TEXTS[reason].body}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 rounded-md border p-3">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 text-sm text-muted-foreground">
              Die App und alle Daten liegen auf diesem Gerät. Sie startet und
              rechnet auch ohne Verbindung zum Heimserver; Änderungen gehen
              raus, sobald er wieder erreichbar ist.
            </p>
          </div>
        )}

        {reason === null && status && (
          <div className="space-y-2">
            <Label htmlFor="blob-budget" className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              Belege auf diesem Gerät
            </Label>
            <div className="flex flex-wrap items-center gap-3">
              <select
                id="blob-budget"
                className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm"
                value={String(status.storage.budget)}
                onChange={e =>
                  void askWorker({
                    type: "ff:blob-budget",
                    bytes: Number(e.target.value),
                  })
                }
              >
                {BUDGETS.map(option => (
                  <option key={option.bytes} value={String(option.bytes)}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="text-sm text-muted-foreground">
                {status.storage.files === 0
                  ? "noch keine Belege gespeichert"
                  : `${status.storage.files} Dateien · ${formatBytes(status.storage.bytes)}`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Belege (Fotos und PDFs) werden im Heimnetz auf das Gerät geladen,
              bis das Budget erreicht ist — neueste zuerst. Offline erfasste
              Belege gehen unabhängig davon immer raus.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            disabled={resetting}
            onClick={resetOffline}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Offline-Daten zurücksetzen
          </Button>
          <p className="text-xs text-muted-foreground">
            Verwirft die auf diesem Gerät gespeicherte App samt lokaler Kopie
            und lädt beim nächsten Start alles neu vom Heimserver. Die Daten auf
            dem Server bleiben unberührt — noch nicht abgeglichene Änderungen
            gehen dabei allerdings verloren.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
