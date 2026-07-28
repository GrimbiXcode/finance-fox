import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { verifySessionToken } from "./lib/session";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateSecret,
  totpCode,
  verifyTotp,
} from "./lib/totp";
import { users } from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return { caller: appRouter.createCaller(ctx), resHeaders: ctx.resHeaders };
}

/** ASCII-Testsecret aus RFC 6238 (SHA1): "12345678901234567890" */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

beforeAll(async () => {
  await initDb();
  ensureSchema();
});

describe("TOTP-Basics (RFC 6238)", () => {
  it("Base32-Roundtrip liefert die Original-Bytes", () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    // Decode toleriert Kleinschreibung, Leerzeichen und Padding
    const enc = base32Encode(buf).toLowerCase();
    const grouped = `${enc.match(/.{1,4}/g)!.join(" ")}===`;
    expect(base32Decode(grouped).equals(buf)).toBe(true);
  });

  it("generateSecret erzeugt 20 Bytes als 32-stelliges Base32", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret).length).toBe(20);
  });

  it("offizielle RFC-6238-Testvektoren (8-stellig, auf 6 gekürzt)", () => {
    const vectors: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
      [20000000000, "353130"],
    ];
    for (const [timeS, expected] of vectors) {
      expect(totpCode(RFC_SECRET, timeS * 1000)).toBe(expected);
    }
  });

  it("Fenster-Logik: ±1 Zeitschritt ok, ±2 nicht", () => {
    const t = 1111111109_000;
    const code = totpCode(RFC_SECRET, t);
    expect(verifyTotp(RFC_SECRET, code, 1, t)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, 1, t - 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, 1, t + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, 1, t - 60_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, code, 1, t + 60_000)).toBe(false);
    // Fenster 0 = nur der aktuelle Schritt
    expect(verifyTotp(RFC_SECRET, code, 0, t)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, 0, t + 30_000)).toBe(false);
  });

  it("lehnt falsch formatierte Codes ab", () => {
    const t = 1111111109_000;
    expect(verifyTotp(RFC_SECRET, "12345", 1, t)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", 1, t)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "081805", 1, t)).toBe(false);
  });

  it("otpauth-URL enthält Label, Secret und Issuer", () => {
    const url = buildOtpauthUrl("ABC234", "mia@example.com");
    expect(url).toBe(
      "otpauth://totp/FinanceFox%3Amia%40example.com?secret=ABC234&issuer=Finance%20Fox",
    );
  });
});

describe("2FA-Login-Flow", () => {
  const email = "mia@example.com";
  const password = "geheim1234";
  let userId: number;
  let mia: SessionUser;

  beforeAll(async () => {
    const db = getDb();
    await db.insert(users).values({
      email,
      name: "Mia",
      passwordHash: bcrypt.hashSync(password, 10),
      role: "member",
      color: "#6366f1",
      active: true,
      createdAt: new Date(),
    });
    const row = await db.query.users.findFirst({ where: eq(users.email, email) });
    userId = row!.id;
    mia = { id: userId, email, name: "Mia", role: "member", color: "#6366f1" };
  });

  it("Login ohne 2FA setzt direkt das Session-Cookie", async () => {
    const { caller, resHeaders } = callerFor();
    const result = await caller.auth.login({ email, password });
    expect(result.requiresTotp).toBe(false);
    expect(resHeaders.get("set-cookie")).toContain("hh_session=");
  });

  it("setup → enable: falscher Code schlägt fehl, richtiger aktiviert", async () => {
    const { caller } = callerFor(mia);
    const setup = await caller.auth.setupTotp();
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toContain("otpauth://totp/");

    await expect(
      caller.auth.enableTotp({ code: "000000" }),
    ).rejects.toThrow("Ungültiger Code.");
    expect((await caller.auth.me())?.totpEnabled).toBe(false);

    await caller.auth.enableTotp({ code: totpCode(setup.secret) });
    expect((await caller.auth.me())?.totpEnabled).toBe(true);

    // Zweites Setup bei aktiviertem TOTP wird abgelehnt
    await expect(caller.auth.setupTotp()).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("Login mit 2FA liefert requiresTotp + Token und kein Cookie", async () => {
    const { caller, resHeaders } = callerFor();
    const result = await caller.auth.login({ email, password });
    expect(result.requiresTotp).toBe(true);
    if (result.requiresTotp) {
      expect(result.totpToken.length).toBeGreaterThan(10);
    }
    expect(resHeaders.get("set-cookie")).toBeNull();
  });

  it("falscher Code verbraucht den Token (einmalig)", async () => {
    const { caller } = callerFor();
    const login = await caller.auth.login({ email, password });
    if (!login.requiresTotp) throw new Error("TOTP erwartet");

    await expect(
      caller.auth.verifyTotpLogin({ token: login.totpToken, code: "000000" }),
    ).rejects.toThrow("Ungültiger Code.");

    // Derselbe Token ist danach ungültig — auch mit dem richtigen Code
    const db = getDb();
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    await expect(
      caller.auth.verifyTotpLogin({
        token: login.totpToken,
        code: totpCode(user!.totpSecret!),
      }),
    ).rejects.toThrow(/abgelaufen|erneut/);
  });

  it("verifyTotpLogin mit gültigem Code setzt die Session", async () => {
    const { caller, resHeaders } = callerFor();
    const login = await caller.auth.login({ email, password });
    if (!login.requiresTotp) throw new Error("TOTP erwartet");

    const db = getDb();
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const result = await caller.auth.verifyTotpLogin({
      token: login.totpToken,
      code: totpCode(user!.totpSecret!),
    });
    expect(result.ok).toBe(true);

    const cookie = resHeaders.get("set-cookie");
    expect(cookie).toContain("hh_session=");
    const token = cookie!.match(/hh_session=([^;]+)/)![1];
    expect(verifySessionToken(token)).toBe(userId);
  });

  it("disableTotp nur mit korrektem Passwort", async () => {
    const { caller } = callerFor(mia);
    await expect(
      caller.auth.disableTotp({ password: "falsch" }),
    ).rejects.toThrow("Passwort ist falsch.");
    expect((await caller.auth.me())?.totpEnabled).toBe(true);

    await caller.auth.disableTotp({ password });
    expect((await caller.auth.me())?.totpEnabled).toBe(false);

    const db = getDb();
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(user!.totpSecret).toBeNull();

    // Login läuft danach wieder ohne zweiten Schritt
    const anon = callerFor();
    const login = await anon.caller.auth.login({ email, password });
    expect(login.requiresTotp).toBe(false);
    expect(anon.resHeaders.get("set-cookie")).toContain("hh_session=");
  });
});
