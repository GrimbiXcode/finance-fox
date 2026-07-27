import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { accountTypes, banks } from "@db/schema";
import type { Db } from "../queries/connection";

/** IBAN-Muster: Ländercode + 2 Prüfziffern + 11–30 alphanumerische Zeichen */
const IBAN_REGEX = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/**
 * IBAN normalisieren (Leerzeichen entfernen, Großbuchstaben) und validieren.
 * Leerer/fehlender Wert → null. Ungültig → BAD_REQUEST.
 */
export function normalizeIban(input: string | null | undefined): string | null {
  const iban = (input ?? "").replace(/\s+/g, "").toUpperCase();
  if (iban === "") return null;
  if (!IBAN_REGEX.test(iban)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ungültige IBAN." });
  }
  return iban;
}

/** Prüft, dass der Kontotyp-Key in account_types existiert */
export async function ensureAccountTypeExists(db: Db, key: string) {
  const row = await db.query.accountTypes.findFirst({
    where: eq(accountTypes.key, key),
  });
  if (!row) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unbekannter Kontotyp.",
    });
  }
  return row;
}

/** Prüft, dass die Bank existiert (null/undefined = keine Bank, immer ok) */
export async function ensureBankExists(
  db: Db,
  bankId: number | null | undefined,
) {
  if (bankId === null || bankId === undefined) return null;
  const row = await db.query.banks.findFirst({
    where: eq(banks.id, bankId),
  });
  if (!row) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unbekannte Bank.",
    });
  }
  return row;
}
