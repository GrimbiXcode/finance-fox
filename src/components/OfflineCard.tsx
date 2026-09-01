import { useState } from "react";
import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
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
import {
  offlineUnsupportedReason,
  type OfflineUnsupportedReason,
} from "@/lib/serviceWorker";

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

export default function OfflineCard() {
  const reason = offlineUnsupportedReason();
  const [resetting, setResetting] = useState(false);

  async function resetOffline() {
    setResetting(true);
    try {
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
          <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
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
              Die App ist auf diesem Gerät gespeichert und startet auch ohne
              Verbindung zum Heimserver.
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
            Verwirft die auf diesem Gerät gespeicherte App und lädt sie beim
            nächsten Start neu vom Heimserver. Die Daten auf dem Server bleiben
            unberührt.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
