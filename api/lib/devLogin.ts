import { eq } from "drizzle-orm";
import { accounts, users } from "@db/schema";
import type { Db } from "../queries/connection";
import { env } from "./env";

/**
 * Entwicklungs-Login ohne Passwort — damit sich die App lokal (und von
 * KI-Agenten) end-to-end durchklicken lässt, ohne ein Konto anzulegen oder
 * Zugangsdaten einzutippen.
 *
 * **Sicherheitsentwurf.** Der Auth-Pfad selbst bleibt unangetastet: Es gibt
 * keinen Bypass in `getSessionUser` und keine Sonderfälle in
 * `verifySessionToken`. Stattdessen stellt die Dev-Route ein ganz normales,
 * HMAC-signiertes Session-Cookie über `buildSessionCookie` aus — dieselbe
 * Funktion wie beim echten Login. Fällt die Route weg, verhält sich die App
 * exakt wie vorher.
 *
 * Doppelt abgeriegelt (`isEnabled`): `NODE_ENV` darf **nicht** `production`
 * sein UND `DEV_LOGIN=1` muss ausdrücklich gesetzt werden. Beides zusammen
 * kann in einem Docker-Image nicht versehentlich zutreffen — dort ist
 * `NODE_ENV=production` gesetzt. Der Serverstart schreibt zusätzlich eine
 * laute Warnung ins Log.
 */

/** Wohlbekannte Dev-Identitäten — zwei, damit sich Haushalts-Sichtbarkeit
 *  und personenbezogene Regeln überhaupt prüfen lassen. */
export const DEV_USERS = {
  admin: {
    email: "dev-admin@localhost",
    name: "Dev Admin",
    role: "admin" as const,
    color: "#10b981",
  },
  member: {
    email: "dev-member@localhost",
    name: "Dev Mitglied",
    role: "member" as const,
    color: "#6366f1",
  },
};

export type DevPersona = keyof typeof DEV_USERS;

/** Beide Riegel: kein Produktionsmodus UND ausdrückliches Opt-in */
export function isEnabled(): boolean {
  return !env.isProduction && env.devLogin;
}

/**
 * Legt die Dev-Identitäten und ein Gemeinschaftskonto an, falls sie fehlen —
 * idempotent, verändert bestehende Daten nie. Ohne Benutzer zeigt die App
 * den Ersteinrichtungs-Wizard (`auth.setupStatus` prüft nur, ob überhaupt
 * ein Benutzer existiert); ohne Konto lässt sich keine Buchung erfassen.
 *
 * Bewusst **kein** Passwort-Hash: Diese Konten sollen sich nicht regulär
 * anmelden lassen, sondern ausschließlich über die Dev-Route.
 */
export async function ensureDevHousehold(db: Db): Promise<void> {
  for (const dev of Object.values(DEV_USERS)) {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, dev.email),
    });
    if (existing) continue;
    await db.insert(users).values({
      email: dev.email,
      name: dev.name,
      passwordHash: null,
      role: dev.role,
      color: dev.color,
      active: true,
      createdAt: new Date(),
    });
  }

  // Ein Gemeinschaftskonto: keine Zeilen in account_owners = für alle
  // sicht- und bearbeitbar (siehe lib/accountAccess.ts).
  const anyAccount = await db.select({ id: accounts.id }).from(accounts).limit(1);
  if (anyAccount.length === 0) {
    await db.insert(accounts).values({
      name: "Gemeinschaftskonto",
      type: "checking",
      initialBalance: 500_000_00,
      bankId: null,
      iban: null,
      createdAt: new Date(),
    });
  }
}

/** Dev-Identität auflösen (legt sie bei Bedarf an) */
export async function resolveDevUser(
  db: Db,
  persona: DevPersona
): Promise<{ id: number; name: string } | null> {
  await ensureDevHousehold(db);
  const row = await db.query.users.findFirst({
    where: eq(users.email, DEV_USERS[persona].email),
  });
  return row ? { id: row.id, name: row.name } : null;
}

/** Laute Warnung beim Serverstart, damit der Modus nie unbemerkt läuft */
export function logDevLoginBanner(): void {
  console.warn(
    [
      "",
      "  ############################################################",
      "  #  DEV_LOGIN ist aktiv — /api/dev/login meldet OHNE",
      "  #  Passwort an. Nur für die lokale Entwicklung!",
      "  #  Niemals mit NODE_ENV=production oder erreichbar aus dem",
      "  #  Netz betreiben.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}
