import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createRouter,
  publicQuery,
  authedQuery,
  adminQuery,
} from "./middleware";
import { getDb } from "./queries/connection";
import { authTokens, users } from "@db/schema";
import { buildLogoutCookie, buildSessionCookie } from "./lib/session";
import { buildOtpauthUrl, generateSecret, verifyTotp } from "./lib/totp";
import { requireAccountAccess } from "./lib/accountAccess";
import { logAudit } from "./lib/audit";
import { env } from "./lib/env";

const TOKEN_DAYS = 7;
/** Zweitfaktor-Login-Token sind kurzlebig (Zwischenschritt nach dem Passwort) */
const TOTP_TOKEN_MS = 5 * 60 * 1000;

type TokenPurpose = "invite" | "reset" | "totp";

async function createToken(
  userId: number,
  purpose: TokenPurpose,
  ttlMs = TOKEN_DAYS * 24 * 60 * 60 * 1000
) {
  const token = randomBytes(24).toString("base64url");
  const now = new Date();
  await getDb()
    .insert(authTokens)
    .values({
      userId,
      token,
      purpose,
      expiresAt: new Date(now.getTime() + ttlMs),
      createdAt: now,
    });
  return token;
}

async function consumeToken(token: string, purpose: TokenPurpose) {
  const db = getDb();
  const row = await db.query.authTokens.findFirst({
    where: and(
      eq(authTokens.token, token),
      eq(authTokens.purpose, purpose),
      isNull(authTokens.usedAt),
      gt(authTokens.expiresAt, new Date())
    ),
  });
  if (!row) return null;
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(eq(authTokens.id, row.id));
  return row;
}

