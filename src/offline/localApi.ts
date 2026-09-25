import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import { appRouter } from "../../api/router";
import { registerAttachmentRoutes } from "../../api/attachmentRoutes";
import { users } from "@db/schema";
import type { SessionUser, TrpcContext } from "../../api/context";
import {
  TRPC_LIVE_PATH,
  TRPC_LOCAL_PATH,
  isOnlineOnlyProcedure,
} from "@contracts/offline";
import { flushDatabase, getDb } from "./db/connection";
import {
  flushAttachmentWrites,
  readAttachmentBlob,
} from "./shims/attachmentStore";
import { isBootstrapped, loadIdentity } from "./state";
import { ensureDatabase } from "./sync/engine";

/**
 * Die lokale API: derselbe tRPC-Router wie auf dem Heimserver, nur gegen die
 * Replik im Browser.
 *
 * Genau das ist der Kern des Offline-Betriebs — die App bekommt nicht bloß
 * zwischengespeicherte Antworten, sondern **rechnet** offline weiter:
 * Prognosen, AHV-Rente, Hypotheken-Tilgungspläne und die Versicherungs-
 * Lückenanalyse laufen im selben Code, der sonst auf dem Server läuft.
 *
 * Die Identität kommt nicht aus dem Cookie (das kann ein Service Worker nicht
 * lesen), sondern von der Seite und liegt in IndexedDB.
 */

/**
 * Die binären Anhang-Routen, gebaut aus demselben Code wie auf dem Server
 * (`api/attachmentRoutes.ts`) — nur mit lokaler Identität und den Dateien aus
 * IndexedDB. Damit sind Belege offline ansehbar, und offline hochgeladene
 * warten in der Warteschlange auf das Heimnetz.
 */
const attachmentApp = new Hono();
registerAttachmentRoutes(attachmentApp, {
  resolveUser: async () => {
    const identity = await loadIdentity();
    return identity ? await resolveUser(identity) : undefined;
  },
  readFile: readAttachmentBlob,
});

/** Pfade, die der lokale Anhang-Router beantwortet */
const ATTACHMENT_PREFIXES = [
  "/api/attachments",
  "/api/pension-attachments",
  "/api/insurance-attachments",
];

/**
 * Beantwortet die Anfrage lokal — oder liefert `null`, wenn sie ans Netz
 * gehört. Ans Netz gehen: die `live`-Leitung, alles, was nur im Heimnetz
 * funktioniert, und alles vor dem ersten vollständigen Abgleich.
 */
export async function handleApiRequest(
  request: Request
): Promise<Response | null> {
  const url = new URL(request.url);
  const isAttachment = ATTACHMENT_PREFIXES.some(
    prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
  );
  if (!isAttachment) {
    if (!url.pathname.startsWith(`${TRPC_LOCAL_PATH}/`)) return null;
    if (url.pathname.startsWith(`${TRPC_LIVE_PATH}/`)) return null;
  }

  // Vor dem ersten Abgleich ist die Replik leer. Würde sie jetzt antworten,
  // schlösse die App aus der leeren Benutzertabelle auf eine nötige
  // Ersteinrichtung — deshalb bleibt bis dahin alles beim Server.
  if (!(await isBootstrapped())) return null;

  const identity = await loadIdentity();
  if (!identity) return null;

  // Erst jetzt die Replik öffnen — und zwar hier, nicht erst im Abgleich: Der
  // Browser beendet einen untätigen Worker jederzeit, und nach dem nächsten
  // Start kommt `auth.me` an, bevor die Seite überhaupt einen Abgleich
  // anstoßen kann (sie wartet ja auf genau diese Antwort). Schlägt das Öffnen
  // fehl, geht die Anfrage ans Netz (siehe `handleApi` in `sw/index.ts`).
  await ensureDatabase();

  if (isAttachment) {
    const response = await attachmentApp.fetch(request);
    if (request.method !== "GET") {
      // Reihenfolge mit Absicht: erst die Datei, dann die Datenbank. Wirft das
      // Schreiben der Datei (kein Platz, Speicher gesperrt), bleibt die
      // Metadaten-Zeile ungesichert und der Aufrufer bekommt einen Fehler —
      // besser als ein „Beleg hochgeladen", hinter dem keine Datei steckt.
      await flushAttachmentWrites();
      await flushDatabase();
    }
    return withNoStore(response);
  }

  // Sicherheitsnetz: Prozeduren aus der Heimnetz-Liste beantwortet der Worker
  // nie. Die App schickt sie ohnehin über /api/trpc/live — käme eine doch
  // hier an, wäre eine falsche Antwort schlimmer als gar keine.
  if (procedurePaths(url).some(isOnlineOnlyProcedure)) return null;

  const user = await resolveUser(identity);
  const response = await fetchRequestHandler({
    endpoint: TRPC_LOCAL_PATH,
    req: request,
    router: appRouter,
    createContext: ({ resHeaders }): TrpcContext => ({
      req: request,
      resHeaders,
      user,
    }),
  });

  // Eine Mutation muss auf der Platte sein, bevor wir antworten: Ein Service
  // Worker darf unmittelbar danach beendet werden, und eine verlorene
  // Schreiboperation wäre eine verlorene Buchung.
  if (request.method !== "GET") {
    await flushAttachmentWrites();
    await flushDatabase();
  }

  return withNoStore(response);
}

/** Lokale Antworten gehören nie in den HTTP-Cache des Browsers */
function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Prozedurnamen einer Anfrage — bei Batches können es mehrere sein */
function procedurePaths(url: URL): string[] {
  const path = url.pathname.slice(TRPC_LOCAL_PATH.length + 1);
  return path.split(",").filter(Boolean);
}

/**
 * Rolle und Name kommen aus der Replik, nicht aus der gespeicherten Kopie:
 * Wird jemand im Heimnetz zum Administrator gemacht — oder deaktiviert —,
 * gilt das nach dem nächsten Abgleich auch offline.
 *
 * `undefined` heißt: kein angemeldeter Benutzer. Der Router antwortet dann
 * wie auf dem Server mit „Nicht angemeldet", und `auth.me` liefert null —
 * die App führt zur Anmeldung.
 */
async function resolveUser(
  identity: SessionUser
): Promise<SessionUser | undefined> {
  let row;
  try {
    row = await getDb().query.users.findFirst({
      where: eq(users.id, identity.id),
    });
  } catch {
    // Replik (noch) nicht lesbar — mit der gespeicherten Identität weiter.
    return identity;
  }
  // Die Zeile ist da und sagt „deaktiviert": Dann gilt das auch hier. Auf die
  // zwischengespeicherte Identität zurückzufallen hieße, dass ein entzogener
  // Zugang offline weiterläuft — womöglich noch mit der alten Rolle.
  if (row && !row.active) return undefined;
  if (!row) return identity;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    color: row.color,
  };
}
