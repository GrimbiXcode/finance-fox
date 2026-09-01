import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SyncStatus } from "@contracts/offline";
import { useAuth } from "@/providers/auth";
import { queryClient } from "@/providers/trpc";
import {
  offlineUnsupportedReason,
  onWorkerMessage,
  postToWorker,
  syncNow,
} from "@/lib/serviceWorker";

/**
 * Bindeglied zwischen App und Offline-Teil.
 *
 * Drei Aufgaben:
 * - dem Service Worker sagen, **wer** angemeldet ist (das HttpOnly-Cookie kann
 *   er nicht lesen, eine Identität braucht die lokale Replik aber),
 * - den Abgleich anstoßen: beim Start, wenn die App in den Vordergrund kommt,
 *   und in Abständen, solange sie sichtbar ist,
 * - nach einem Abgleich die Queries neu laden, damit die Oberfläche zeigt, was
 *   inzwischen aus dem Heimnetz gekommen ist.
 */

/** Abstand zwischen zwei Abgleichen, solange die App im Vordergrund ist */
const SYNC_INTERVAL_MS = 30_000;

type OfflineContextValue = {
  status: SyncStatus | null;
  /** Steht der Offline-Betrieb auf diesem Gerät zur Verfügung? */
  available: boolean;
  syncNow: () => void;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const available = offlineUnsupportedReason() === null;

  // Identität weiterreichen, sobald sie feststeht — und beim Abmelden löschen.
  useEffect(() => {
    if (!available || user === undefined) return;
    void postToWorker({
      type: "ff:identity",
      user: user
        ? {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            color: user.color,
          }
        : null,
    });
  }, [available, user]);

  useEffect(() => {
    if (!available) return;
    return onWorkerMessage(message => {
      if (message.type === "ff:status") setStatus(message.status);
      // Der Abgleich hat lokale Daten verändert. Welche, weiß die Oberfläche
      // nicht — und muss sie auch nicht: Die Queries liegen alle im selben
      // Cache, ein vollständiges Nachladen ist hier billiger als Buchführung.
      if (message.type === "ff:data-changed")
        void queryClient.invalidateQueries();
    });
  }, [available]);

  useEffect(() => {
    if (!available || !user) return;
    syncNow("start");
    void postToWorker({ type: "ff:status?" });

    const onVisible = () => {
      if (document.visibilityState === "visible") syncNow("focus");
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") syncNow("interval");
    }, SYNC_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.clearInterval(timer);
    };
  }, [available, user]);

  const trigger = useCallback(() => syncNow("manual"), []);

  return (
    <OfflineContext.Provider value={{ status, available, syncNow: trigger }}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error("useOffline muss innerhalb von OfflineProvider stehen");
  }
  return ctx;
}
