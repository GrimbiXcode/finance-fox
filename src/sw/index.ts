/**
 * Service Worker von Finance Fox.
 *
 * Zwei Aufgaben:
 *
 * 1. **App-Shell vorhalten**, damit die App auch ohne Verbindung zum
 *    Heimserver startet.
 * 2. **Die API lokal beantworten** — mit demselben tRPC-Router, der sonst auf
 *    dem Server läuft, gegen eine SQLite-Replik im Browser. Die Seite merkt
 *    davon nichts: Sie spricht wie bisher `/api/trpc`.
 *
 * Gebaut wird die Datei mit esbuild (`scripts/build-sw.mjs`) nach
 * `dist/public/sw.js`; die Liste der zu cachenden Dateien und die Build-Kennung
 * kommen dabei als `define` herein und gehören damit untrennbar zu genau dieser
 * Worker-Version. Registriert wird der Worker nur im Produktions-Build und nur
 * in einem „secure context" (siehe `src/lib/serviceWorker.ts`).
 */

import type {
  PageToWorkerMessage,
  WorkerToPageMessage,
} from "@contracts/offline";
import { TRPC_LOCAL_PATH } from "@contracts/offline";
import { handleApiRequest } from "../offline/localApi";
import {
  currentStatus,
  requestSync,
  resetReplica,
} from "../offline/sync/engine";
import { saveIdentity } from "../offline/state";
import { idbClearAll } from "../offline/db/idb";

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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApi(event, request));
    return;
  }

  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(serveAppShell(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

/* ────────────────────────────── API ──────────────────────────────────────── */

async function handleApi(
  event: FetchEvent,
  request: Request
): Promise<Response> {
  try {
    const local = await handleApiRequest(request);
    if (local) {
      if (request.method !== "GET") event.waitUntil(afterLocalMutation());
      return local;
    }
  } catch (err) {
    console.error("[Finance Fox] Lokale API:", err);
    // Bei einer Mutation nicht aufs Netz ausweichen: Sie könnte lokal bereits
    // ganz oder teilweise gelaufen sein, und ein zweiter Durchlauf auf dem
    // Server würde sie verdoppeln.
    if (request.method !== "GET") {
      return offlineResponse(
        request,
        "Die Änderung konnte auf diesem Gerät nicht gespeichert werden."
      );
    }
  }

  try {
    return await fetch(request);
  } catch {
    return offlineResponse(
      request,
      "Diese Funktion ist nur im Heimnetz verfügbar."
    );
  }
}

/** Nach einer lokalen Änderung: gleich abgleichen und die Seite informieren */
async function afterLocalMutation() {
  await notifyClients({ type: "ff:data-changed" });
  const changed = await requestSync("mutation");
  if (changed) await notifyClients({ type: "ff:data-changed" });
  await broadcastStatus();
}

/**
 * Fehlerantwort im Format, das der tRPC-Client versteht — sonst käme beim
 * Benutzer statt der deutschen Erklärung ein Parser-Fehler an.
 */
function offlineResponse(request: Request, message: string): Response {
  const url = new URL(request.url);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  if (!url.pathname.startsWith(`${TRPC_LOCAL_PATH}/`)) {
    return new Response(JSON.stringify({ error: message }), {
      status: 503,
      headers,
    });
  }
  const envelope = {
    error: {
      json: {
        message,
        code: -32003,
        data: { code: "PRECONDITION_FAILED", httpStatus: 503 },
      },
    },
  };
  const batched = url.searchParams.get("batch") === "1";
  const count = url.pathname
    .slice(TRPC_LOCAL_PATH.length + 1)
    .split(",").length;
  const body = batched
    ? JSON.stringify(Array.from({ length: count }, () => envelope))
    : JSON.stringify(envelope);
  return new Response(body, { status: 503, headers });
}

/* ─────────────────────────── Statische Dateien ───────────────────────────── */

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

/* ──────────────────────────── Nachrichten ────────────────────────────────── */

self.addEventListener("message", event => {
  const message = event.data as PageToWorkerMessage | undefined;
  if (!message || typeof message.type !== "string") return;

  switch (message.type) {
    case "ff:skip-waiting":
      void self.skipWaiting();
      return;

    case "ff:identity":
      event.waitUntil(
        (async () => {
          await saveIdentity(message.user);
          if (message.user) await runSync("start");
          await broadcastStatus();
        })()
      );
      return;

    case "ff:sync":
      event.waitUntil(runSync(message.reason).then(broadcastStatus));
      return;

    case "ff:status?":
      event.waitUntil(
        currentStatus().then(status =>
          reply(event, { type: "ff:status", status })
        )
      );
      return;

    case "ff:reset":
      event.waitUntil(
        (async () => {
          await resetReplica();
          await idbClearAll();
          // Antwort abwarten lassen: Die Seite meldet den Worker gleich danach
          // ab, und ein halb aufgeräumter Zustand wäre schlimmer als keiner.
          reply(event, { type: "ff:status", status: await currentStatus() });
          await broadcastStatus();
        })()
      );
      return;
  }
});

async function runSync(reason: Parameters<typeof requestSync>[0]) {
  const changed = await requestSync(reason);
  if (changed) await notifyClients({ type: "ff:data-changed" });
}

async function notifyClients(message: WorkerToPageMessage) {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.postMessage(message);
}

async function broadcastStatus() {
  await notifyClients({ type: "ff:status", status: await currentStatus() });
}

function reply(event: ExtendableMessageEvent, message: WorkerToPageMessage) {
  // Fragt die Seite über einen MessageChannel, geht die Antwort dorthin
  // zurück — nur so kann sie gezielt darauf warten.
  const port = event.ports[0];
  if (port) {
    port.postMessage(message);
    return;
  }
  const source = event.source;
  if (source && "postMessage" in source) {
    (source as Client).postMessage(message);
  }
}
