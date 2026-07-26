import "dotenv/config";

export const env = {
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: process.env.DATABASE_URL || "file:./data/haushaltsfinanzen.db",
  /** Secret für Session-JWTs — in Produktion per Env-Variable setzen! */
  jwtSecret: process.env.JWT_SECRET || "haushaltsfinanzen-dev-secret-change-me",
  /** Basis-URL für Einladungs-/Reset-Links in den Server-Logs */
  publicUrl: process.env.PUBLIC_URL || "http://localhost:3000",
};
