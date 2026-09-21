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
 *
 * **Update-Fluss.** Ob ein frisch installierter Worker wirklich eine neue
 * Version ist, entscheidet nicht der Browser, sondern der Vergleich der
 * Build-Kennungen (`ff:version?`). Der Browser installiert `sw.js` nämlich
 * auch dann neu, wenn sich am Inhalt nichts geändert hat: Safari/iOS hält
 * beim Update-Check neben den Bytes auch die TLS-Zertifikatskette gegen die
 * des installierten Workers — und die wechselt im Heimnetz laufend, weil
 * Caddys interne CA kurzlebige Zertifikate ausstellt (bei Let's Encrypt
 * immerhin alle paar Wochen). Ohne den Vergleich stünde nach jedem Wechsel
 * „Neue Version verfügbar" auf dem Bildschirm, obwohl es keine gibt.
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
/**
 * Build-Kennung des Workers, der die Seite gerade bedient. `null`, wenn
 * keiner sie bedient (Erstinstallation) oder er die Frage nicht beantwortet
 * (Worker einer Version vor `ff:version?`) — dann gilt jeder neue Worker als
 * neue Version, so wie vorher auch.
 */
let currentBuild: Promise<string | null> = Promise.resolve(null);
let reloading = false;

/** Auf Nachrichten des Service Workers hören; gibt die Abmeldung zurück */
export function onWorkerMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Nachricht an den aktiven Service Worker (still, wenn keiner läuft) */
export async function postToWorker(
  message: PageToWorkerMessage
): Promise<void> {
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
  return ask(worker, message, timeoutMs);
}

/**
 * Frage an einen bestimmten Worker — auch an einen, der noch wartet. Ohne
 * Antwort innerhalb der Frist (oder wenn der Worker schon ausgemustert ist)
 * kommt `null` zurück.
 */
function ask(
  worker: ServiceWorker,
  message: PageToWorkerMessage,
  timeoutMs: number
): Promise<WorkerToPageMessage | null> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = event => {
      window.clearTimeout(timer);
      resolve(event.data as WorkerToPageMessage);
    };
    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Build-Kennung eines Workers; `null`, wenn er sie nicht nennt */
