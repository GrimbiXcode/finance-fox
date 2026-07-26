import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { initDb } from "./queries/connection";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1, email: "admin@example.com", name: "Admin", role: "admin", color: "#10b981",
};
const member: SessionUser = {
  id: 2, email: "member@example.com", name: "Mitglied", role: "member", color: "#6366f1",
};

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
});

describe("App-Einstellungen (Währung)", () => {
  it("liefert standardmäßig EUR", async () => {
    const settings = await callerFor(member).finance.getAppSettings();
    expect(settings.currency).toBe("EUR");
  });

  it("Admin kann die Währung ändern, alle lesen den neuen Wert", async () => {
    await callerFor(admin).finance.setCurrency({ currency: "CHF" });
    const settings = await callerFor(member).finance.getAppSettings();
    expect(settings.currency).toBe("CHF");
  });

  it("Mitglieder dürfen die Währung nicht ändern", async () => {
    await expect(
      callerFor(member).finance.setCurrency({ currency: "USD" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lehnt ungültige Währungscodes ab", async () => {
    await expect(
      callerFor(admin).finance.setCurrency({ currency: "XXX" as never }),
    ).rejects.toThrow();
    const settings = await callerFor(admin).finance.getAppSettings();
    expect(settings.currency).toBe("CHF");
  });
});
