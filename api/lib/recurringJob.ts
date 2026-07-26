import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { recurring, transactions } from "@db/schema";

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function advanceDate(dateISO: string, interval: "weekly" | "monthly" | "yearly"): string {
  const d = new Date(`${dateISO}T12:00:00`);
  if (interval === "weekly") d.setDate(d.getDate() + 7);
  else if (interval === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return localISO(d);
}

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
    let next = r.nextDate;
    const due: string[] = [];
    // Sicherheitsgrenze: max. 500 Nachbuchungen pro Dauerbuchung
    while (next <= today && due.length < 500) {
      due.push(next);
      next = advanceDate(next, r.interval);
    }
    if (due.length === 0) continue;

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
          amount: r.amount,
          categoryId: r.categoryId ?? undefined,
          userId: r.userId,
          date,
          note: r.note,
          recurringId: r.id,
          createdAt: new Date(),
        }).run();
      }
      tx.update(recurring).set({ nextDate: next }).where(eq(recurring.id, r.id)).run();
    });
    created += due.length;
  }
  if (created > 0) {
    console.log(`[Haushaltsfinanzen] Cron: ${created} wiederkehrende Buchung(en) verbucht.`);
  }
  return created;
}
