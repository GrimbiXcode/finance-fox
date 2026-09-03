/**
 * Ersatz für `api/lib/env.ts` in der lokalen Replik.
 *
 * Im Browser gibt es keine Umgebungsvariablen — und die Werte, um die es dort
 * geht, gehören auch nicht dorthin. Die Felder existieren nur, damit der
 * mitgelieferte Server-Code unverändert übersetzt; benutzt wird davon offline
 * nichts: Alle Prozeduren, die Session-Signatur, Einladungslinks oder den
 * Entwicklungs-Login brauchen, laufen ausschließlich im Heimnetz
 * (`ONLINE_ONLY_PROCEDURES` in `contracts/offline.ts`).
 */
export const env = {
  isProduction: true,
  databaseUrl: "indexeddb:finance-fox",
  /**
   * Bewusst kein Geheimnis: Ein im Browser liegendes Signaturgeheimnis wäre
   * keines. Sessions signiert und prüft ausschließlich der Server; im Browser
   * wirft schon der HMAC-Ersatz (`shims/node-crypto.ts`).
   */
  jwtSecret: "offline-replica-has-no-secret",
  publicUrl: "",
  cookieSecure: true,
  devLogin: false,
};

const __surfaceCheck: typeof import("../../../api/lib/env") = { env };
void __surfaceCheck;
