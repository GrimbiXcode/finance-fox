import "dotenv/config";

export const env = {
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: process.env.DATABASE_URL || "file:./data/finance-fox.db",
  /** Secret für Session-JWTs — in Produktion per Env-Variable setzen! */
  jwtSecret: process.env.JWT_SECRET || "finance-fox-dev-secret-change-me",
  /** Basis-URL für Einladungs-/Reset-Links in den Server-Logs */
  publicUrl: process.env.PUBLIC_URL || "http://localhost:3000",
  /**
   * Secure-Flag für das Session-Cookie. Default: abhängig von PUBLIC_URL
   * (https:// → Secure, sonst ohne — damit funktioniert der Login auch über
   * HTTP im Heimnetz). Explizit überschreibbar mit COOKIE_SECURE=true|false.
   */
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "true"
    : (process.env.PUBLIC_URL || "http://localhost:3000").startsWith("https://"),
  /**
   * Passwortloser Entwicklungs-Login über `/api/dev/login` (siehe
   * `lib/devLogin.ts`). Wirkt **nur** zusammen mit NODE_ENV != production —
   * beide Riegel prüft `devLogin.isEnabled()`. Niemals in Produktion setzen.
   */
  devLogin: process.env.DEV_LOGIN === "1",
};
