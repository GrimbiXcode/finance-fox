# AGENTS.md — Finance Fox

Hinweise für KI-Coding-Agenten. Projekt-README: `README.md` (Deutsch).

## Projektüberblick

Self-gehostete Full-Stack-Webapp zur Organisation der Finanzen eines Haushalts
mit einer oder mehreren Personen. Alle Daten liegen in einer einzigen
**SQLite-Datei auf dem eigenen Server**. Funktionen: Dashboard, Transaktionen
(Einnahmen/Ausgaben/Umbuchungen), Konten, Budgets, Kostenaufteilung (Splits),
wiederkehrende Buchungen (Cron-Job), Sparziele, Prognosen, Benutzerverwaltung
mit Ersteinrichtungs-Wizard und Einladungslinks.

UI-Texte, Kommentare und Doku sind auf **Deutsch** — neue Kommentare,
Fehlermeldungen und UI-Strings ebenfalls auf Deutsch verfassen.

## Technologie-Stack

- **Frontend**: React 19 + TypeScript + Vite 7 + Tailwind CSS 3 + shadcn/ui
  (Radix-Primitives in `src/components/ui/`) + Recharts, React Router 8,
  TanStack Query
- **Backend**: Hono 4 + tRPC 11 (End-to-end typisiert über `AppRouter`),
  Superjson als Transformer, Zod 4 für Input-Validierung
- **Datenbank**: SQLite über **sql.js (WebAssembly)** mit Drizzle ORM —
  bewusst kein natives Modul (kein Compile-Step, läuft überall).
  `better-sqlite3` ist nur eine devDependency; im Build wird es per
  esbuild-Alias durch `db/stubs/better-sqlite3-stub.cjs` ersetzt.
- **Auth**: E-Mail/Passwort (bcryptjs), Session via HMAC-signiertem
  HttpOnly-Cookie `hh_session` (30 Tage, `api/lib/session.ts`) — kein JWT-Paket.
- **Hintergrundjobs**: node-cron (täglich 03:00 Uhr + einmalig beim Start:
  Verbuchung fälliger wiederkehrender Transaktionen, `api/lib/recurringJob.ts`)
- **Node.js 26** (Docker-Basisimage `node:26-bookworm-slim`; lokal via `.nvmrc` —
  bei nvm/FNM/volta o.ä. automatisch, sonst `nvm use` ausführen)

## Befehle

```bash
npm install
npm run db:push      # Schema via drizzle-kit in die DB-Datei schreiben (dev)
npm run dev          # Vite-Dev-Server, http://localhost:3000 (Frontend + API mit HMR)
npm run check        # Type-Check: tsc -b (alle drei tsconfig-Projekte)
npm run lint         # ESLint
npm run format       # Prettier --write .
npm run test         # vitest run (aktuell gibt es noch keine Testdateien)
npm run build        # Frontend (dist/public) + Server-Bundle (dist/boot.js via esbuild)
npm start            # NODE_ENV=production node dist/boot.js (Port: $PORT, Default 3000)
```

Vor Fertigstellung einer Änderung immer `npm run check` und `npm run lint`
laufen lassen.

## Code-Organisation

```
api/            Backend (Hono + tRPC), Einstieg: api/boot.ts
  router.ts       appRouter: { ping, auth, finance, forecast }
  middleware.ts   tRPC-Setup: publicQuery / authedQuery / adminQuery
  context.ts      TrpcContext, Session-User aus Cookie
  authRouter.ts   Setup-Wizard, Login, Einladungen, Passwort-Reset
  financeRouter.ts  Konten, Transaktionen, Kategorien, Budgets, Splits, Sparziele
  forecastRouter.ts Prognosen
  lib/            env.ts, session.ts, migrate.ts (ensureSchema), recurringJob.ts,
                  http.ts, vite.ts (statische Auslieferung in Produktion)
  queries/connection.ts  sql.js-DB mit better-sqlite3-kompatiblem Proxy,
                  initDb() / getDb() / markDirty()
contracts/      Geteilte Typen/Errors zwischen Front- und Backend (@contracts/*)
db/             schema.ts (Drizzle-Tabellen), relations.ts, seed.ts,
                migrations/ (drizzle-kit), stubs/ (better-sqlite3-Stub fürs Bundle)
src/            Frontend (React)
  App.tsx         Routing (deutsche Pfade: /transaktionen, /konten, ...)
  pages/          Eine Komponente pro Seite (Dashboard, Transactions, ...)
  components/     Layout.tsx, TransactionDialog.tsx, ui/ (shadcn/ui, nicht von
                  Hand umschreiben — via shadcn generiert)
  providers/      trpc.tsx (tRPC + QueryClient), auth.tsx
  lib/            finance.ts (Berechnungen, Cent-Helfer), data.ts, utils.ts (cn)
```

Wichtige Konventionen:

- **Geldbeträge immer in Cent als Integer** speichern und rechnen. Frontend:
  `formatCents` / `parseEuro` in `src/lib/finance.ts`. Datumsformat in der DB:
  Text `YYYY-MM-DD`.
