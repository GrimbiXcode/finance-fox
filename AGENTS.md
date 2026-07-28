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
api/            Backend (Hono + tRPC), Einstieg: api/boot.ts (enthält auch die
                Admin-Binärrouten GET /api/backup und POST /api/backup/restore
                sowie die Beleg-Routen POST/GET/DELETE /api/attachments*)
  router.ts       appRouter: { ping, auth, finance, forecast }
  middleware.ts   tRPC-Setup: publicQuery / authedQuery / adminQuery
  context.ts      TrpcContext, Session-User aus Cookie
  authRouter.ts   Setup-Wizard, Login, Einladungen, Passwort-Reset
  financeRouter.ts  Konten (inkl. Besitz/Sichtbarkeit, Kontotypen, Banken),
                  Transaktionen (inkl. CSV-Export/-Import), Kategorien, Tags,
                  Budgets, Splits, Projekte, Aufteilungsvorlagen, Sparziele
  forecastRouter.ts Prognosen
  lib/            env.ts, session.ts, migrate.ts (ensureSchema), recurringJob.ts,
                  accountAccess.ts (Sichtbarkeits-/Bearbeitungsrechte für Konten:
                  Gemeinschaftskonto vs. privat, serverseitige Prüfung),
                  accountTypes.ts (IBAN-Normalisierung/-Validierung, Existenz-
                  prüfung für Kontotyp-Keys und Banken),
                  csv.ts (CSV-Format: Semikolon, Dezimalkomma, RFC-4180-Quoting),
                  camt.ts (camt.053-Parser: ISO-20022-XML stringbasiert,
                  namespace-agnostisch, ohne XML-Bibliothek),
                  budgets.ts (Budget-Auswertung: Zeitraum Monat/Jahr, Rollup
                  über Unterkategorien, Rollover-Rechnung — geteilt von
                  finance.listBudgetStatus und forecast.budgetForecast),
                  attachments.ts (Beleg-Dateien außerhalb der DB speichern/
                  löschen, Speicherort ATTACHMENTS_DIR),
                  goalProgress.ts (Sparziel-Fortschritt aus goal_sources:
                  Formel full/absolute/percent, Sichtbarkeitsfilter — geteilt
                  von finance.listGoals, forecast.goalForecast und den
                  Meilenstein-Benachrichtigungen),
                  http.ts, vite.ts (statische Auslieferung in Produktion)
                  audit.ts (Aktivitäts-/Audit-Log: logAudit, best effort)
  queries/connection.ts  sql.js-DB mit better-sqlite3-kompatiblem Proxy,
                  initDb() / getDb() / markDirty()
