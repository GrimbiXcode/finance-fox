/**
 * Service Worker von Finance Fox.
 *
 * Aufgabe in dieser Ausbaustufe: die App-Shell vorhalten, damit die App auch
 * ohne Verbindung zum Heimserver startet. Gebaut wird die Datei mit esbuild
 * (`scripts/build-sw.mjs`) nach `dist/public/sw.js` — die Liste der zu
 * cachenden Dateien und die Build-Kennung kommen dabei als `define` herein,
 * gehören also untrennbar zu genau dieser Worker-Version.
 *
 * Registriert wird der Worker nur im Produktions-Build und nur in einem
 * „secure context" (siehe `src/lib/serviceWorker.ts`).
 */

import type {
  PageToWorkerMessage,
  WorkerToPageMessage,
} from "@contracts/offline";

declare const self: ServiceWorkerGlobalScope;

/** Von esbuild eingesetzt: Kennung dieses Builds (Hash über alle Dateien) */
declare const __FF_BUILD_ID__: string;
/** Von esbuild eingesetzt: alle Pfade, die offline verfügbar sein müssen */
declare const __FF_PRECACHE__: string[];

const CACHE_NAME = `ff-shell-${__FF_BUILD_ID__}`;

/**
 * Die App benutzt einen HashRouter — es gibt genau einen echten Pfad. Jede
 * Navigation wird deshalb aus derselben `index.html` bedient.
 */
const APP_SHELL = "/index.html";

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // `reload` umgeht den HTTP-Cache: sonst landen unter Umständen alte
      // Antworten im Precache und die App startet offline mit Altbestand.
      await cache.addAll(
        __FF_PRECACHE__.map(url => new Request(url, { cache: "reload" }))
      );
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(name => name.startsWith("ff-shell-") && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
      // Ohne `claim()` würde der Worker die bereits offene Seite erst beim
      // nächsten Laden kontrollieren — der erste Start bliebe ohne Offline.
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Die API bleibt vorerst unangetastet — sie bekommt in der nächsten
  // Ausbaustufe einen eigenen, lokalen Router.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(serveAppShell(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

/** Navigation: immer die gecachte Shell, damit die App offline startet */
async function serveAppShell(request: Request): Promise<Response> {
  const cached = await caches.match(APP_SHELL);
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    return new Response(
      "Finance Fox ist offline und wurde auf diesem Gerät noch nicht geladen.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

/**
 * Statische Dateien: erst der Cache, sonst das Netz (und das Ergebnis in den
 * Cache, damit z. B. nachgeladene Chunks beim nächsten Mal offline da sind).
 */
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

self.addEventListener("message", event => {
  const message = event.data as PageToWorkerMessage | undefined;
  if (!message || typeof message.type !== "string") return;

  if (message.type === "ff:skip-waiting") {
    void self.skipWaiting();
    return;
  }
  if (message.type === "ff:status?") {
    reply(event, {
      type: "ff:status",
      status: {
        offline: "bootstrapping",
        reachable: true,
        syncing: false,
        lastSyncAt: null,
        pending: 0,
        conflicts: 0,
        error: null,
      },
    });
  }
});

function reply(event: ExtendableMessageEvent, message: WorkerToPageMessage) {
  const source = event.source;
  if (source && "postMessage" in source) {
    (source as Client).postMessage(message);
  }
}