async function askVersion(worker: ServiceWorker): Promise<string | null> {
  const reply = await ask(worker, { type: "ff:version?" }, 5000);
  return reply?.type === "ff:version" ? reply.buildId : null;
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

  void requestPersistentStorage();

  navigator.serviceWorker.addEventListener("message", event => {
    const message = event.data as WorkerToPageMessage | undefined;
    if (!message || typeof message.type !== "string") return;
    for (const listener of listeners) listener(message);
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    void onControllerChange();
  });

  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
  } catch (err) {
    console.error("[Finance Fox] Service Worker nicht registrierbar:", err);
    return;
  }

  // Gegen diese Kennung wird jeder neu installierte Worker gehalten.
  currentBuild = registration.active
    ? askVersion(registration.active)
    : Promise.resolve(null);

  // Ein Worker aus einer früheren Sitzung wartet noch — etwa weil die App in
  // einem zweiten Tab offen blieb oder nur in den Hintergrund ging.
  if (registration.waiting) void handleNewWorker(registration.waiting);

  registration.addEventListener("updatefound", () => {
    const installing = registration?.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // `controller` ist null, solange die App zum ersten Mal installiert
      // wird — dann gibt es nichts zu übernehmen, der Worker ist einfach da.
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        void handleNewWorker(installing);
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

let persistenceAsked = false;

/**
 * Dauerhaften Speicher anfordern.
 *
 * Ohne diese Zusage liegt alles, was die App im Browser hält, im
 * „aufräumbaren" Topf: die SQLite-Replik **und** die Anhang-Dateien, die noch
 * auf den Heimserver warten. iOS löscht diesen Topf bei Platzmangel und
 * ohnehin nach sieben Tagen ohne Benutzung — gerade eine installierte App am
 * Homescreen trifft das, weil sie tagelang unbenutzt bleibt. Ein hochgeladener
 * Beleg wäre dann verschwunden, bevor er je beim Heimserver ankam.
 *
 * Für installierte Web-Apps gewähren Safari und Chrome die Zusage; wird sie
 * abgelehnt, läuft alles wie bisher weiter — nur eben angreifbar durch das
 * Aufräumen, weshalb der Grund im Protokoll landet.
 */
async function requestPersistentStorage(): Promise<void> {
  if (persistenceAsked || !navigator.storage?.persist) return;
  persistenceAsked = true;
  try {
    if (await navigator.storage.persisted()) return;
    const granted = await navigator.storage.persist();
    if (!granted) {
      console.warn(
        "[Finance Fox] Kein dauerhafter Speicher zugesagt — der Browser darf " +
          "die lokale Kopie samt noch nicht übertragener Belege aufräumen."
      );
    }
  } catch (err) {
    console.warn("[Finance Fox] Dauerhafter Speicher nicht anforderbar:", err);
  }
}

/** Auf eine neue Version prüfen (still, wenn der Server nicht erreichbar ist) */
export async function checkForUpdate(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    // Ohne Verbindung zum Heimserver gibt es nichts zu prüfen.
  }
}

/**
 * Ein frisch installierter Worker wartet auf die Übernahme.
 *
 * Ist es derselbe Build wie der laufende, gibt es nichts anzukündigen: Der
 * Browser hat den Worker nur neu installiert (siehe Kopf der Datei). Dann
 * darf er still übernehmen — die Seite passt weiter zu den gecachten Dateien
 * und lädt nicht neu (siehe `onControllerChange`). Alles andere ist eine neue
 * Version: ankündigen und dem Benutzer überlassen, wann sie geladen wird,
 * damit ihm kein Neuladen in die Eingabe fährt.
 */
async function handleNewWorker(worker: ServiceWorker): Promise<void> {
  const [current, next] = await Promise.all([currentBuild, askVersion(worker)]);
  if (next !== null && next === current) {
    takeOver(worker);
    return;
  }
  announceUpdate(worker);
}

/**
 * Wartenden Worker übernehmen lassen. Der Browser wechselt, sobald der
 * laufende Worker keine Ereignisse mehr offen hat; was dann zu tun ist,
 * entscheidet `onControllerChange`.
 */
function takeOver(worker: ServiceWorker) {
  const message: PageToWorkerMessage = { type: "ff:skip-waiting" };
  try {
    worker.postMessage(message);
  } catch {
    // Schon ausgemustert — dann hat ihn ein noch neuerer Worker abgelöst.
  }
}

/**
 * Ein anderer Worker bedient jetzt die Seite. Ist es ein anderer Build, muss
 * sie neu laden, damit sie zu den frisch gecachten Dateien passt. Beim
 * gleichen Build (stille Übernahme, auch aus einem anderen Tab heraus) läuft
 * sie einfach weiter.
 */
async function onControllerChange(): Promise<void> {
  const previous = currentBuild;
  const controller = navigator.serviceWorker.controller;
  currentBuild = controller ? askVersion(controller) : Promise.resolve(null);
  const [before, after] = await Promise.all([previous, currentBuild]);
  if (after !== null && after === before) return;
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

let updateAnnounced = false;

function announceUpdate(worker: ServiceWorker) {
  if (updateAnnounced) return;
  updateAnnounced = true;
  toast.info("Neue Version verfügbar", {
    description: "Die App lädt sie beim Neustart — oder gleich jetzt.",
    duration: Infinity,
    action: {
      // Falls inzwischen ein noch neuerer Worker wartet, den nehmen — der
      // angekündigte wäre dann bereits ausgemustert.
      label: "Jetzt laden",
      onClick: () => takeOver(registration?.waiting ?? worker),
    },
  });
}
