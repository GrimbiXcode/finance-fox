import { createHmac } from "node:crypto";
import { env } from "./env";

const COOKIE_NAME = "hh_session";
const SESSION_DAYS = 30;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return base64url(createHmac("sha256", env.jwtSecret).update(payload).digest());
}

export function createSessionToken(userId: number): string {
  const payload = base64url(Buffer.from(JSON.stringify({
    uid: userId,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  })));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): number | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64").toString("utf-8")) as { uid: number; exp: number };
    if (typeof data.uid !== "number" || data.exp < Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export function parseSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

export function buildSessionCookie(userId: number, isProduction: boolean): string {
  const token = createSessionToken(userId);
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

export function buildLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
