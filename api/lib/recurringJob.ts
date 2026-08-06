import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { recurring, transactions } from "@db/schema";
import { sendNotification } from "./notify";
import {
  advanceDate,
  localISO,
  occurrencesInRange,
} from "./recurringSchedule";
import { notifyMaturities } from "./mortgage/maturityNotice";
import { notifyNoticeDeadlines } from "./insurance/noticeReminder";

/**
 * Bucht alle fälligen wiederkehrenden Transaktionen (bis einschließlich heute).
 * Wird täglich per Cron und zusätzlich beim Serverstart ausgeführt.
 */
export async function runRecurringJob(): Promise<number> {
  const db = getDb();
  const today = localISO(new Date());
  const all = await db.select().from(recurring);
  let created = 0;

  for (const r of all) {
    if (!r.active) continue;
    // Sicherheitsgrenze: max. 500 Nachbuchungen pro Dauerbuchung.
    // Enddatum: nur Vorkommen bis einschließlich endDate werden verbucht.
    const due = occurrencesInRange(r, r.nextDate, today, 500);
    if (due.length === 0) continue;
    const next = advanceDate(due[due.length - 1], r.interval);

    // better-sqlite3 ist synchron: Transaktions-Callback darf kein Promise zurückgeben
    db.transaction((tx) => {
      for (const date of due) {
        // Idempotenz: nicht doppelt buchen (z. B. nach Race mit „Jetzt verbuchen")
        const existing = tx.select({ id: transactions.id }).from(transactions)
          .where(and(eq(transactions.recurringId, r.id), eq(transactions.date, date)))
          .all();
        if (existing.length > 0) continue;
        tx.insert(transactions).values({
          type: r.type,
          accountId: r.accountId,
          toAccountId: r.toAccountId ?? undefined,
          amount: r.amount,
          categoryId: r.categoryId ?? undefined,
          userId: r.userId,
          date,
          note: r.note,
          recurringId: r.id,
          createdAt: new Date(),
        }).run();
      }
      // nextDate steht nach dem letzten Lauf auf dem ersten Vorkommen, das
      // NICHT mehr gebucht wird — bei Enddatum ist das das erste Vorkommen
      // jenseits von endDate. Es wird nicht weiter vorgespult
      // (occurrencesInRange liefert dort ab dann eine leere Liste).
      tx.update(recurring).set({ nextDate: next }).where(eq(recurring.id, r.id)).run();
    });
    created += due.length;
  }
  if (created > 0) {
    console.log(`[Finance Fox] Cron: ${created} wiederkehrende Buchung(en) verbucht.`);
    // Sammel-Benachrichtigung (Fehler werden in sendNotification nur geloggt)
    await sendNotification(
      db,
      "recurring",
      "Wiederkehrende Buchungen verbucht",
      `${created} wiederkehrende Buchung(en) verbucht.`
    );
  }

  // Zweiter Durchgang: an ablaufende Zinsbindungen erinnern. Best effort —
  // ein Fehler hier darf die Verbuchung nicht nachträglich als Fehlschlag
  // erscheinen lassen.
  try {
    await notifyMaturities(db);
  } catch (err) {
    console.error("[Finance Fox] Hypotheken-Erinnerung fehlgeschlagen:", err);
  }

  // Dritter Durchgang: an ablaufende Kündigungsfristen erinnern — ebenfalls
  // best effort und unabhängig vom zweiten Durchgang.
  try {
    await notifyNoticeDeadlines(db);
  } catch (err) {
    console.error(
      "[Finance Fox] Versicherungs-Erinnerung fehlgeschlagen:",
      err
    );
  }
  return created;
}
