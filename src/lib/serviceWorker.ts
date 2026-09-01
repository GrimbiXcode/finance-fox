import { toast } from "sonner";
import type {
  PageToWorkerMessage,
  SyncReason,
  WorkerToPageMessage,
} from "@contracts/offline";

/**
 * Anbindung der Seite an den Service Worker: Registrierung, Update-Fluss und
 * die Nachrichtenbrücke zur lokalen Replik.
 *
 * Der Worker wird ausschließlich im Produktions-Build registriert — im
 * Dev-Server würde sein Precache mit Vites HMR kollidieren. Offline prüfen
 * heißt deshalb: `npm run build && npm start`.
 */

/** Warum steht der Offline-Betrieb auf diesem Gerät nicht zur Verfügung? */
export type OfflineUnsupportedReason =
  /** Kein HTTPS (und nicht localhost) — Browser verbieten Service Worker */
  | "insecure-context"
  /** Browser kann keine Service Worker (sehr alt oder privates Fenster) */
  | "no-service-worker"
  /** Dev-Server: bewusst abgeschaltet */
  | "development";

/**
 * Prüft, ob der Offline-Betrieb hier überhaupt möglich ist.
 * `null` heißt: alles in Ordnung.
 */
export function offlineUnsupportedReason(): OfflineUnsupportedReason | null {
  if (!("serviceWorker" in navigator)) return "no-service-worker";
  if (!window.isSecureContext) return "insecure-context";
  if (!import.meta.env.PROD) return "development";
  return null;
}

type Listener = (message: WorkerToPageMessage) => void;

const listeners = new Set<Listener>();
let registration: ServiceWorkerRegistration | undefined;
let reloading = false;

/** Auf Nachrichten des Service Workers hören; gibt die Abmeldung zurück */
export function onWorkerMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Nachricht an den aktiven Service Worker (still, wenn keiner läuft) */
export async function postToWorker(message: PageToWorkerMessage): Promise<void> {
  if (offlineUnsupportedReason() !== null) return;
  // `ready` statt `controller`: Direkt nach der Registrierung kontrolliert der
  // Worker die bereits geladene Seite noch nicht, ist aber schon aktiv.
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage(message);
}

/**
 * Nachricht mit Antwort. Wird gebraucht, wo die Seite auf das Ergebnis warten
 * muss — etwa beim Zurücksetzen, bevor sie den Worker abmeldet.
 */
export async function askWorker(
  message: PageToWorkerMessage,
  timeoutMs = 5000
): Promise<WorkerToPageMessage | null> {
  if (offlineUnsupportedReason() !== null) return null;
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) return null;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = event => {
      window.clearTimeout(timer);
      resolve(event.data as WorkerToPageMessage);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

/** Abgleich anstoßen (App-Start, Fokus, Intervall, Knopfdruck) */
export function syncNow(reason: SyncReason): void {
  void postToWorker({ type: "ff:sync", reason });
}

/**
 * Service Worker registrieren und den Update-Fluss aufsetzen.
 * Mehrfachaufrufe sind unschädlich.
 */
export async function registerServiceWorker(): Promise<void> {
  if (offlineUnsupportedReason() !== null) return;

  navigator.serviceWorker.addEventListener("message", event => {
    const message = event.data as WorkerToPageMessage | undefined;
    if (!message || typeof message.type !== "string") return;
    for (const listener of listeners) listener(message);
  });

  // Nach `skipWaiting()` übernimmt der neue Worker — dann muss die Seite neu
  // laden, damit sie zu den frisch gecachten Dateien passt.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
  } catch (err) {
    console.error("[Finance Fox] Service Worker nicht registrierbar:", err);
    return;
  }

  if (registration.waiting) announceUpdate(registration.waiting);

  registration.addEventListener("updatefound", () => {
    const installing = registration?.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // `controller` ist null, solange die App zum ersten Mal installiert
      // wird — dann gibt es nichts anzukündigen, der Worker ist einfach da.
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        announceUpdate(installing);
      }
    });
  });

  // Im Heimnetz holt sich die App die neueste Version von sich selbst: beim
  // Start und jedes Mal, wenn sie wieder in den Vordergrund kommt.
  void checkForUpdate();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
}

/** Auf eine neue Version prüfen (still, wenn der Server nicht erreichbar ist) */
export async function checkForUpdate(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    // Ohne Verbindung zum Heimserver gibt es nichts zu prüfen.
  }
}

let updateAnnounced = false;

function announceUpdate(worker: ServiceWorker) {
  if (updateAnnounced) return;
  updateAnnounced = true;
  toast.info("Neue Version verfügbar", {
    description: "Die App lädt sie beim Neustart — oder gleich jetzt.",
    duration: Infinity,
    action: {
      label: "Jetzt laden",
      onClick: () => worker.postMessage({ type: "ff:skip-waiting" }),
    },
  });
}