export const authRouter = createRouter({
  /** Ist die Ersteinrichtung noch offen? (kein Benutzer vorhanden) */
  setupStatus: publicQuery.query(async () => {
    const all = await getDb().select({ id: users.id }).from(users).limit(1);
    return { needsSetup: all.length === 0 };
  }),

  /** Ersteinrichtung: legt den ersten (Admin-)Benutzer an */
  setup: publicQuery
    .input(
      z.object({
        name: z.string().min(1, "Name erforderlich"),
        email: z.string().email("Gültige E-Mail erforderlich"),
        password: z.string().min(8, "Mindestens 8 Zeichen"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const all = await db.select({ id: users.id }).from(users).limit(1);
      if (all.length > 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Ersteinrichtung bereits abgeschlossen.",
        });
      }
      const now = new Date();
      await db.insert(users).values({
        email: input.email.toLowerCase().trim(),
        name: input.name.trim(),
        passwordHash: bcrypt.hashSync(input.password, 10),
        role: "admin",
        color: "#10b981",
        createdAt: now,
      });
      const admin = await db.query.users.findFirst({
        where: eq(users.email, input.email.toLowerCase().trim()),
      });
      if (!admin) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      ctx.resHeaders.set(
        "set-cookie",
        buildSessionCookie(admin.id, env.cookieSecure)
      );
      return { ok: true };
    }),

  login: publicQuery
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.email, input.email.toLowerCase().trim()),
      });
      if (
        !user ||
        !user.passwordHash ||
        !bcrypt.compareSync(input.password, user.passwordHash)
      ) {
        // Fehlschlag nur mit E-Mail protokollieren — niemals Passwort o. ä.
        logAudit(
          db,
          null,
          "auth.login.failed",
          "auth",
          null,
          input.email.toLowerCase().trim()
        );
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "E-Mail oder Passwort falsch.",
        });
      }
      if (!user.active) {
        logAudit(
          db,
          user.id,
          "auth.login.failed",
          "auth",
          user.id,
          "Konto deaktiviert"
        );
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Konto ist deaktiviert.",
        });
      }
      // 2FA aktiviert: kein Cookie, sondern kurzlebiger Token für den
      // zweiten Schritt (verifyTotpLogin)
      if (user.totpEnabled) {
        const totpToken = await createToken(user.id, "totp", TOTP_TOKEN_MS);
        return { requiresTotp: true as const, totpToken };
      }
      ctx.resHeaders.set(
        "set-cookie",
        buildSessionCookie(user.id, env.cookieSecure)
      );
      logAudit(db, user.id, "auth.login", "auth", user.id, user.email);
      return { requiresTotp: false as const };
    }),

  /** Zweiter Login-Schritt bei aktiviertem TOTP: Code gegen das Secret prüfen */
  verifyTotpLogin: publicQuery
    .input(
      z.object({
        token: z.string().min(10),
        code: z.string().min(6).max(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      // Token ist einmalig — auch ein falscher Code verbraucht ihn
      const row = await consumeToken(input.token, "totp");
      if (!row) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Anmeldung ist abgelaufen — bitte erneut mit E-Mail und Passwort anmelden.",
        });
      }
      const user = await db.query.users.findFirst({
        where: eq(users.id, row.userId),
      });
      if (!user || !user.active) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Konto ist deaktiviert.",
        });
      }
      if (
        !user.totpEnabled ||
        !user.totpSecret ||
        !verifyTotp(user.totpSecret, input.code)
      ) {
        logAudit(
          db,
          user.id,
          "auth.login.failed",
          "auth",
          user.id,
          "Ungültiger 2FA-Code"
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ungültiger Code.",
        });
      }
      ctx.resHeaders.set(
        "set-cookie",
        buildSessionCookie(user.id, env.cookieSecure)
      );
      logAudit(
        db,
        user.id,
        "auth.login",
        "auth",
        user.id,
        "Mit Zwei-Faktor-Authentifizierung"
      );
      return { ok: true };
    }),

  logout: publicQuery.mutation(({ ctx }) => {
    ctx.resHeaders.set("set-cookie", buildLogoutCookie());
    logAudit(
      getDb(),
      ctx.user?.id ?? null,
      "auth.logout",
      "auth",
      ctx.user?.id ?? null
    );
    return { ok: true };
  }),

  me: publicQuery.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    const user = await getDb().query.users.findFirst({
      where: eq(users.id, ctx.user.id),
    });
    return {
      ...ctx.user,
      totpEnabled: user?.totpEnabled ?? false,
      quickAccountId: user?.quickAccountId ?? null,
    };
  }),

  /**
   * Schnellerfassung: Konto konfigurieren, auf das gebucht wird
   * (null = automatisch erstes Konto mit „edit"-Recht).
   */
  setQuickAccount: authedQuery
    .input(z.object({ accountId: z.number().int().positive().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      let detail = "Schnellkonto: automatisch";
      if (input.accountId !== null) {
        const account = await requireAccountAccess(
          db,
          ctx.user,
          input.accountId,
          "edit"
        );
        detail = `Schnellkonto: ${account.name}`;
      }
      await db
        .update(users)
        .set({ quickAccountId: input.accountId })
        .where(eq(users.id, ctx.user.id));
      logAudit(db, ctx.user.id, "user.updated", "user", ctx.user.id, detail);
      return { ok: true };
    }),

  /** 2FA-Einrichtung starten: Secret erzeugen und (noch inaktiv) speichern */
  setupTotp: authedQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    const user = await db.query.users.findFirst({
      where: eq(users.id, ctx.user.id),
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    if (user.totpEnabled) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Zwei-Faktor-Authentifizierung ist bereits aktiviert.",
      });
    }
    const secret = generateSecret();
    await db
      .update(users)
      .set({ totpSecret: secret })
      .where(eq(users.id, user.id));
    return { secret, otpauthUrl: buildOtpauthUrl(secret, user.email) };
  }),

  /** 2FA aktivieren: Code gegen das gespeicherte Secret verifizieren */
  enableTotp: authedQuery
    .input(z.object({ code: z.string().min(6).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      if (user.totpEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Zwei-Faktor-Authentifizierung ist bereits aktiviert.",
        });
      }
      if (!user.totpSecret || !verifyTotp(user.totpSecret, input.code)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ungültiger Code.",
        });
      }
      await db
        .update(users)
        .set({ totpEnabled: true })
        .where(eq(users.id, user.id));
      logAudit(db, ctx.user.id, "user.totp.enabled", "user", user.id);
      return { ok: true };
    }),

  /** 2FA deaktivieren — nur mit aktuellem Passwort */
  disableTotp: authedQuery
    .input(z.object({ password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
      if (
        !user?.passwordHash ||
        !bcrypt.compareSync(input.password, user.passwordHash)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Passwort ist falsch.",
        });
      }
      await db
        .update(users)
        .set({ totpSecret: null, totpEnabled: false })
        .where(eq(users.id, user.id));
      logAudit(db, ctx.user.id, "user.totp.disabled", "user", user.id);
      return { ok: true };
    }),

  /** Passwort vergessen: erzeugt Reset-Link (wird im Server-Log ausgegeben) */
  requestReset: publicQuery
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.email, input.email.toLowerCase().trim()),
      });
      // Kein Hinweis, ob die E-Mail existiert (Sicherheit)
      if (user) {
        const token = await createToken(user.id, "reset");
        console.log(
          `[Finance Fox] Passwort-Reset-Link für ${user.email}: ${env.publicUrl}/#/reset/${token}`
        );
      }
      return { ok: true };
    }),

  /** Passwort über Einladungs- oder Reset-Token setzen */
  setPassword: publicQuery
    .input(
      z.object({
        token: z.string().min(10),
        purpose: z.enum(["invite", "reset"]),
        password: z.string().min(8, "Mindestens 8 Zeichen"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await consumeToken(input.token, input.purpose);
      if (!row) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Link ist ungültig oder abgelaufen.",
        });
      }
      await db
        .update(users)
        .set({
          passwordHash: bcrypt.hashSync(input.password, 10),
          active: true,
        })
        .where(eq(users.id, row.userId));
      ctx.resHeaders.set(
        "set-cookie",
        buildSessionCookie(row.userId, env.cookieSecure)
      );
      return { ok: true };
    }),

  /** Token-Infos (Name/E-Mail) für die Passwort-setzen-Seite */
  tokenInfo: publicQuery
    .input(
      z.object({
        token: z.string().min(10),
        purpose: z.enum(["invite", "reset"]),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const row = await db.query.authTokens.findFirst({
        where: and(
          eq(authTokens.token, input.token),
          eq(authTokens.purpose, input.purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date())
        ),
      });
      if (!row) return null;
      const user = await db.query.users.findFirst({
        where: eq(users.id, row.userId),
      });
      return user ? { name: user.name, email: user.email } : null;
    }),

  /* ------------------------------ Admin-Bereich ------------------------------ */

  listUsers: authedQuery.query(async () => {
    const db = getDb();
    const all = await db.select().from(users);
    return all.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      active: u.active,
      hasPassword: u.passwordHash !== null,
    }));
  }),

  createUser: adminQuery
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        role: z.enum(["admin", "member"]).default("member"),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#6366f1"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const email = input.email.toLowerCase().trim();
      const existing = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Diese E-Mail ist bereits vergeben.",
        });
      }
      await db.insert(users).values({
        email,
        name: input.name.trim(),
        role: input.role,
        color: input.color,
        active: true,
        createdAt: new Date(),
      });
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const token = await createToken(user.id, "invite");
      const link = `${env.publicUrl}/#/einladung/${token}`;
      console.log(`[Finance Fox] Einladungslink für ${email}: ${link}`);
      logAudit(
        db,
        ctx.user.id,
        "user.created",
        "user",
        user.id,
        `${user.name} (${user.email}, ${user.role})`
      );
      return { id: user.id, inviteLink: link };
    }),

  deactivateUser: adminQuery
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Du kannst dich nicht selbst deaktivieren.",
        });
      }
      const db = getDb();
      await db
        .update(users)
        .set({ active: false })
        .where(eq(users.id, input.userId));
      const target = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      logAudit(
        db,
        ctx.user.id,
        "user.deactivated",
        "user",
        input.userId,
        target?.name ?? ""
      );
      return { ok: true };
    }),

  reactivateUser: adminQuery
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(users)
        .set({ active: true })
        .where(eq(users.id, input.userId));
      const target = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      logAudit(
        db,
        ctx.user.id,
        "user.reactivated",
        "user",
        input.userId,
        target?.name ?? ""
      );
      return { ok: true };
    }),

  /** Neuen Einladungs-/Reset-Link für einen Benutzer erzeugen */
  resetUserPassword: adminQuery
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      const token = await createToken(user.id, "invite");
      const link = `${env.publicUrl}/#/einladung/${token}`;
      console.log(
        `[Finance Fox] Neuer Einladungslink für ${user.email}: ${link}`
      );
      return { inviteLink: link };
    }),

  updateProfile: authedQuery
    .input(
      z.object({
        name: z.string().min(1).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(users)
        .set({
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.color ? { color: input.color } : {}),
        })
        .where(eq(users.id, ctx.user.id));
      logAudit(
        getDb(),
        ctx.user.id,
        "user.updated",
        "user",
        ctx.user.id,
        input.name ? `Name: ${input.name.trim()}` : "Farbe geändert"
      );
      return { ok: true };
    }),

  changePassword: authedQuery
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "Mindestens 8 Zeichen"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
      if (
        !user?.passwordHash ||
        !bcrypt.compareSync(input.currentPassword, user.passwordHash)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Aktuelles Passwort ist falsch.",
        });
      }
      await db
        .update(users)
        .set({
          passwordHash: bcrypt.hashSync(input.newPassword, 10),
        })
        .where(eq(users.id, ctx.user.id));
      logAudit(db, ctx.user.id, "user.passwordChanged", "user", ctx.user.id);
      return { ok: true };
    }),
});