contracts/      Geteilte Typen/Errors zwischen Front- und Backend (@contracts/*),
                splitShares.ts (gewichtete Split-Verteilung sharesFromWeights)
db/             schema.ts (Drizzle-Tabellen), relations.ts, seed.ts,
                migrations/ (drizzle-kit), stubs/ (better-sqlite3-Stub fürs Bundle)
src/            Frontend (React)
  App.tsx         Routing (deutsche Pfade: /transaktionen, /konten, ...)
  pages/          Eine Komponente pro Seite (Dashboard, Transactions, ...)
  components/     Layout.tsx, TransactionDialog.tsx, AccountDialog.tsx
                  (Anlegen/Bearbeiten/Löschen von Konten inkl. Sichtbarkeits-
                  Freigaben und Gefahrenzone), CsvImportDialog.tsx
                  (CSV-Import von Transaktionen), CamtImportDialog.tsx
                  (Import von camt.053-XML-Kontoauszügen),
                  TransactionAttachmentsDialog.tsx
                  (Belege/Fotos einer Buchung: ansehen, hochladen, löschen),
                  ui/ (shadcn/ui, nicht von Hand umschreiben — via shadcn generiert)
  providers/      trpc.tsx (tRPC + QueryClient), auth.tsx
  lib/            finance.ts (Berechnungen, Cent-Helfer), data.ts, utils.ts (cn)
```

Wichtige Konventionen:

- **Geldbeträge immer in Cent als Integer** speichern und rechnen. Frontend:
  `formatCents` / `parseEuro` in `src/lib/finance.ts`. Datumsformat in der DB:
  Text `YYYY-MM-DD`.
- **Locale**: Zahlen- und Datumsformate richten sich nach der Browser-Region
  (`navigator.language`, zentral `getUserLocale()` in `src/lib/finance.ts`) —
  Dezimaltrennzeichen, Tausender und Datumsdarstellung folgen automatisch der
  Systemregion (z. B. de-DE `1.234,56` vs. de-CH `1'234.56`). `parseEuro`
  akzeptiert beide Trennzeichen und interpretiert sie locale-bewusst.
  CSV-Export nutzt für de-Locales Semikolon + Dezimalkomma, sonst Komma +
  Dezimalpunkt; der Import erkennt das Trennzeichen automatisch. Die
  UI-Sprache bleibt davon unberührt deutsch.
- **Währung**: haushaltsweite Einstellung, gespeichert in der Tabelle
  `app_settings` (Key `currency`, ISO-4217-Code, Default `EUR`); Änderung nur
  durch Admins (Einstellungen-Seite, `finance.setCurrency`). Die 20
  unterstützten Währungen stehen in `contracts/types.ts` (`CURRENCIES`).
  Frontend: `formatCents` / `currencySymbol` in `src/lib/finance.ts` nutzen
  die App-Währung als Default; das Layout lädt sie via
  `finance.getAppSettings` und setzt sie mit `setAppCurrency`.
- **CAMT.053-Import**: `finance.importCamt` importiert ISO-20022-XML-
  Kontoauszüge (max 10 MB, `edit`-Recht nötig) auf ein Konto — Gutschriften
  als Einnahmen, Belastungen als Ausgaben (ohne Kategorie), Notiz aus
  Gegenpartei + Verwendungszweck. Dubletten-Schutz über die Kombination
  Konto/Datum/Betrag/Notiz; Rückgabe `{imported, duplicates, errors}` analog
  zum CSV-Import. Parser in `api/lib/camt.ts` (stringbasiert, namespace-
  agnostisch, ohne XML-Bibliothek), UI: CamtImportDialog.tsx auf der
  Transaktionen-Seite.
- **Benachrichtigungen (opt-in)**: Versand via ntfy und/oder generischem
  Webhook, zentral `sendNotification` in `api/lib/notify.ts` (Konfiguration in
  `app_settings`: `notify_ntfy_url`, `notify_webhook_url`, `notify_events` —
  Admin-Endpunkte `finance.getNotifySettings`/`setNotifySettings`/
  `sendTestNotification`). Nur http/https-URLs; Versandfehler werden nur
  geloggt, nie den Hauptflow brechen. Trigger: Budget-Kipppunkt >100 % in
  `finance.createTransaction`, Sammelmeldung am Ende von `runRecurringJob`,
  Sparziel-Meilensteine (25/50/75/100 %, ungefilterter Haushalts-
  Gesamtfortschritt vor/nach) in `finance.createTransaction` (Buchung auf
  einem ziel-verknüpften Konto) und `finance.addGoalSource`.
- **Kontoabgleich**: `finance.reconcileAccount` bucht die Differenz zwischen
  Ist- und berechnetem Soll-Saldo (Logik wie `listAccounts`) als Korrektur-
  buchung ohne Kategorie (Einnahme/Ausgabe, erfordert `edit`); bei Differenz 0
  wird nichts gebucht. UI: Sektion „Kontoabgleich" im AccountDialog
  (Bearbeiten-Modus).
- **Saldo-Verlauf**: `finance.accountBalanceHistory` (erfordert `view`)
  liefert pro Konto eine sparsame Punkteserie `[{date, balance}]`:
  Startpunkt (Zeitraum-Beginn mit Saldo aus allen früheren Buchungen),
  jeder Tag mit Saldo-Änderung, Endpunkt heute — Vorzeichenlogik wie
  `listAccounts`; zukünftige Buchungen bleiben außen vor. Input `months`
  (3/6/12, Default 12; 0 = komplette Historie ab erster Buchung). UI:
  aufklappbarer Bereich „Saldo-Verlauf" pro Konto-Karte auf der
  Konten-Seite (Zeitraum-Wahl + recharts-AreaChart, Query nur bei
  geöffnetem Zustand). Tests: `api/balanceHistory.test.ts`.
- **Sparziel-Quellen (Sparziele 2.0)**: Tabelle `goal_sources` (goalId,
  accountId, mode `full`/`absolute`/`percent`, value NULL bzw. Cent > 0
  bzw. 1–100, createdAt) — max. EINE Quelle pro Konto und Ziel (Duplikat →
  CONFLICT). Fortschrittsformel pro Quelle (Saldo wie `listAccounts`):
  full `max(0, saldo)`, absolute `min(value, max(0, saldo))`, percent
  `round(max(0, saldo) × value / 100)`; Gesamt = Σ sichtbarer Quellen +
  `savedAmount` + Σ Beiträge (Alt-Bestand „Manuell (Bestand)"). Zentrale
  Logik in `api/lib/goalProgress.ts` (`accountBalances`,
  `computeGoalProgress(db, user | null, goal)` — `user null` = ungefilterte
  Systemperspektive für Benachrichtigungen, sonst nur Quellen mit
  sichtbarem Konto, `hasHiddenSources` ohne Betrags-/Namens-Leak); geteilt
  von `finance.listGoals` (liefert `totalSaved`, `percent`, `sources[]`,
  `hasHiddenSources`), `forecast.goalForecast` und den Meilenstein-
  Benachrichtigungen. Endpunkte `finance.addGoalSource` (Ziel existiert,
  `view` aufs Konto, Modus-Validierung, Meilenstein-Vergleich) /
  `deleteGoalSource` (`view` aufs verknüpfte Konto). **Gesperrt**:
  `updateGoalSaved` und `addGoalContribution` → BAD_REQUEST („Manuelle
  Einzahlungen sind nicht mehr möglich — verknüpfe das Sparziel mit einem
  Konto."); `listGoalContributions` bleibt für den Bestand lesbar.
  `forecast.goalForecast` simuliert pro Ziel monatlich (max. 120 Monate)
  die Salden der verknüpften Konten mit den wiederkehrenden Buchungen
  (Vorgehen wie `forecast.balance` inkl. Sichtbarkeitsfilter): ETA =
  erster Monat mit Fortschritt ≥ Ziel (sonst null), `monthlyRate` =
  Ø Fortschrittsänderung der nächsten 3 simulierten Monate. Kaskaden:
  `deleteGoal`, `deleteAccount` und `resetFinanceData` löschen Quellen mit.
  UI: `src/pages/Goals.tsx` (gestapelter Herkunfts-Balken, Herkunfts-
  Zeilen „Konto — Modus → Betrag" + „Manuell (Bestand)", Hinweis
  „Enthält verborgene Quellen", Prognose-Zeile, Quellen-Verwaltung per
  Dialog). `finance.updateGoal` ändert die Stammdaten (Name, Zielbetrag,
  Farbe, Stichtag — null = entfernen) ohne Meilenstein-/Prognose-Trigger;
  Anlegen/Bearbeiten/Löschen laufen über `src/components/GoalDialog.tsx`
  (Muster AccountDialog, Löschen nur in der Gefahrenzone des Edit-Dialogs
  mit AlertDialog-Bestätigung). Tests: `api/goalSources.test.ts`.
- **Offene Sparziele (ohne Zielbetrag)**: `savings_goals.target_amount` ist
  nullable — NULL = offenes Ziel, der Fortschritt zeigt dann nur den
  angesparten Betrag. `createGoal`/`updateGoal` nehmen `targetAmount`
  nullish entgegen (gesetzt weiterhin positiv); `listGoals` liefert
  `percent: null`, Meilenstein-Benachrichtigungen und ETA/remaining in
  `forecast.goalForecast` entfallen (Guards an den
  computeGoalProgress-Aufrufern bzw. in `notifyGoalMilestones`).
  Bestands-DBs: guardierte Tabellen-Neuerstellung in `ensureSchema`
  (PRAGMA notnull-Flag, NOT NULL lässt sich per ALTER nicht entfernen).
  UI: GoalDialog (Zielbetrag leer = offen), Zielkarte mit „offenes
  Ziel"-Badge statt Balken/Prozent/Prognose, Forecasts-Seite ohne
  ETA-Anzeige. Tests: `api/openGoals.test.ts`.
- **Sparziel-Beiträge (Alt-Bestand)**: Tabelle `goal_contributions`
  (goalId, userId, amount in Cent positiv, note, createdAt) — seit
  Sparziele 2.0 schreibgeschützt (keine neuen Beiträge mehr möglich, siehe
  oben); zählt zusammen mit `savings_goals.savedAmount` als Herkunft
  „Manuell (Bestand)" in den Fortschritt. Lesen über
  `finance.listGoalContributions` (mit Name/Farbe des Zahlers), Löschen
  weiterhin via `deleteGoalContribution` (nur eigener Beitrag oder Admin).
  `deleteGoal` und `resetFinanceData` löschen Beiträge kaskadierend mit.
- **2FA/TOTP (opt-in pro Benutzer)**: RFC 6238 (SHA1, 30 s, 6 Stellen) ohne
  Bibliothek über node:crypto in `api/lib/totp.ts` (Base32, generateSecret,
  totpCode, verifyTotp mit ±1-Fenster, otpauth-URL). `users.totpSecret`/
  `totpEnabled`; Endpunkte `auth.setupTotp`/`enableTotp`/`disableTotp`
  (Deaktivieren nur mit Passwort). Bei aktiviertem TOTP liefert `auth.login`
  kein Cookie, sondern `{requiresTotp, totpToken}` — kurzlebiger
  `auth_tokens`-Eintrag mit purpose `totp` (5 Min., einmalig, auch falscher
  Code verbraucht ihn); `auth.verifyTotpLogin` setzt dann das Session-Cookie.
  `auth.me` liefert `totpEnabled`. Login-Seite zweistufig (InputOTP),
  Verwaltung in den Einstellungen (Sektion „Zwei-Faktor-Authentifizierung",
  QR-Code via `qrcode`-Paket als Data-URL).
- **Projekte (Kostenaufteilung)**: Tabelle `projects` (Name unique, Farbe);
  `transactions.projectId` NULL = laufender Haushalt, sonst Projekt-Buchung
  (z. B. Urlaub). Endpunkte `finance.listProjects`/`createProject`/
  `deleteProject` — Löschen gesperrt (CONFLICT mit Anzahl), solange Buchungen
  referenzieren. `createTransaction` nimmt optional `projectId` (Existenz wird
  geprüft). Die Splitting-Seite filtert Salden, Ausgleichsvorschläge und die
  Liste geteilter Ausgaben pro Projekt (Chips: Alle / Haushalt / je Projekt);
  verbuchte Ausgleiche übernehmen das gewählte Projekt. Verwaltung (Anlegen
  mit Farbpalette, Löschen) in der Sektion „Projekte & Vorlagen" auf der
  Splitting-Seite; Projekt-Select im Details-Bereich des TransactionDialog.
- **Aufteilungsvorlagen**: Tabelle `split_templates` (Name unique, `shares`
  als JSON-Text `[{userId, weight}]`, Gewichte positiv, userIds validiert).
  Endpunkte `finance.listSplitTemplates`/`createSplitTemplate`/
  `deleteSplitTemplate`. Die gewichtete Verteilung rechnet
  `sharesFromWeights` in `contracts/splitShares.ts` (Rundung auf Cent,
  Restdifferenz auf dem ersten Anteil) — geteilt zwischen Frontend und Tests.
  UI: Vorlagen-Select im Split-Bereich des TransactionDialog (gespeicherte
  Vorlagen + Schnellwahl 60/40, 70/30 zwischen aktuellem User und erstem
  weiteren Mitglied), „Als Vorlage speichern" aus den aktuellen Anteilen;
  Löschen in der Sektion „Projekte & Vorlagen" auf der Splitting-Seite.
- **Tags/Labels**: Tabellen `tags` (Name unique, Farbe) und
  `transaction_tags` (Unique-Index (transactionId, tagId)) — mehrere Tags pro
  Buchung, haushaltsweit (keine Konto-Bindung, keine Sichtbarkeitslogik; die
  Buchungsfilter über die Kontorechte greifen wie bisher). Endpunkte
  `finance.listTags`/`createTag` (Name getrimmt, Duplikat case-insensitiv
  CONFLICT; Farbe automatisch = am seltensten verwendete Farbe der Palette
  `TAG_COLORS` in `contracts/types.ts`)/`deleteTag` (löst Zuordnungen still
  mit auf — bewusst KEIN CONFLICT, Tags sind leichtgewichtig)/
  `setTransactionTags` (Ersetzen-Semantik, erfordert `edit` auf dem
  Buchungskonto). `createTransaction` nimmt optional `tagIds`,
  `listTransactions` liefert pro Buchung `tags: [{id, name, color}]` gebatcht.
  Kaskaden: deleteTransaction/deleteAccount/resetFinanceData räumen
  `transaction_tags` ab (Reset löscht auch die Tags selbst). Audit:
  `tag.created`/`tag.deleted`/`transaction.tags`. UI: Tag-Auswahl +
  Inline-Anlage im Details-Bereich des TransactionDialog, Badges +
  Tag-Filter + Tag-Popover zum nachträglichen Taggen in der
  Transaktionsliste (Tag-Namen sind Teil des Such-Haystacks), Verwaltung
  als Card „Tags" in den Einstellungen. Tests: `api/tags.test.ts`.
- **Buchungen bearbeiten (Änderungshistorie)**: `finance.updateTransaction`
  nimmt partielle Updates entgegen (undefined = unverändert, bei
  categoryId/toAccountId/projectId zusätzlich null = entfernen; Splits/Tags
  werden ersetzt, wenn mitgegeben). Die Buchungsart **type ist
  unveränderlich** (dafür löschen + neu anlegen) und nicht Teil des Inputs.
  Rechte: „edit" auf dem aktuellen Konto, beim Verschieben (accountId-
  Wechsel) zusätzlich „edit" auf dem Zielkonto; Validierung wie
  createTransaction (Splits-Summe = Betrag, Kategorie/Projekt/Tags
  existieren, Zielkonto ≠ Quellkonto), Budget-Kipp-Prüfung analog
  createTransaction. Jede echte Änderung landet als Eintrag in
  `transaction_changes` (transactionId, userId, comment Default '',
  changes = JSON-Text `[{field, from, to}]` — serverseitiges Feld-Diff mit
  aufgelösten Namen für Kategorie/Konto/Projekt/Person, Beträge in Cent,
  Splits/Tags als lesbare Kurzform); ohne Änderung kein Eintrag (ein
  Kommentar allein erzeugt keinen). Audit `transaction.updated` nur bei
  echter Änderung. Lesen über `finance.listTransactionChanges`
  („view"-Recht, absteigend, userName/userColor-Join, changes geparst);
  `listTransactions` liefert pro Buchung `changeCount` (batched).
  Kaskaden: deleteTransaction/deleteAccount/resetFinanceData räumen
  transaction_changes ab. UI: Edit-Modus im TransactionDialog (Prop
  `transaction`, Art-Wahl deaktiviert mit title-Hinweis,
  Änderungskommentar-Feld im Details-Bereich, Hinweis bei Dauerbuchungs-
  Instanzen, Belege nur im Create-Modus), Stift-Button in der
  Transaktionsliste (nur bei „edit", Remount-Key aus changeCount/tags),
  „bearbeitet"-Badge bei changeCount > 0 öffnet den Änderungsverlauf-
  Dialog (`src/components/TransactionHistoryDialog.tsx`, deutsches
  Feldnamen-Mapping, formatCents/formatDate, Kommentar kursiv).
  Tests: `api/transactionEdit.test.ts`.
- **Buchungen stornieren**: `transactions.stornoOfId` (die Storno-Buchung
  zeigt aufs Original; guardiertes ALTER in `ensureSchema`).
  `finance.reverseTransaction` ({id, note?}, „edit" aufs Buchungskonto)
  legt eine Gegenbuchung mit heutigem Datum an: Ausgabe → Einnahme,
  Einnahme → Ausgabe, Umbuchung mit getauschten Konten; Betrag/Kategorie/
  Projekt/Person/Splits wie im Original, Notiz = note-Input oder
  „Storno: <Originalnotiz>". Guards: bereits storniert bzw. Storno-Buchung
  selbst → CONFLICT. Original und Gegenbuchung bleiben sichtbar (Badges
  „Storniert"/„Storno", abgeschwächt). Damit sich die Aufteilungs-Wirkung
  exakt aufhebt, zählen in `memberBalances` (src/lib/finance.ts) Einnahmen
  MIT Splits umgekehrt wie Ausgaben. Audit `transaction.reversed`. Löschen
  UND Stornieren laufen in der Transaktionsliste über AlertDialoge, die den
  konkreten Saldo-Effekt erklären. Tests: `api/transactionReverse.test.ts`.
- **Schnellerfassung**: `src/components/QuickAddDialog.tsx` (Button „Schnell"
  im Layout-Header) bucht eine Ausgabe mit nur Betrag + Notiz; Defaults:
  erstes Konto mit `access === "edit"`, zuletzt verwendete Ausgaben-Kategorie,
  heutiges Datum, aktueller User.
- **Jahresvergleich**: `finance.yearComparison` liefert pro Ausgaben-
  Oberkategorie (Unterkategorien aufgerollt, Sichtbarkeitsfilter) die Summen
  von Jahr und Vorjahr; Ausgaben ohne Kategorie als Zeile `categoryId: null`.
  UI: Seite `src/pages/YearReview.tsx` unter `/auswertung` (Nav „Auswertung").
- **Geldfluss-Visualisierung**: Seite `src/pages/MoneyFlow.tsx` unter
  `/geldfluss` (Nav „Geldfluss" nach „Konten") stellt Konten als Knoten und
  Dauerbuchungen als gerichtete Kanten dar (rein frontendseitig aus
  `listAccounts`/`listRecurring`). Die reine Funktion `buildMoneyFlow` in
  `src/lib/moneyflow.ts` baut den Graphen im Sankey-Stil: Spalten-Layout
  (`layoutColumns` — links Einnahmen-Block, Mitte Konten in 1 Spalte bis 6,
  2 Spalten ab 7, 3 Spalten ab 15, rechts Ausgaben-Block; Y-Positionen
  gleichmäßig, Container-Höhe wächst mit der Kontenzahl und wird als
  `heightPx` geliefert, die Seite scrollt). Sortierung zur
  Kreuzungsminimierung: Hauptfluss (Einnahmen-Empfänger oben,
  Ausgaben-Zahler unten) plus ein sequenzieller Barycenter-Pass, der
  Transfer-Partner benachbart zieht. Beträge auf Monat normalisiert
  (wöchentlich × 52/12, jährlich ÷ 12, gerundet); Linienstärke kontinuierlich
  proportional zum Betrag (`width`, 2–18 px linear auf das Maximum),
  pausierte Dauerbuchungen gestrichelt. Die Pseudo-Knoten Einnahmen/Ausgaben
  sind Blöcke im Konto-Karten-Format mit den Monatssummen
  (`incomeTotal`/`expenseTotal`). Darstellung in
  `src/components/MoneyFlowChart.tsx`: SVG-S-Kurven (kubische Bezier,
  Kontrollpunkte auf halbem Weg; Kanten innerhalb einer Spalte weichen als
  Bogen zur Seite aus) mit Arrowhead-Markern und Label-Badges auf der Kurve
  (Position `labelT`: parallele Kanten gleicher Quelle bzw. gleichen Ziels
  werden entlang der Kurve gestaffelt — Quell-Gruppen Richtung Ziel,
  Ziel-Gruppen Richtung Quelle, dicke Kanten zentraler; ab 5 Geschwistern
  kompaktes Badge via `labelCompact`),
  darüber absolut positionierte HTML-Knoten (Positionen in Prozent);
  Hover auf einen Knoten hebt seine Kanten hervor. Konten ohne jede Kante
  (pausierte Dauerbuchungen zählen als Verbindung) fliegen aus dem Diagramm:
  `buildMoneyFlow` liefert sie als `unconnected`, Layout/Höhenformel rechnen
  nur mit den verbundenen Konten, und die Seite zeigt sie in einer abgesetzten
  Card „Ohne Geldflüsse" unterhalb der Grafik (flex-wrap, gleiches
  Karten-Design via `MoneyFlowAccountCard`). Die endgültige Label-Position
  (`labelX`/`labelY`) ermittelt `assignLabelPositions` nach `assignLabelT`
  als Repulsion-Pass über einem Kollisionsmodell aus achsenparallelen
  Rechtecken in geschätzten Pixeln (`nodeRectPx`/`labelRectPx`, angenommene
  Container-Breite 1000 px): Start auf der Kurve bei `labelT`, bei Kollision
  mit einer Karten- oder bereits platzierten Label-Box iterative Verschiebung
  senkrecht zur Kurventangente (plus rein horizontal — Kurvenenden haben
  waagrechte Tangenten) in den freien Raum, beide Seiten (zuerst weg vom
  näheren Endknoten), wachsender Offset, `t` lokal ±0,05, Clamping im
  Container; Karten-Überlappung zählt vierfach, Fallback ist die Position
  mit der geringsten Überlappung. `edgeGeometry` (Pfad, Punkt, Tangente)
  liegt in `src/lib/moneyflow.ts` und wird vom Chart importiert.
- **Szenario-Planung**: `forecast.balance` nimmt optional `incomePct`
  (Skalierung der wiederkehrenden Einnahmen in %, 100 = unverändert, 50–200)
  und `excludeCategoryId` entgegen. Das Szenario wirkt NUR auf zukünftige
  wiederkehrende Größen: Einnahmen werden skaliert, wiederkehrende Ausgaben
  der gewählten Oberkategorie inkl. Unterkategorien entfallen; Historie,
  Ist-Buchungen und variable Durchschnitte bleiben unverändert. Die Antwort
  enthält die wirksamen Parameter im Feld `scenario`. UI: „Szenario"-Card
  auf der Prognosen-Seite (Slider + Kategorie-Select, Badge bei aktivem
  Szenario). Tests: `api/scenario.test.ts`.
- Path-Aliase: `@/*` → `src/*`, `@contracts/*` → `contracts/*`,
  `@db/*` → `db/*` (in tsconfig und `vite.config.ts` konsistent halten).
- Der Frontend-Client importiert den Typ `AppRouter` direkt aus
  `api/router.ts` (`src/providers/trpc.tsx`) — Typänderungen im Router wirken
  sich sofort auf den Client aus.
- Alle fachlichen Endpunkte nutzen `authedQuery` (Login erforderlich);
  Admin-only über `adminQuery`. Deutsche `TRPCError`-Meldungen.
- **Aktivitäts-/Audit-Log**: Tabelle `audit_log` (userId NULL = System bzw.
  Vorgänge vor dem Login, action nach Konvention `<entity>.<verb>` wie
  `transaction.created`, entity, entityId, kurzes deutsches Detail — niemals
  Passwörter/Codes/Tokens). Schreiben über `logAudit` aus `api/lib/audit.ts`
  (best effort, fängt Fehler intern ab; akzeptiert db- wie tx-Handle, damit
  der Eintrag im selben Transaktionskontext landet). Instrumentiert sind die
  fachlichen Mutationen in `financeRouter.ts` (Konten, Kategorien, Buchungen
  inkl. CSV-/CAMT-/Komplett-Import, Tags, Budgets, Dauerbuchungen, Sparziele
  inkl. Beiträge, Projekte, Aufteilungsvorlagen, Kontoabgleich, Reset,
  Währung, Benachrichtigungs-Einstellungen) und in `authRouter.ts` (Login
  Erfolg/
  Fehlschlag, Logout, TOTP-Login/-Verwaltung, Benutzer anlegen/deaktivieren/
  reaktivieren, Profil, Passwort). Lesen für alle Mitglieder über
  `finance.listAuditLog` (neueste zuerst, Limit max 500, optionaler
  entity-Filter, userName/userColor gejoint). UI: Card „Aktivitäten" am Ende
  der Einstellungen-Seite (deutsches Action-Mapping, Entity-Filter,
  „Mehr laden"). Tests: `api/auditLog.test.ts`.
- **Konten-Sichtbarkeit**: `accounts.ownerId` NULL = Gemeinschaftskonto (alle
  dürfen lesen/bearbeiten), sonst privat (Besitzer + Freigaben aus
  `account_permissions`, Admins nur lesend). Zugriffsprüfung immer
  serverseitig über die Helper in `api/lib/accountAccess.ts`
  (`requireAccountAccess`, `visibleAccountIds`) — nicht nur im Frontend
  ausblenden. Abfragen (Konten, Transaktionen, Recurring, Prognosen) sind
  pro anfragendem Nutzer gefiltert.
- **Wiederkehrende Umbuchungen**: `recurring.type` kann auch `transfer` sein
  (Dauerauftrag zwischen Konten) — dann ist `recurring.to_account_id` gesetzt
  (Pflicht, ≠ `account_id`, Kategorie irrelevant). Rechte wie bei Buchungen:
  `edit` aufs Quellkonto, mindestens `view` aufs Zielkonto; Sichtbarkeit in
  `listRecurring`/Prognose, wenn Quell- ODER Zielkonto sichtbar ist. In der
  Saldo-Prognose sind Transfers zwischen zwei sichtbaren Konten neutral, bei
  nur einer sichtbaren Seite wirken sie als Ab-/Zufluss (nicht in
  `recurringIncome`/`recurringExpense`).
- **Dauerbuchungen bearbeiten**: `finance.updateRecurring` nimmt partielle
  Updates entgegen (undefined = unverändert, bei categoryId zusätzlich null =
  entfernen); die Art **type ist unveränderlich** (dafür löschen + neu
  anlegen). Validierung wie `createRecurring` (Betrag positiv, isoDate,
  Transfer: Zielkonto ≠ Quellkonto), Rechte: „edit" auf dem aktuellen Konto,
  bei Konto-Wechsel „edit" aufs neue, bei Transfer-Zielwechsel „view" aufs
  Ziel; der Cron-Job verbucht ab dem neuen `nextDate`. Audit
  `recurring.updated`. UI: gemeinsame Formular-Komponente in
  `src/pages/Recurring.tsx` (Anlegen + Bearbeiten-Dialog, Art-Wahl im Edit
  deaktiviert), Stift-Button nur bei „edit" aufs Konto, Filter-Zeile
  (Typ/Konto/Status) mit Zähler und Karten-/Tabellenansicht. Tests:
  `api/recurringEdit.test.ts`.
- **Dauerbuchungen mit Enddatum**: `recurring.endDate` (TEXT, nullable,
  YYYY-MM-DD) = letztes verbuchtes Vorkommen, NULL = kein Ende.
  `createRecurring`/`updateRecurring` nehmen `endDate` optional entgegen
  (Update: null = entfernen) und verlangen endDate ≥ wirksame `nextDate`
  (BAD_REQUEST). Der Cron-Job (`api/lib/recurringJob.ts`) verbucht nur
  Vorkommen ≤ endDate; `nextDate` bleibt danach auf dem ersten Vorkommen
  jenseits des Enddatums stehen (kein endloses Vorspulen). Ablauf
  (endDate < heute) = „archiviert": Badge statt Aktiv/Pausiert, abgeschwächt
  dargestellt, ans Ende sortiert (aktive nach nextDate zuerst), eigener
  Status-Filterwert; Pausieren/Bearbeiten bleibt möglich (späteres Enddatum
  „reaktiviert"). Logik in `src/lib/recurring.ts` (`isRecurringArchived`,
  `sortRecurring`). Tests: `api/recurringEndDate.test.ts`.
- **Kategorien-Hierarchie**: `categories.parentId` NULL = Oberkategorie, sonst
  Verweis auf die Oberkategorie — genau EINE Ebene (Unterkategorien dürfen
  keine Kinder haben, wird in `finance.createCategory` geprüft). Unter-
  kategorien erben Typ und Farbe der Oberkategorie; Oberkategorien mit
  Kindern können nicht gelöscht werden (CONFLICT). Das Frontend baut den
  Baum selbst (listCategories bleibt flach); das Dashboard aggregiert
  Ausgaben per `expensesByRootCategory` (src/lib/finance.ts) auf
  Oberkategorien. CSV-Import matcht Kategorien weiterhin rein per Name —
  bei Namensgleichheit gewinnt die erste passende Kategorie.
- **Budgets**: `budgets.period` = `monthly` (Kalendermonat) oder `yearly`
  (Kalenderjahr), `budgets.rollover` (nur bei monthly) überträgt unver-
  brauchtes Budget in Folgemonate, `budgets.createdAt` ist der Rollover-
  Anker (NULL bei Bestandsbudgets = 1. Januar des laufenden Jahres).
  Effektives Limit = amount × Monate-seit-Anker − Ausgaben der abgelaufenen
  Monate seit Anker, mindestens 0. Auswertung zentral in
  `api/lib/budgets.ts` (`computeBudgetStatuses`) — Ausgaben einer Budget-
  Kategorie inkl. aller Unterkategorien, mit Sichtbarkeitsfilter; genutzt
  von `finance.listBudgetStatus` (Budgets-Seite) und
  `forecast.budgetForecast`.
- **Kontotypen**: `accounts.type` speichert den KEY aus der Tabelle
  `account_types` — Builtin-Keys `checking`/`cash`/`savings` (in
  `ensureSchema` per INSERT OR IGNORE geseedet, nicht löschbar) plus
  benutzerdefinierte Typen (`custom_<zufalls-id>`). Neue Typen/Banken werden
  im Konto-Dialog angelegt (`finance.createAccountType`/`createBank`),
  verwaltet in den Einstellungen (Sektion „Kontotypen & Banken"); Löschen
  nur, wenn nicht mehr verwendet. Konten haben optional `bankId`
  (Tabelle `banks`) und `iban` (normalisiert: ohne Leerzeichen,
  Großbuchstaben — Validierung in `api/lib/accountTypes.ts`).
- Einladungs-/Reset-Links sind Hash-Routen (`#/einladung/<token>`,
  `#/reset/<token>`) und werden im Server-Log ausgegeben (kein E-Mail-Versand).
- **Dark Mode**: Umschalter im Layout-Header, via next-themes
  (`ThemeProvider` in `src/main.tsx`, `attribute="class"`, System-Default);
  die `.dark`-Variablen stehen in `src/index.css`.
- **PWA**: Grundgerüst ohne Service Worker — `public/manifest.webmanifest`
  plus Icons in `public/icons/` (Quell-SVG `icon.svg`, PNGs daraus gerendert),
  eingebunden in `index.html`.
- **UI-State in `localStorage`**: Darstellungsart der Konten-Seite
  (Karten/Tabelle) unter dem Key `ff-accounts-view`, der Dauerbuchungen-Seite
  unter `ff-recurring-view`; eingeklappte Seitenleiste unter
  `ff-sidebar-collapsed`.
- **Beleg-Anhänge**: Metadaten in `transaction_attachments`, Dateien mit
  UUID-Dateinamen im Verzeichnis `ATTACHMENTS_DIR` (Default: `<DB-Verzeichnis>/attachments`,
  bei In-Memory-DB `./data/attachments`). Upload/Download/Löschen über die
  Hono-Routen in `api/boot.ts` mit Konto-Rechten (`edit` für Upload/Löschen,
  `view` für Download — via `requireAccountAccess`); erlaubt sind Bilder
  (JPEG/PNG/WebP/GIF) und PDF bis 10 MB. Kaskaden (deleteTransaction,
  deleteAccount, resetFinanceData) löschen Zeilen UND Dateien über
  `deleteAttachmentsForTransactions` aus `api/lib/attachments.ts`.

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
  aktualisieren. `ensureSchema` ist idempotent; neue Spalten an bestehenden
  Tabellen werden dort guardiert nachgerüstet (PRAGMA table_info +
  ALTER TABLE, siehe `owner_id`/`bank_id`/`iban` bei `accounts`).

## Testing

- Vitest (`npm run test`), Umgebung `node`, Include-Pattern
  `api/**/*.test.ts` / `api/**/*.spec.ts` (siehe `vitest.config.ts`).
  Bestehende Tests (z. B. `api/appSettings.test.ts`, `api/accountAccess.test.ts`)
  dienen als Muster für neue Tests im `api/`-Verzeichnis. Aliase `@/`, `@contracts/`, `@assets/` sind
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
  `ATTACHMENTS_DIR` (Beleg-Dateien, Default `<DB-Verzeichnis>/attachments`),
  `COOKIE_SECURE`, `NODE_ENV` — dokumentiert in `.env.example` und
  `docker-compose.yml`; Defaults in `api/lib/env.ts`.
- Session-Cookie: HttpOnly, SameSite=Lax. Das `Secure`-Flag richtet sich nach
  `PUBLIC_URL` (https:// → Secure), überschreibbar per `COOKIE_SECURE=true|false`
  — so funktioniert der Login auch über HTTP im Heimnetz.
  Passwörter mit bcryptjs gehasht.
- Keine externen Dienste: Einladungslinks nur im Server-Log, kein
  E-Mail-Versand, keine Telemetrie.
- Request-Body-Limit: 50 MB (`api/boot.ts`).
