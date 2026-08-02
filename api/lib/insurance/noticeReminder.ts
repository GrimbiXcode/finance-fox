import { eq } from "drizzle-orm";
import { appSettings, insurancePolicies } from "@db/schema";
import { INSURANCE_BRANCH_LABELS } from "@contracts/insurance";
import type { Db } from "../../queries/connection";
import { sendNotification } from "../notify";
import { localISO } from "../recurringSchedule";
import { computeNotice } from "./notice";

/**
 * Erinnerung an ablaufende Kündigungsfristen — der Termin, an dem man bei
 * einer Versicherung tatsächlich handeln muss. Wer ihn verpasst, hängt ein
 * weiteres Jahr im Vertrag.
 *
 * Läuft im täglichen Cron. Gemeldet wird bei 90 und 30 Tagen Restfrist; ein
 * Marker in `app_settings` verhindert die tägliche Wiederholung.
 */

/** Schwellen in Tagen bis `cancelBy`, absteigend */
const THRESHOLDS = [90, 30];
const MARKER_KEY = "insurance_notice_notified";

/**
 * Marker-Format `"<policyId>:<cancelByISO>:<threshold>"`.
 *
 * Das Datum gehört zwingend hinein: Anders als eine Zinsbindung, die genau
 * einmal abläuft (`mortgage/maturityNotice.ts` kommt deshalb mit
 * `"<id>:<schwelle>"` aus), wiederholt sich ein Hauptverfall jährlich. Ohne
 * den Datumsteil würde die Erinnerung pro Police genau **einmal in ihrem
 * Leben** feuern.
 */
function markerFor(policyId: number, cancelBy: string, days: number): string {
  return `${policyId}:${cancelBy}:${days}`;
}

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
 * Prüft alle Policen mit erreichbarer Kündigungsfrist und meldet neu
 * erreichte Schwellen. Liefert die Anzahl versendeter Meldungen (best
 * effort — Versandfehler bricht den Cron-Lauf nicht).
 */
export async function notifyNoticeDeadlines(
  db: Db,
  now: Date = new Date()
): Promise<number> {
  const today = localISO(now);
  const policies = await db.select().from(insurancePolicies);
  if (policies.length === 0) return 0;

  const markers = await readMarkers(db);
  /** Aktuell gültige Marker — alles andere wird am Ende aufgeräumt */
  const live = new Set<string>();
  let sent = 0;

  for (const p of policies) {
    // Angebote, abgelaufene und gekündigte Policen liefern hier kein cancelBy
    const notice = computeNotice(p, today);
    if (notice.cancelBy === null || notice.daysUntilCancel === null) continue;
    const days = notice.daysUntilCancel;
    if (days < 0) continue;

    // Alle noch gültigen Marker dieser Police merken, damit ein zweiter Lauf
    // am selben Tag nicht erneut meldet
    for (const t of THRESHOLDS) {
      live.add(markerFor(p.id, notice.cancelBy, t));
    }

    // Die kleinste erreichte Schwelle ist die aussagekräftigste
    const hit = THRESHOLDS.filter(d => days <= d).sort((a, b) => a - b)[0];
    if (hit === undefined) continue;
    const marker = markerFor(p.id, notice.cancelBy, hit);
    if (markers.has(marker)) continue;

    markers.add(marker);
    await sendNotification(
      db,
      "insurance",
      "Kündigungsfrist läuft ab",
      `Die Police „${p.name}“ (${INSURANCE_BRANCH_LABELS[p.branch]}) muss bis zum ${notice.cancelBy} gekündigt werden (in ${days} Tagen), sonst verlängert sie sich.`
    );
    sent += 1;
  }

  // Marker gelöschter Policen und vergangener Perioden aufräumen, damit die
  // Liste nicht unbegrenzt wächst
  for (const m of [...markers]) {
    if (!live.has(m)) markers.delete(m);
  }
  await writeMarkers(db, markers);
  return sent;
}
