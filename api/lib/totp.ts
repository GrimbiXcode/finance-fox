import { createHmac, randomBytes } from "node:crypto";

/**
 * TOTP nach RFC 6238 (SHA1, 30-s-Schritte, 6 Stellen) — bewusst ohne
 * externe Bibliothek über node:crypto implementiert.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_S = 30;
const TOTP_DIGITS = 6;

/** Bytes als Base32 (RFC 4648, ohne Padding) kodieren */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Base32 dekodieren — toleriert Kleinschreibung, Leerzeichen und
 * Padding ("="), damit auch abgetippte Secrets funktionieren.
 */
export function base32Decode(str: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of str.toUpperCase().replace(/[\s=]+/g, "")) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Ungültiges Base32-Zeichen");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Neues TOTP-Geheimnis erzeugen (20 Bytes, Base32-kodiert) */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP-Wert (RFC 4226, dynamische Trunkierung) für einen Zähler */
function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** TOTP-Code für einen Zeitpunkt berechnen (timestampMs nur für Tests) */
export function totpCode(secret: string, timestampMs = Date.now()): string {
  const key = base32Decode(secret);
  return hotp(key, Math.floor(timestampMs / 1000 / TOTP_PERIOD_S));
}

/**
 * TOTP-Code prüfen; window = erlaubte Zeitschritte vor/zurück
 * (±1 gleicht Uhrenabweichung zwischen Server und Authenticator aus).
 */
export function verifyTotp(
  secret: string,
  code: string,
  window = 1,
  timestampMs = Date.now(),
): boolean {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const key = base32Decode(secret);
  const step = Math.floor(timestampMs / 1000 / TOTP_PERIOD_S);
  for (let i = -window; i <= window; i++) {
    if (hotp(key, step + i) === normalized) return true;
  }
  return false;
}

/** otpauth://-URL für Authenticator-Apps (wird als QR-Code angezeigt) */
export function buildOtpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`FinanceFox:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Finance%20Fox`;
}