- **Währung**: haushaltsweite Einstellung, gespeichert in der Tabelle
  `app_settings` (Key `currency`, ISO-4217-Code, Default `EUR`); Änderung nur
  durch Admins (Einstellungen-Seite, `finance.setCurrency`). Die 20
  unterstützten Währungen stehen in `contracts/types.ts` (`CURRENCIES`).
  Frontend: `formatCents` / `currencySymbol` in `src/lib/finance.ts` nutzen
  die App-Währung als Default; das Layout lädt sie via
  `finance.getAppSettings` und setzt sie mit `setAppCurrency`.
- Path-Aliase: `@/*` → `src/*`, `@contracts/*` → `contracts/*`,
  `@db/*` → `db/*` (in tsconfig und `vite.config.ts` konsistent halten).
- Der Frontend-Client importiert den Typ `AppRouter` direkt aus
  `api/router.ts` (`src/providers/trpc.tsx`) — Typänderungen im Router wirken
  sich sofort auf den Client aus.
- Alle fachlichen Endpunkte nutzen `authedQuery` (Login erforderlich);
  Admin-only über `adminQuery`. Deutsche `TRPCError`-Meldungen.
- Einladungs-/Reset-Links sind Hash-Routen (`#/einladung/<token>`,
  `#/reset/<token>`) und werden im Server-Log ausgegeben (kein E-Mail-Versand).

## Datenbank & Persistenz

- Die DB läuft als sql.js-In-Memory-Datenbank; nach Schreiboperationen wird
  sie als Datei exportiert (`DATABASE_URL`, Default
  `file:./data/finance-fox.db`; `:memory:` für Tests möglich).
  Flush via `scheduleFlush()` in `api/queries/connection.ts` (setImmediate +
  2-s-Debounce + SIGINT/SIGTERM-Handler).
- `initDb()` muss einmalig vor DB-Zugriffen awaited werden (in `api/boot.ts`
  bereits erledigt), danach synchron via `getDb()`.
- Schema-Quelle der Wahrheit ist `db/schema.ts`. `api/lib/migrate.ts`
  (`ensureSchema`) enthält dasselbe Schema als `CREATE TABLE IF NOT EXISTS`
  und läuft bei jedem Serverstart — bei Schemaänderungen **beide Stellen**
  aktualisieren. Für bestehende Installationen gilt: `ensureSchema` ist
  idempotent, aber nicht-migrierend; Änderungen an bestehenden Tabellen
  brauchen eine eigene Migration (drizzle-kit, `npm run db:generate`).

## Testing

- Vitest (`npm run test`), Umgebung `node`, Include-Pattern
  `api/**/*.test.ts` / `api/**/*.spec.ts` (siehe `vitest.config.ts`).
  Aktuell existieren keine Tests — neue Tests nach diesem Muster im
  `api/`-Verzeichnis ablegen. Aliase `@/`, `@contracts/`, `@assets/` sind
  konfiguriert; `DATABASE_URL=file::memory:` für isolierte DB-Tests nutzen.
- ESLint: typescript-eslint recommended + react-hooks + react-refresh
  (`eslint.config.js`, flat config).

## Code-Stil

- Prettier (`.prettierrc`): Semikolons, doppelte Anführungszeichen, 2 Spaces,
  printWidth 80, `arrowParens: "avoid"`, LF.
- TypeScript strict, ES-Modules (`"type": "module"`), Target ES2022.
- Drei tsconfig-Projekte: `tsconfig.app.json` (src), `tsconfig.server.json`
  (api/contracts/db), `tsconfig.node.json` (Config-Dateien); `npm run check`
  baut alle per Project-References.

## Deployment

- **Docker (empfohlen)**: `docker compose up -d --build` → App auf Port 8080
  (Container-intern 3000). Multi-Stage-Build: `npm ci` + `npm run build`,
  Runtime kopiert nur `node_modules`, `dist/`, `package.json`.
  Datenbank im Volume `finance-fox-data` (`/app/data`).
  Hinweis: Im Container sind npm-Install-Skripte blockiert — das funktioniert,
  weil sql.js keine nativen Module braucht.
- **Ohne Docker**: `npm ci && npm run build && JWT_SECRET=... PUBLIC_URL=... npm start`.

## Security Considerations

- `JWT_SECRET` (HMAC-Secret für Sessions) in Produktion **immer** per
  Env-Variable setzen — der Default in `api/lib/env.ts` ist nur für
  Entwicklung.
- `PUBLIC_URL` korrekt setzen, sonst zeigen Einladungs-/Reset-Links ins Leere.
- Environment-Variablen: `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_URL`, `PORT`,
  `NODE_ENV`. Achtung: `.env.example` ist veraltet (stammt aus einem Template,
  nennt MySQL/APP_ID) — die tatsächlich verwendeten Variablen stehen in
  `api/lib/env.ts` und `docker-compose.yml`.
- Session-Cookie: HttpOnly, SameSite=Lax. Das `Secure`-Flag richtet sich nach
  `PUBLIC_URL` (https:// → Secure), überschreibbar per `COOKIE_SECURE=true|false`
  — so funktioniert der Login auch über HTTP im Heimnetz.
  Passwörter mit bcryptjs gehasht.
- Keine externen Dienste: Einladungslinks nur im Server-Log, kein
  E-Mail-Versand, keine Telemetrie.
- Request-Body-Limit: 50 MB (`api/boot.ts`).
