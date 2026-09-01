import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import { appRouter } from "../../api/router";
import { users } from "@db/schema";
import type { SessionUser, TrpcContext } from "../../api/context";
import {
  TRPC_LIVE_PATH,
  TRPC_LOCAL_PATH,
  isOnlineOnlyProcedure,
} from "@contracts/offline";
import { flushDatabase, getDb } from "./db/connection";
import { flushAttachmentWrites } from "./shims/attachmentStore";
import { isBootstrapped, loadIdentity } from "./state";

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
 * Beantwortet die Anfrage lokal — oder liefert `null`, wenn sie ans Netz
 * gehört. Ans Netz gehen: die `live`-Leitung, alles, was nur im Heimnetz
 * funktioniert, und alles vor dem ersten vollständigen Abgleich.
 */
export async function handleApiRequest(
  request: Request
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${TRPC_LOCAL_PATH}/`)) return null;
  if (url.pathname.startsWith(`${TRPC_LIVE_PATH}/`)) return null;

  // Vor dem ersten Abgleich ist die Replik leer. Würde sie jetzt antworten,
  // schlösse die App aus der leeren Benutzertabelle auf eine nötige
  // Ersteinrichtung — deshalb bleibt bis dahin alles beim Server.
  if (!(await isBootstrapped())) return null;

  const identity = await loadIdentity();
  if (!identity) return null;

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
 * Wird jemand im Heimnetz zum Administrator gemacht, gilt das nach dem
 * nächsten Abgleich auch offline.
 */
async function resolveUser(identity: SessionUser): Promise<SessionUser> {
  try {
    const row = await getDb().query.users.findFirst({
      where: eq(users.id, identity.id),
    });
    if (!row || !row.active) return identity;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      color: row.color,
    };
  } catch {
    return identity;
  }
}
