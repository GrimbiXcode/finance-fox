/**
 * Ersatz für `node:crypto` in der lokalen Replik.
 *
 * Gebraucht wird davon offline nichts: `createHmac` steckt in der
 * Session-Signatur und im TOTP-Code, `randomBytes` in Einladungs- und
 * Reset-Tokens — alles Prozeduren, die es nur im Heimnetz gibt.
 *
 * Deshalb werfen beide, statt still etwas Wertloses zu liefern. Eine im
 * Browser erzeugte Session-Signatur wäre fälschbar; ein leiser Ersatz wäre
 * eine Sicherheitslücke, ein lauter Fehler ist ein Bug-Report.
 */

function unavailable(name: string): never {
  throw new Error(
    `${name} steht offline nicht zur Verfügung — diese Funktion ` +
      "gibt es nur im Heimnetz."
  );
}

export function createHmac(): never {
  return unavailable("createHmac");
}

export function randomBytes(): never {
  return unavailable("randomBytes");
}

/** Der einzige echte Vertreter: den kann der Browser selbst. */
export function randomUUID(): string {
  return crypto.randomUUID();
}

export default { createHmac, randomBytes, randomUUID };
