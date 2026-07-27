import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { parseSessionCookie, verifySessionToken } from "./lib/session";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  color: string;
};

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: SessionUser;
};

/** Session-User aus dem Cookie hh_session auflösen (auch für Nicht-tRPC-Routen) */
export async function getSessionUser(
  req: Request
): Promise<SessionUser | undefined> {
  const token = parseSessionCookie(req);
  if (!token) return undefined;
  const userId = verifySessionToken(token);
  if (userId === null) return undefined;
  const user = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user || !user.active) return undefined;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    color: user.color,
  };
}

export async function createContext(
  opts: FetchCreateContextFnOptions
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  ctx.user = await getSessionUser(opts.req);
  return ctx;
}
