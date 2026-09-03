import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, splitLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import {
  TRPC_LIVE_PATH,
  TRPC_LOCAL_PATH,
  isOnlineOnlyProcedure,
} from "@contracts/offline";

export const trpc = createTRPCReact<AppRouter>();

export const queryClient = new QueryClient();

function link(url: string) {
  return httpBatchLink({
    url,
    transformer: superjson,
    fetch(input, init) {
      return globalThis.fetch(input, {
        ...(init ?? {}),
        credentials: "include",
      });
    },
  });
}

const trpcClient = trpc.createClient({
  links: [
    /**
     * Zwei Leitungen zum selben Router.
     *
     * Alles Fachliche läuft über `/api/trpc`; auf Geräten mit Offline-Betrieb
     * beantwortet das der Service Worker aus der lokalen Replik — online wie
     * offline, damit es nur einen Codepfad gibt.
     *
     * Anmeldung, Verwaltung, Backup und der Abgleich selbst brauchen dagegen
     * den Server und gehen über `/api/trpc/live` immer ans Netz. Welche
     * Prozeduren das sind, steht in `contracts/offline.ts` — dieselbe Liste
     * benutzt der Worker als Sicherheitsnetz.
     */
    splitLink({
      condition: op => isOnlineOnlyProcedure(op.path),
      true: link(TRPC_LIVE_PATH),
      false: link(TRPC_LOCAL_PATH),
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
