import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { sendNotification } from "./lib/notify";
import { runRecurringJob } from "./lib/recurringJob";
import {
  accounts,
  appSettings,
  budgets,
  categories,
  recurring,
  savingsGoals,
} from "@db/schema";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  color: "#10b981",
};
const member: SessionUser = {
  id: 2,
  email: "member@example.com",
  name: "Mitglied",
  role: "member",
  color: "#6366f1",
};

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

/** Datum als YYYY-MM-DD (lokal) */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function configureNotify(
  ntfyUrl: string | null,
  webhookUrl: string | null,
  events = { budget: true, recurring: true, goal: true }
) {
  await callerFor(admin).finance.setNotifySettings({
    ntfyUrl,
    webhookUrl,
    events,
  });
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  vi.stubGlobal("fetch", fetchMock);
});

beforeEach(async () => {
  fetchMock.mockClear();
  await configureNotify(null, null);
});

describe("sendNotification (Kanäle)", () => {
  it("sendet ntfy-POST mit Title/Priority/Tags-Headern und Plain-Text-Body", async () => {
    await configureNotify("https://ntfy.example.org/haushalt", null);
    const sent = await sendNotification(getDb(), "budget", "Titel", "Inhalt");
    expect(sent).toEqual(["ntfy"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://ntfy.example.org/haushalt");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("Inhalt");
    const headers = init.headers as Record<string, string>;
    expect(headers.Title).toBe("Titel");
    expect(headers.Priority).toBe("default");
    expect(headers.Tags).toBe("moneybag");
  });

  it("sendet Webhook als JSON mit event/title/body/app", async () => {
    await configureNotify(null, "https://hooks.example.org/fox");
    const sent = await sendNotification(getDb(), "goal", "Titel", "Inhalt");
    expect(sent).toEqual(["webhook"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://hooks.example.org/fox");
    expect(JSON.parse(String(init.body))).toEqual({
      event: "goal",
      title: "Titel",
      body: "Inhalt",
      app: "finance-fox",
    });
  });

  it("nutzt beide Kanäle parallel, wenn beide konfiguriert sind", async () => {
    await configureNotify(
      "https://ntfy.example.org/t",
      "https://hooks.example.org/h"
    );
    const sent = await sendNotification(getDb(), "recurring", "T", "B");
    expect(sent).toEqual(["ntfy", "webhook"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("schluckt Versandfehler und bricht den Hauptflow nicht", async () => {
    await configureNotify("https://ntfy.example.org/t", null);
    fetchMock.mockRejectedValueOnce(new Error("Netzwerkfehler"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendNotification(getDb(), "budget", "T", "B")
    ).resolves.toEqual([]);
    spy.mockRestore();
  });

  it("respektiert die Event-Schalter", async () => {
    await configureNotify("https://ntfy.example.org/t", null, {
      budget: false,
      recurring: true,
      goal: true,
    });
    expect(await sendNotification(getDb(), "budget", "T", "B")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sendNotification(getDb(), "goal", "T", "B")).toEqual(["ntfy"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignoriert Nicht-http(s)-URLs beim Versand", async () => {
    // Direkt in die DB schreiben (die API lehnt solche URLs ab)
    const db = getDb();
    await db
      .insert(appSettings)
      .values({ key: "notify_ntfy_url", value: "file:///etc/passwd" })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: "file:///etc/passwd" },
      });
    const sent = await sendNotification(getDb(), "budget", "T", "B");
    expect(sent).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("setNotifySettings / sendTestNotification (Admin-Endpunkte)", () => {
  it("lehnt URLs ohne http(s) mit deutscher Fehlermeldung ab", async () => {
    await expect(
      callerFor(admin).finance.setNotifySettings({
        ntfyUrl: "ftp://example.org/t",
        webhookUrl: null,
        events: { budget: true, recurring: true, goal: true },
      })
    ).rejects.toThrow(/http:\/\/ oder https:\/\//);
    await expect(
      callerFor(admin).finance.setNotifySettings({
        ntfyUrl: null,
        webhookUrl: "javascript:alert(1)",
        events: { budget: true, recurring: true, goal: true },
      })
    ).rejects.toThrow(/http:\/\/ oder https:\/\//);
  });

  it("trimmt URLs und wandelt leere Strings in null um", async () => {
    await callerFor(admin).finance.setNotifySettings({
      ntfyUrl: "  https://ntfy.example.org/t  ",
      webhookUrl: "   ",
      events: { budget: true, recurring: true, goal: true },
    });
    const cfg = await callerFor(admin).finance.getNotifySettings();
    expect(cfg.ntfyUrl).toBe("https://ntfy.example.org/t");
    expect(cfg.webhookUrl).toBeNull();
  });

  it("dürfen Mitglieder nicht ändern", async () => {
    await expect(
      callerFor(member).finance.setNotifySettings({
        ntfyUrl: null,
        webhookUrl: null,
        events: { budget: true, recurring: true, goal: true },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Testbenachrichtigung meldet die genutzten Kanäle", async () => {
    await expect(
      callerFor(admin).finance.sendTestNotification()
    ).rejects.toThrow(/nicht konfiguriert|Keine/i);
    await configureNotify(
      "https://ntfy.example.org/t",
      "https://hooks.example.org/h"
    );
    const result = await callerFor(admin).finance.sendTestNotification();
    expect(result.sent).toEqual(["ntfy", "webhook"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Trigger: Budget-Überschreitung in createTransaction", () => {
  it("löst beim Kippen über 100 % einmalig aus", async () => {
    await configureNotify("https://ntfy.example.org/t", null);
    const db = getDb();
    const acc = await db
      .insert(accounts)
      .values({
        name: "Budget-Konto",
        type: "checking",
        initialBalance: 0,
        createdAt: new Date(),
      })
      .returning({ id: accounts.id });
    const cat = await db
      .insert(categories)
      .values({
        name: "Lebensmittel",
        type: "expense",
        color: "#f43f5e",
      })
      .returning({ id: categories.id });
    await db.insert(budgets).values({
      categoryId: cat[0].id,
      amount: 10000,
      period: "monthly",
      rollover: false,
      createdAt: new Date(),
    });

    const caller = callerFor(admin);
    const tx = (amount: number) =>
      caller.finance.createTransaction({
        type: "expense",
        accountId: acc[0].id,
        amount,
        categoryId: cat[0].id,
        userId: admin.id,
        date: todayISO(),
        note: "",
      });

    await tx(6000); // 60 % — noch keine Benachrichtigung
    expect(fetchMock).not.toHaveBeenCalled();

    await tx(5000); // 110 % — Budget kippt
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).Title).toContain(
      "Budget überschritten"
    );

    await tx(1000); // weiterhin >100 % — keine erneute Benachrichtigung
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Legacy-Sperre: updateGoalSaved (Sparziele 2.0)", () => {
  it("lehnt manuelle Einzahlungen ab und sendet keine Benachrichtigung", async () => {
    await configureNotify("https://ntfy.example.org/t", null);
    const db = getDb();
    const goal = await db
      .insert(savingsGoals)
      .values({
        name: "Urlaub",
        targetAmount: 10000,
        savedAmount: 3000,
        color: "#10b981",
      })
      .returning({ id: savingsGoals.id });
    await expect(
      callerFor(admin).finance.updateGoalSaved({
        id: goal[0].id,
        savedAmount: 5000,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Manuelle Einzahlungen sind nicht mehr möglich — verknüpfe das Sparziel mit einem Konto.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Trigger: fällige wiederkehrende Buchungen", () => {
  it("sendet eine Sammel-Benachrichtigung", async () => {
    await configureNotify("https://ntfy.example.org/t", null);
    const db = getDb();
    const acc = await db
      .insert(accounts)
      .values({
        name: "Recurring-Konto",
        type: "checking",
        initialBalance: 0,
        createdAt: new Date(),
      })
      .returning({ id: accounts.id });
    await db.insert(recurring).values({
      type: "expense",
      accountId: acc[0].id,
      amount: 999,
      userId: admin.id,
      interval: "monthly",
      nextDate: todayISO(),
      active: true,
      createdAt: new Date(),
    });

    const created = await runRecurringJob();
    expect(created).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(init.body)).toContain("1 wiederkehrende Buchung(en)");
  });
});
