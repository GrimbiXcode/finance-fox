import { appSettings } from "@db/schema";
import type { Db } from "../queries/connection";

/**
 * Benachrichtigungen via ntfy und/oder generischem Webhook (opt-in,
 * selbstgehostet). Konfiguration liegt als app_settings-Keys in der DB:
 * - notify_ntfy_url:    volle Topic-URL (z. B. https://ntfy.sh/mein-haushalt)
 * - notify_webhook_url: generischer HTTP-Endpoint (bekommt JSON per POST)
 * - notify_events:      JSON {"budget":bool,"recurring":bool,"goal":bool}
 * Fehler beim Versand werden nur geloggt — nie den Hauptflow brechen.
 */

export type NotifyEvent = "budget" | "recurring" | "goal" | "test";

export interface NotifyEvents {
  budget: boolean;
  recurring: boolean;
  goal: boolean;
}

export interface NotifyConfig {
  ntfyUrl: string | null;
  webhookUrl: string | null;
  events: NotifyEvents;
}

/** SSRF-Grundsatz: nur http/https-URLs akzeptieren, alles andere ignorieren */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseEvents(raw: string | undefined): NotifyEvents {
  if (!raw) return { budget: true, recurring: true, goal: true };
  try {
    const parsed = JSON.parse(raw) as Partial<NotifyEvents>;
    return {
      budget: parsed.budget !== false,
      recurring: parsed.recurring !== false,
      goal: parsed.goal !== false,
    };
  } catch {
    return { budget: true, recurring: true, goal: true };
  }
}

/** Liest die Benachrichtigungs-Konfiguration aus app_settings */
export async function getNotifyConfig(db: Db): Promise<NotifyConfig> {
  const rows = await db.select().from(appSettings);
  const map = new Map(rows.map(r => [r.key, r.value]));
  const ntfyRaw = map.get("notify_ntfy_url");
  const webhookRaw = map.get("notify_webhook_url");
  return {
    ntfyUrl: ntfyRaw && isHttpUrl(ntfyRaw) ? ntfyRaw : null,
    webhookUrl: webhookRaw && isHttpUrl(webhookRaw) ? webhookRaw : null,
    events: parseEvents(map.get("notify_events")),
  };
}

/**
 * Versendet eine Benachrichtigung über alle konfigurierten Kanäle (ntfy und
 * Webhook unabhängig voneinander, ohne Retry). Gibt die genutzten Kanäle
 * zurück ("ntfy" / "webhook"). Versandfehler werden nur geloggt.
 */
export async function sendNotification(
  db: Db,
  event: NotifyEvent,
  title: string,
  body: string
): Promise<string[]> {
  const cfg = await getNotifyConfig(db);
  // Event-Schalter greifen nur für echte Ereignisse, nicht für den Test
  if (event !== "test" && !cfg.events[event]) return [];
  const sent: string[] = [];

  if (cfg.ntfyUrl) {
    try {
      await fetch(cfg.ntfyUrl, {
        method: "POST",
        headers: { Title: title, Priority: "default", Tags: "moneybag" },
        body,
        signal: AbortSignal.timeout(5000),
      });
      sent.push("ntfy");
    } catch (err) {
      console.error("[Finance Fox] ntfy-Benachrichtigung fehlgeschlagen:", err);
    }
  }

  if (cfg.webhookUrl) {
    try {
      await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, title, body, app: "finance-fox" }),
        signal: AbortSignal.timeout(5000),
      });
      sent.push("webhook");
    } catch (err) {
      console.error(
        "[Finance Fox] Webhook-Benachrichtigung fehlgeschlagen:",
        err
      );
    }
  }

  return sent;
}
