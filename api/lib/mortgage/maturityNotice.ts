import { eq } from "drizzle-orm";
import { appSettings, mortgageTranches } from "@db/schema";
import type { Db } from "../../queries/connection";
import { sendNotification } from "../notify";
import { localISO } from "../recurringSchedule";

/**
 * Erinnerung an ablaufende Zinsbindungen — der wichtigste Termin einer
 * Hypothek: Wer zu spät verhandelt, zahlt die (teure) variable Hypothek.
 *
 * Läuft im täglichen Cron. Gemeldet wird bei 90 und 30 Tagen Restlaufzeit;
 * ein Marker in `app_settings` verhindert, dass dieselbe Schwelle täglich
 * erneut feuert.
 */

/** Schwellen in Tagen, absteigend */
const THRESHOLDS = [90, 30];
const MARKER_KEY = "mortgage_maturity_notified";

/** Tage zwischen zwei ISO-Daten (positiv = to liegt in der Zukunft) */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Bereits gemeldete „<trancheId>:<schwelle>"-Kombinationen */
async function readMarkers(db: Db): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, MARKER_KEY));
  if (rows.length === 0) return new Set();
  try {
    return new Set(JSON.parse(rows[0].value) as string[]);
  } catch {
    return new Set();
  }
}

async function writeMarkers(db: Db, markers: Set<string>): Promise<void> {
  const value = JSON.stringify([...markers]);
  const existing = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, MARKER_KEY));
  if (existing.length > 0) {
    await db
      .update(appSettings)
      .set({ value })
      .where(eq(appSettings.key, MARKER_KEY));
  } else {
    await db.insert(appSettings).values({ key: MARKER_KEY, value });
  }
}

/**
 * Prüft alle Tranchen mit Ablaufdatum und meldet neu erreichte Schwellen.
 * Liefert die Anzahl versendeter Meldungen (best effort — Versandfehler
 * bricht den Cron-Lauf nicht).
 */
export async function notifyMaturities(
  db: Db,
  now: Date = new Date()
): Promise<number> {
  const today = localISO(now);
  const tranches = await db.select().from(mortgageTranches);
  const due = tranches.filter(t => t.maturityDate !== null);
  if (due.length === 0) return 0;

  const markers = await readMarkers(db);
  let sent = 0;

  for (const t of due) {
    const days = daysBetween(today, t.maturityDate!);
    // Die kleinste erreichte Schwelle ist die aussagekräftigste
    const hit = THRESHOLDS.filter(d => days <= d && days >= 0).sort(
      (a, b) => a - b
    )[0];
    if (hit === undefined) continue;
    const marker = `${t.id}:${hit}`;
    if (markers.has(marker)) continue;

    markers.add(marker);
    await sendNotification(
      db,
      "mortgage",
      "Zinsbindung läuft ab",
      `Die Zinsbindung der Tranche „${t.name}" endet am ${t.maturityDate} (in ${days} Tagen). Jetzt Konditionen verhandeln.`
    );
    sent += 1;
  }

  // Marker abgelaufener/gelöschter Tranchen aufräumen, damit die Liste
  // nicht unbegrenzt wächst
  const liveIds = new Set(due.map(t => String(t.id)));
  for (const m of [...markers]) {
    if (!liveIds.has(m.split(":")[0])) markers.delete(m);
  }
  await writeMarkers(db, markers);
  return sent;
}
