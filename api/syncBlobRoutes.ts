import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  insuranceAttachments,
  pensionAttachments,
  transactionAttachments,
} from "@db/schema";
import { getDb } from "./queries/connection";
import type { SessionUser } from "./context";
import { requireAccountAccess } from "./lib/accountAccess";
import { MAX_ATTACHMENT_BYTES } from "./lib/attachments";
import { readAttachmentFile, writeAttachmentFile } from "./lib/attachmentStore";

/**
 * Übertragung der Anhang-Dateien beim Abgleich.
 *
 * Die Metadaten der Anhänge reisen mit dem normalen Zeilen-Abgleich; die
 * Dateien selbst liegen aber außerhalb der Datenbank und brauchen einen
 * eigenen Weg. Adressiert wird über den `stored_name` — den Zufallsnamen, den
 * die Metadaten-Zeile ohnehin trägt und der auf beiden Seiten derselbe ist.
 *
 * Bewusst zwei schmale Routen statt eines tRPC-Endpunkts: Es geht um rohe
 * Bytes, genau wie bei den Upload-Routen der Anhänge selbst.
 */

const BLOB_PATH = "/api/sync/blob";

/** Findet die Metadaten-Zeile zu einem Dateinamen und prüft die Rechte */
async function authorize(
  user: SessionUser,
  storedName: string,
  level: "view" | "edit"
): Promise<boolean> {
  const db = getDb();

  const tx = await db.query.transactionAttachments.findFirst({
    where: eq(transactionAttachments.storedName, storedName),
  });
  if (tx) {
    const row = await db.query.transactions.findFirst({
      where: (t, { eq: is }) => is(t.id, tx.transactionId),
    });
    if (!row) return false;
    try {
      await requireAccountAccess(db, user, row.accountId, level);
      return true;
    } catch {
      return false;
    }
  }

  // Vorsorge-Anhänge sind strikt privat.
  const pension = await db.query.pensionAttachments.findFirst({
    where: eq(pensionAttachments.storedName, storedName),
  });
  if (pension) return pension.userId === user.id;

  // Versicherungs-Dokumente gehören dem Haushalt.
  const insurance = await db.query.insuranceAttachments.findFirst({
    where: eq(insuranceAttachments.storedName, storedName),
  });
  return Boolean(insurance);
}

/** Nur Namen, die der Server selbst vergeben hat (UUID + optionale Endung) */
function validName(name: string | undefined): name is string {
  return (
    typeof name === "string" && /^[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/i.test(name)
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyApp = Hono<any, any, any>;

export function registerSyncBlobRoutes(
  app: AnyApp,
  resolveUser: (req: Request) => Promise<SessionUser | undefined>
) {
  /** Datei eines Anhangs holen, den dieses Gerät noch nicht hat */
  app.get(BLOB_PATH, async c => {
    const user = await resolveUser(c.req.raw);
    if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
    const name = c.req.query("name");
    if (!validName(name)) return c.json({ error: "Ungültiger Name." }, 400);
    if (!(await authorize(user, name, "view"))) {
      return c.json({ error: "Anhang nicht gefunden." }, 404);
    }
    const data = readAttachmentFile(name);
    if (!data) return c.json({ error: "Datei nicht gefunden." }, 404);
    return new Response(data, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(data.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  /** Datei eines offline hochgeladenen Anhangs nachreichen */
  app.post(BLOB_PATH, async c => {
    const user = await resolveUser(c.req.raw);
    if (!user) return c.json({ error: "Nicht angemeldet." }, 401);
    const name = c.req.query("name");
    if (!validName(name)) return c.json({ error: "Ungültiger Name." }, 400);
    if (!(await authorize(user, name, "edit"))) {
      return c.json({ error: "Anhang nicht gefunden." }, 404);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) {
      return c.json({ error: "Die Datei ist leer." }, 400);
    }
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "Die Datei ist zu groß (maximal 10 MB)." }, 413);
    }
    // Schon vorhandene Dateien nicht überschreiben: Der Name ist eindeutig,
    // ein zweiter Upload wäre entweder eine Wiederholung oder ein Fehler.
    if (!readAttachmentFile(name)) writeAttachmentFile(name, bytes);
    return c.json({ ok: true });
  });
}
