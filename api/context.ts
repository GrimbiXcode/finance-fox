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

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  const token = parseSessionCookie(opts.req);
  if (token) {
    const userId = verifySessionToken(token);
    if (userId !== null) {
      const user = await getDb().query.users.findFirst({ where: eq(users.id, userId) });
      if (user && user.active) {
        ctx.user = {
          id: user.id, email: user.email, name: user.name, role: user.role, color: user.color,
        };
      }
    }
  }
  return ctx;
}
