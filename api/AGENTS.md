# api/AGENTS.md — Backend (Hono + tRPC)

Detail-Doku zum Backend. Übergeordnetes: `../AGENTS.md`.

## Struktur

- `boot.ts` — Einstieg (Hono); enthält auch die Admin-Binärrouten
  `GET /api/backup` und `POST /api/backup/restore` sowie die Beleg-Routen
  `POST/GET/DELETE /api/attachments*` und die Vorsorge-Anhang-Routen
  `POST/GET/DELETE /api/pension-attachments*` und die Versicherungs-Dokument-
  Routen `POST/GET/DELETE /api/insurance-attachments*` (ohne Besitzcheck —
  das Modul ist haushaltsweit). Request-Body-Limit: 50 MB.
  Nur in der Entwicklung zusätzlich `GET /api/dev/login` (passwortloser
  Login, `?as=admin|member`, `?to=<Ziel>`): montiert nur, wenn
  `NODE_ENV != production` **und** `DEV_LOGIN=1` — siehe `lib/devLogin.ts`
  und den Abschnitt „Die App selbst durchklicken" in der Root-AGENTS.md.
  Die Route stellt ein reguläres Session-Cookie aus; am Auth-Pfad
  (`getSessionUser`, `verifySessionToken`) ändert sie **nichts**.
- `router.ts` — `appRouter: { ping, auth, finance, forecast, insurance,
  mortgage, pension }`. Der
  Frontend-Client importiert den Typ `AppRouter` direkt von hier
  (`src/providers/trpc.tsx`) — Typänderungen wirken sofort auf den Client.
- `middleware.ts` — tRPC-Setup: `publicQuery` / `authedQuery` / `adminQuery`.
  Alle fachlichen Endpunkte nutzen `authedQuery` (Login erforderlich);
  Admin-only über `adminQuery`. Deutsche `TRPCError`-Meldungen.
- `context.ts` — `TrpcContext`, Session-User aus Cookie.
- `authRouter.ts` — Setup-Wizard, Login, Einladungen, Passwort-Reset.
  Einladungs-/Reset-Links sind Hash-Routen (`#/einladung/<token>`,
  `#/reset/<token>`) und landen im Server-Log (kein E-Mail-Versand).
  `auth.setQuickAccount` konfiguriert das Konto der Schnellerfassung pro
  Benutzer (`users.quick_account_id`, erfordert `edit`-Recht, null =
  automatisch); `auth.me` liefert `quickAccountId`. Tests:
  `api/quickAccount.test.ts`.
- `financeRouter.ts` — Konten (inkl. Besitz/Sichtbarkeit, Kontotypen,
  Banken), Transaktionen (inkl. CSV-Export/-Import), Kategorien, Tags,
  Budgets, Splits, Projekte, Aufteilungsvorlagen, Sparziele.
- `forecastRouter.ts` — Prognosen.
- `pensionRouter.ts` — Vorsorge-Modul (Schweizer 3-Säulen-Prinzip, siehe
  Abschnitt „Vorsorge").
- `mortgageRouter.ts` — Hypotheken-Modul (siehe Abschnitt „Hypotheken").
- `insuranceRouter.ts` — Versicherungs-Modul (siehe Abschnitt
  „Versicherungen").
- `lib/` — `env.ts`, `session.ts`, `migrate.ts` (`ensureSchema`),
  `recurringJob.ts`, `recurringSchedule.ts` (Terminrechnung der
  Dauerbuchungen — `advanceDate`/`localISO`, einzige Quelle der Wahrheit für
  Cron UND Prognose), `accountAccess.ts`, `accountTypes.ts`, `csv.ts`,
  `camt.ts`, `budgets.ts`, `attachments.ts`, `goalProgress.ts`, `http.ts`,
  `vite.ts` (statische Auslieferung in Produktion), `audit.ts`, `notify.ts`,
  `totp.ts`, `changeHistory.ts` (`buildFieldDiff` — geteiltes Feld-Diff der
  Modul-Historien), `pension/` (Vorsorge: `netSalary.ts`, `history.ts`,
  `forecastCh.ts` + `index.ts`-Factory, `accountSync.ts`), `mortgage/`
  (Hypotheken: `scheduleCh.ts` + `index.ts`-Factory, `portfolio.ts`,
  `history.ts`, `maturityNotice.ts`), `insurance/` (Versicherungen:
  `notice.ts` (Fristen-Rechnung), `gaps.ts` (Lückenanalyse) + `index.ts`-
  Factory, `history.ts`, `noticeReminder.ts`).

## Vorsorge (3-Säulen-Prinzip)

Modul in `pensionRouter.ts` (tRPC-Namespace `pension`) — **alle Daten sind
strikt privat pro Benutzer**: jede Tabelle trägt `userId`, jeder Endpunkt
scoped auf `ctx.user.id`, es gibt bewusst keine Haushalts-Sichtbarkeit.
Tabellen: `pension_profiles` (1:1, country Default "CH", birthDate,
retirementAge), `pension_salaries` (Lohn-Timeline, Unique (user_id,
valid_from) `YYYY-MM`; gültig = letzter Eintrag ≤ Monat),
`pension_deductions` (mode percent in **Basispunkten** / absolute in Cent,
active-Flag; `salary_id` NULL = global für alle Löhne, gesetzt = nur für
diesen Lohneintrag — Ersetzen-Semantik über `addSalary`/`updateSalary`
(Feld `deductions`), Kaskade beim Löschen des Lohns, Historie als
Kurzform-Diff im Feld „Abzüge" wie `tiersToText` bei den Kassen), `pension_ahv` (1:1), `pension_funds` (Säule 2, kind
pension_fund/vested_benefits, Sätze in Basispunkten; nullable
Versicherungsausweis-Felder employer, insured_salary,
coordination_deduction, buy_in_potential, disability_pension, death_benefit
— Beträge in Cent — sowie `value_date` (TEXT YYYY-MM-DD, Stichtag der
Angaben)), `pension_fund_tiers` (Sparbeitrags-Abstufungen einer
Kasse nach Alter, AN/AG-Sätze in Basispunkten; Update mit
Ersetzen-Semantik, Kaskade beim Löschen der Kasse), `pension_pillar3`
(Säule 3a, optional `accountId`-Link auf ein Finanz-Konto),
`pension_attachments`, `pension_changes` (Änderungshistorie, Muster
`transaction_changes`, deutsche Feldnamen, Beträge roh in Cent).

- **Netto-Berechnung** in `lib/pension/netSalary.ts` (`salaryForMonth`/
  `salaryEntryForMonth`, `computeNet`, `deductionsForSalary` — aktive globale
  Abzüge plus die des gültigen Lohneintrags); `pension.transferNetSalary`
  legt das aktuelle Netto als
  monatliche wiederkehrende Einnahme an (Notiz „Nettolohn (Vorsorge)",
  nextDate = 1. des Folgemonats, erfordert `edit` auf dem Konto).
- **Historie**: `lib/pension/history.ts` (`recordPensionChange`) — Eintrag
  nur bei echter Änderung; Anlage/Löschung mit `summary` als einzelner
  „Eintrag", ohne `summary` strukturiert pro Feld (damit das UI Beträge
  locale-konform formatieren kann); jede Mutation zusätzlich `logAudit`
  (`pension.<entity>.<verb>`, best effort, **nie** sensible Werte wie die
  AHV-Nummer im Detail). Lesen über `pension.listChanges` mit Backend-
  Pagination: Input `{entity?, limit (max 100, Default 25), cursor
(Offset, Default 0)}`, Rückgabe `{entries, total, nextCursor}` — das UI
  blättert per „Mehr laden" (`useInfiniteQuery`).
- **Prognose**: länderabhängige Engine über die Factory
  `getPensionCalculator(country)` in `lib/pension/index.ts` (wirft bei
  unbekanntem Land); CH-Umsetzung in `forecastCh.ts` — monatliche
  Simulation bis zum Rentenalter (max. 600 Monate, monatlich auf Cent
  gerundet): Säule 2 mit Umwandlungssatz, Säule 3a mit fiktiver Entnahme
  über 20 Jahre (capital/240), AHV aus hinterlegter Rente oder grober
  Schätzung (Vollrente 302400 Cent × Beitragsjahre/44, `estimated`).
  Hat eine Pensionskasse Abstufungen (`pension_fund_tiers`) UND einen
  versicherten Jahreslohn, ersetzt Stufensatz × Lohn das flache
  `yearlySavings` (Stufe nach Alter im Simulationsmonat); die Antwort
  enthält zusätzlich `funds` (pro Kasse Endkapital, Monatsrente, wirksame
  Stufen als `phases`) und `fundSeries` (Jahres-Snapshots pro Kasse,
  gleiche Jahre wie `series`). Hat eine Kasse einen Stichtag
  (`value_date`), gilt das Guthaben per diesem Datum und die Akkumulation
  beginnt erst ab dessen Folgemonat — rückwirkend, wenn der Stichtag in
  der Vergangenheit liegt (der Serien-Startpunkt enthält die
  Nachholmonate bereits), verzögert bei zukünftigem Stichtag.
  Der Endpunkt akzeptiert optional `retirementAge` (50–75) als Override
  für Was-wäre-wenn-Rechnungen (Default: Profil-Wert).
- **3a-Konto-Link**: Sync-Saldo (Logik wie `listAccounts`) minus in
  Sparzielen verplante Anteile (`availableForAccount`/`commitmentOf` aus
  `lib/goalProgress.ts`, Zielnamen über goal_sources → savings_goals) in
  `lib/pension/accountSync.ts`; `listPillar3` liefert `syncedBalance`,
  `goalCommitment`, `goalNames`, die Prognose zieht verplante Anteile ab
  und warnt („… im Sparziel ‹Name› verplant").
- **Anhänge**: eigene Tabelle `pension_attachments` (entityType
  ahv/fund/pillar3) und eigene Hono-Routen in `boot.ts` — gleiche
  Constraints wie Belege (MIME-Whitelist, 10 MB, X-Filename-Header,
  inline-Download); Besitzprüfung über `userId` (404 bei Fremdzugriff).
  Metadaten-Liste pro Datensatz über `pension.listAttachments`
  ({entityType, entityId}). Gemeinsames Datei-Handling in
  `lib/attachments.ts` (`savePensionAttachment`/`deletePensionAttachment`/
  `deletePensionAttachmentsFor` — letztere für die Kaskaden in
  `deleteFund`/`deletePillar3`).
- Tests: `api/pension.test.ts` (CRUD, Isolation, Historie, Netto,
  transferNetSalary, Anhänge inkl. Kaskaden), `api/pensionForecast.test.ts`
  (Zinseszins, Umwandlungssatz, AHV, Ersatzrate, Warnungen, 3a-Link).
- `queries/connection.ts` — sql.js-DB mit better-sqlite3-kompatiblem Proxy,
  `initDb()` / `getDb()` / `markDirty()`.

## Hypotheken

Modul in `mortgageRouter.ts` (tRPC-Namespace `mortgage`) — im Gegensatz zur
Vorsorge **haushaltsweit**: kein `userId`-Scoping, jedes Mitglied sieht und
bearbeitet alles. Verknüpfte Finanz-Konten werden weiterhin über
`requireAccountAccess` geprüft (`view` fürs Verknüpfen, `edit` fürs Anlegen
einer Dauerbuchung). Tabellen: `properties` (Liegenschaft; `country` speist
die Engine-Factory, `household_income` ist bewusst manuell — die Lohndaten
der Vorsorge sind privat und dürfen hier nicht gelesen werden; die fünf
bp-Felder `first_mortgage_limit_bp`/`max_ltv_bp`/`calc_interest_rate_bp`/
`maintenance_rate_bp` plus `amortization_years` sind die pro Objekt
überschreibbaren Bank-Parameter), `mortgage_tranches` (Fest/SARON/variabel,
`principal` gilt per `balance_date`, `margin_bp` nur bei SARON,
`interest_recurring_id` als Rückverweis), `mortgage_amortizations`
(`property_id` ist der Anker, `tranche_id` nur bei `direct` — indirekte
Amortisation gilt der ganzen Hypothek), `mortgage_changes` (Historie,
`user_id` = wer geändert hat).

- **Berechnung**: länderabhängig über `getMortgageCalculator(country)` in
  `lib/mortgage/index.ts` (Muster: Vorsorge); CH-Umsetzung in
  `scheduleCh.ts` — monatliche Simulation (max. 600 Monate, Rundung auf
  Cent). Der Zins wird **gezahlt, nicht kapitalisiert**: Die Restschuld
  sinkt ausschließlich durch direkte Amortisation. Ergebnis: `monthlyDebt`/
  `monthlyIndirect` (Index 0 = heute), Jahres-`series`, Kennzahlen pro
  Tranche, `ltv` (1./2. Hypothek, Spielraum) und `affordability`.
- **Tragbarkeit** rechnet mit der **erforderlichen**, nicht der geleisteten
  Amortisation (2. Hypothek / `amortization_years`) — sonst wirkte ein
  Haushalt ohne jede Amortisation rechnerisch tragbar. Grenze
  `MAX_COST_RATIO_BP = 3333`.
- **Warnungen** sind **strukturierte Daten** (`MortgageWarning`), keine
  fertigen Sätze: Beträge, Prozente und Datumsangaben formatiert erst das
  Frontend locale-konform (`warningText` in `pages/Mortgages.tsx`).
- **Nettovermögen**: `forecast.balance` liefert zusätzlich `netWorth`,
  `netWorthNow` und `mortgageMissingRecurring` (Aggregation über
  `lib/mortgage/portfolio.ts`). Zwei Invarianten sichern gegen
  Doppelzählung — die Engine senkt die Schuld bei **indirekter**
  Amortisation NICHT, und `indirectCapital` ist reine Anzeige (das Geld
  steckt schon im Saldo des verknüpften Kontos). Regressionstest:
  `api/mortgageNetWorth.test.ts`.
- **Übernahme als Dauerbuchung**: `transferInterestToRecurring` /
  `transferAmortizationToRecurring` legen eine Kopie an (kein Live-Sync,
  wie `pension.transferNetSalary`). Idempotenz **selbstheilend**: Der
  Rückverweis wird gegen `recurring` aufgelöst — existiert die Zeile noch,
  `CONFLICT`; ist sie gelöscht, gilt der Verweis als leer und es wird neu
  angelegt. Dieselbe Auflösung in `listTranches`/`listAmortizations`, damit
  kein Badge lügt.
- **Kaskaden im Finanz-Modul**: `deleteAccount` nullt
  `mortgage_amortizations.account_id` (der Plan bleibt bestehen),
  `deleteRecurring` räumt die Rückverweise ab, `resetFinanceData` löscht
  alle vier Tabellen, `deleteBank` sperrt auch bei Nutzung durch Tranchen.
- **Zinsbindungs-Erinnerung**: `lib/mortgage/maturityNotice.ts` läuft als
  zweiter Durchgang im täglichen Cron und meldet bei 90 und 30 Tagen
  Restlaufzeit (Notify-Event `mortgage`); Marker in `app_settings`
  (`mortgage_maturity_notified`) verhindert tägliche Wiederholung.
- Tests: `api/mortgage.test.ts` (CRUD, Kaskaden, Rechte, Idempotenz,
  Historie, Erinnerung), `api/mortgageSchedule.test.ts` (reine Engine, fixes
  „heute", exakte Cent-Erwartungen, Invarianten),
  `api/mortgageNetWorth.test.ts`.

## Versicherungen

Modul in `insuranceRouter.ts` (tRPC-Namespace `insurance`) — wie die
Hypotheken **haushaltsweit**: kein `userId`-Scoping. Das ist keine
Bequemlichkeit, sondern Voraussetzung der Lückenanalyse (eine Lücke erkennt
man nur über den ganzen Haushalt). Verknüpfte Konten weiterhin über
`requireAccountAccess` (`view` fürs Verknüpfen, `edit` fürs Anlegen einer
Dauerbuchung). Tabellen: `insurance_policies`, `insurance_policy_persons`
(**Zuschreibung, kein Zugriffsschutz** — null Zeilen = gemeinsame Police),
`insurance_coverages`, `insurance_attachments`, `insurance_changes`,
`insurance_gap_dismissals`.

- **Sparten-Katalog** in `contracts/insurance.ts`: 14 Sparten, **fix und
  nicht benutzererweiterbar**, weil die Sparte Logik trägt (`scope`
  person/household/context, `severity`, `trigger`) und nicht nur ein Label —
  Gegenbeispiel `account_types`, die erweiterbar sind, weil Kontotypen reine
  Labels sind. Der Long Tail läuft über `sonstige` + freie Deckungs-Zeilen.
  `db/schema.ts` importiert den Katalog **relativ** (drizzle-kit löst die
  Aliase nicht auf). Status-Werte englisch (`active|cancelled|expired|
  quote`) mit deutschen Label-Maps, wie überall im Projekt.
- **Fristen-Rechnung**: `lib/insurance/notice.ts::computeNotice` — rein, drei
  Aufrufer (Liste, Lückenanalyse, Cron). `cancelBy` ist immer der **noch
  erreichbare** Termin; ist die Frist der laufenden Periode durch, zeigt er
  aufs Folgejahr und `currentPeriodMissed` liefert das Signal für den
  ehrlichen UI-Satz. Die Datumsarithmetik rechnet auf y/m/d **mit Klemmung**
  (`subMonths("2026-12-31", 3) === "2026-09-30"`, `addYears("2024-02-29", 1)
  === "2025-02-28"`) — der bei `advanceDate` dokumentiert akzeptierte
  Überlauf von `Date.setMonth` würde hier einen ganzen Vertragszyklus kosten.
- **Lückenanalyse**: `lib/insurance/gaps.ts::analyzeGaps` hinter der Factory
  `getInsuranceRules(country)`. Zentrale Definition ist `covers()`: Eine
  **gekündigte, aber noch laufende** Police deckt weiterhin (sonst schlägt
  die Analyse falsch Alarm oder findet die echte Lücke „endet in drei
  Wochen, keine Nachfolge" nie); Angebote decken nie. Regeln R1–R12: fehlende
  Sparten pro Person / pro Haushalt, Gebäudeversicherung bei erfasstem
  Wohneigentum (liest `properties` direkt — haushaltsweit, kein
  Rechteproblem), auslaufende Deckung ohne Nachfolge, Fristen, Datenqualität,
  vergessene Angebote. Ergebnis ist eine **strukturierte** Union
  (`InsuranceGap`), Sätze baut erst `gapText` im Frontend. Nur **aktive**
  Mitglieder zählen.
- **Ausblendungen** liegen in `insurance_gap_dismissals` (eigene Tabelle statt
  app_settings-Marker: Nutzerdaten mit Autor, Zeit und Begründung).
  `gapAnalysis` hängt diese Metadaten als `dismissal` an jeden
  ausgeblendeten Hinweis — sonst wäre die Begründung erfasst, aber nirgends
  sichtbar. Aus- und Einblenden landen zusätzlich in `insurance_changes`
  (Entity `gap`): Der **Hinweis-Name ist dabei das Feld-Label** im Diff, also
  „Fehlende Hausrat: eingeblendet → ausgeblendet". Den Namen baut
  `describeGapKey` aus dem strukturierten Schlüssel (`branch:<b>`,
  `branch:<b>:person:<id>`, `policy:<id>:<kind>`) — das funktioniert auch,
  wenn der Hinweis inzwischen gar nicht mehr feuert. Leere Begründungen
  werden zu `null` normalisiert, damit keine inhaltslose Zeile entsteht.
- **Übernahme als Dauerbuchung**: `transferPremiumToRecurring`, selbstheilende
  Idempotenz wie bei den Hypotheken. Zusätzliche Gates: nur `status ===
  "active"` (Angebote buchen nichts) und `premium > 0`. `endDate` der Police
  wird auf die Dauerbuchung übernommen — befristete Police, befristete
  Buchung.
- **Kaskaden im Finanz-Modul**: `deleteAccount` nullt
  `insurance_policies.account_id` (die Police bleibt), `deleteRecurring`
  räumt `premium_recurring_id` ab, `resetFinanceData` löscht alle sechs
  Tabellen (Dokument-Dateien vorher über `deleteInsuranceAttachmentsFor`,
  außerhalb der Transaktion).
- **Fristen-Erinnerung**: `lib/insurance/noticeReminder.ts` als **dritter**
  Durchgang im täglichen Cron, Schwellen 90/30 Tage bis `cancelBy`
  (Notify-Event `insurance`). Marker-Format ist
  `"<policyId>:<cancelByISO>:<threshold>"` — **mit Datum**, anders als bei
  den Hypotheken: Eine Zinsbindung läuft genau einmal ab, ein Hauptverfall
  wiederholt sich jährlich; ohne den Datumsteil feuerte die Erinnerung pro
  Police genau einmal in ihrem Leben. Regressionstest deckt genau das ab.
- **Policennummer gehört nie ins Audit-`detail`** (Muster AHV-Nummer); in der
  Modul-Historie darf sie stehen — die ist innerhalb des Moduls sichtbar, das
  Audit-Log dagegen in den allgemeinen Einstellungen.
- Tests: `api/insurance.test.ts` (CRUD, Personen, Deckungen, Rechte,
  Kaskaden inkl. Dateien, Idempotenz, Lücken, Historie, Erinnerung),
  `api/insuranceNotice.test.ts` und `api/insuranceGaps.test.ts` (reine
  Engines, fixes „heute").

## Auth & 2FA

- **Session**: E-Mail/Passwort (bcryptjs), HMAC-signiertes HttpOnly-Cookie
  `hh_session` (30 Tage, `lib/session.ts`) — kein JWT-Paket.
- **2FA/TOTP (opt-in pro Benutzer)**: RFC 6238 (SHA1, 30 s, 6 Stellen) ohne
  Bibliothek über node:crypto in `lib/totp.ts` (Base32, `generateSecret`,
  `totpCode`, `verifyTotp` mit ±1-Fenster, otpauth-URL).
  `users.totpSecret`/`totpEnabled`; Endpunkte `auth.setupTotp`/`enableTotp`/
  `disableTotp` (Deaktivieren nur mit Passwort). Bei aktiviertem TOTP liefert
  `auth.login` kein Cookie, sondern `{requiresTotp, totpToken}` — kurzlebiger
  `auth_tokens`-Eintrag mit purpose `totp` (5 Min., einmalig, auch falscher
  Code verbraucht ihn); `auth.verifyTotpLogin` setzt dann das Session-Cookie.
  `auth.me` liefert `totpEnabled`. Tests: `api/totp.test.ts`.

## Konten-Sichtbarkeit & Rechte

- Besitzerliste in der Tabelle `account_owners` (accountId, userId; 1..n
  Besitzer mit gleichen Rechten). Keine Zeilen = Gemeinschaftskonto (alle
  dürfen lesen/bearbeiten), sonst privat (Besitzer + Freigaben aus
  `account_permissions`, Admins nur lesend). Die alte Spalte
  `accounts.owner_id` bleibt physisch bestehen, wird aber nicht mehr gelesen —
  `ensureSchema` migriert sie einmalig guardiert nach `account_owners`
  (Konto gehört dem Ersteller; nur wenn `account_owners` leer ist UND Konten
  mit `owner_id` existieren).
- Zugriffsprüfung immer serverseitig über die Helper in
  `lib/accountAccess.ts` (`accessLevelFor`, `ownerIdsOf`,
  `requireAccountAccess`, `visibleAccountIds`) — nicht nur im Frontend
  ausblenden. Abfragen (Konten, Transaktionen, Recurring, Prognosen) sind pro
  anfragendem Nutzer gefiltert.
- `finance.listAccounts` liefert pro Konto `owners: number[]`; die
  Besitzerliste ersetzt `finance.setAccountOwners` komplett (mindestens 1
  Besitzer, nur Besitzer oder Admin, Selbstentfernung erlaubt; Freigaben
  neuer Besitzer werden entfernt). Tests: `api/accountAccess.test.ts`,
  `api/accountOwners.test.ts`.
- **Kontotypen**: `accounts.type` speichert den KEY aus der Tabelle
  `account_types` — Builtin-Keys `checking`/`cash`/`savings` (in
  `ensureSchema` per INSERT OR IGNORE geseedet, nicht löschbar) plus
  benutzerdefinierte Typen (`custom_<zufalls-id>`). Neue Typen/Banken werden
  im Konto-Dialog angelegt (`finance.createAccountType`/`createBank`),
  verwaltet in den Einstellungen; Löschen nur, wenn nicht mehr verwendet.
  Konten haben optional `bankId` (Tabelle `banks`) und `iban` (normalisiert:
  ohne Leerzeichen, Großbuchstaben — Validierung in `lib/accountTypes.ts`).
- **Kontoabgleich**: `finance.reconcileAccount` bucht die Differenz zwischen
  Ist- und berechnetem Soll-Saldo (Logik wie `listAccounts`) als
  Korrekturbuchung ohne Kategorie (Einnahme/Ausgabe, erfordert `edit`); bei
  Differenz 0 wird nichts gebucht.
- **Saldo-Verlauf**: `finance.accountBalanceHistory` (erfordert `view`)
  liefert pro Konto eine sparsame Punkteserie `[{date, balance}]`:
  Startpunkt (Zeitraum-Beginn mit Saldo aus allen früheren Buchungen), jeder
  Tag mit Saldo-Änderung, Endpunkt heute — Vorzeichenlogik wie
  `listAccounts`; zukünftige Buchungen bleiben außen vor. Input `months`
  (3/6/12, Default 12; 0 = komplette Historie ab erster Buchung). Tests:
  `api/balanceHistory.test.ts`.

## Transaktionen

- **CSV-Import/-Export**: Format in `lib/csv.ts` (für de-Locales Semikolon +
  Dezimalkomma, sonst Komma + Dezimalpunkt, RFC-4180-Quoting; der Import
  erkennt das Trennzeichen automatisch). Kategorien werden rein per Name
  gematcht — bei Namensgleichheit gewinnt die erste passende Kategorie.
- **CAMT.053-Import**: `finance.importCamt` importiert ISO-20022-XML-
  Kontoauszüge (max 10 MB, `edit`-Recht nötig) auf ein Konto — Gutschriften
  als Einnahmen, Belastungen als Ausgaben (ohne Kategorie), Notiz aus
  Gegenpartei + Verwendungszweck. Dubletten-Schutz über die Kombination
  Konto/Datum/Betrag/Notiz; Rückgabe `{imported, duplicates, errors}` analog
  zum CSV-Import. Parser in `lib/camt.ts` (stringbasiert,
  namespace-agnostisch, ohne XML-Bibliothek).
- **Bearbeiten (Änderungshistorie)**: `finance.updateTransaction` nimmt
  partielle Updates entgegen (undefined = unverändert, bei
  categoryId/toAccountId/projectId zusätzlich null = entfernen; Splits/Tags
  werden ersetzt, wenn mitgegeben). Die Buchungsart **type ist
  unveränderlich** (dafür löschen + neu anlegen) und nicht Teil des Inputs.
  Rechte: `edit` auf dem aktuellen Konto, beim Verschieben (accountId-
  Wechsel) zusätzlich `edit` auf dem Zielkonto; Validierung wie
  `createTransaction` (Splits-Summe = Betrag, Kategorie/Projekt/Tags
  existieren, Zielkonto ≠ Quellkonto), Budget-Kipp-Prüfung analog. Jede echte
  Änderung landet als Eintrag in `transaction_changes` (transactionId,
  userId, comment Default '', changes = JSON-Text `[{field, from, to}]` —
  serverseitiges Feld-Diff mit aufgelösten Namen, Beträge in Cent); ohne
  Änderung kein Eintrag (ein Kommentar allein erzeugt keinen). Audit
  `transaction.updated` nur bei echter Änderung. Lesen über
  `finance.listTransactionChanges` (`view`-Recht, absteigend,
  userName/userColor-Join); `listTransactions` liefert pro Buchung
  `changeCount` (batched). Kaskaden räumen `transaction_changes` ab. Tests:
  `api/transactionEdit.test.ts`.
- **Stornieren**: `transactions.stornoOfId` (die Storno-Buchung zeigt aufs
  Original; guardiertes ALTER in `ensureSchema`).
  `finance.reverseTransaction` ({id, note?}, `edit` aufs Buchungskonto) legt
  eine Gegenbuchung mit heutigem Datum an: Ausgabe ↔ Einnahme getauscht,
  Umbuchung mit getauschten Konten; Betrag/Kategorie/Projekt/Person/Splits
  wie im Original, Notiz = note-Input oder „Storno: <Originalnotiz>". Guards:
  bereits storniert bzw. Storno-Buchung selbst → CONFLICT. Original und
  Gegenbuchung bleiben sichtbar (Badges „Storniert"/„Storno"). Damit sich die
  Aufteilungs-Wirkung exakt aufhebt, zählen in `memberBalances`
  (`src/lib/finance.ts`) Einnahmen MIT Splits umgekehrt wie Ausgaben. Audit
  `transaction.reversed`. Tests: `api/transactionReverse.test.ts`.

## Dauerbuchungen (recurring)

- **Intervalle**: `weekly` | `monthly` | `quarterly` | `semiannual` |
  `yearly` — zentral in `RECURRING_INTERVALS`/`RECURRING_INTERVAL_LABELS`/
  `MONTHS_PER_INTERVAL` (`contracts/types.ts`), von Backend und Frontend
  geteilt. Die Spalte hat in SQLite **keine** CHECK-Constraint, das Enum
  wirkt rein typseitig — ein neues Intervall braucht daher keine Migration,
  aber die Terminrechnung `advanceDate` (`lib/recurringSchedule.ts`) muss
  es kennen. `quarterly`/`semiannual` kamen mit dem Hypotheken-Modul dazu
  (Schweizer Hypothekarzins wird quartalsweise belastet).
- **Umbuchungen**: `recurring.type` kann auch `transfer` sein (Dauerauftrag
  zwischen Konten) — dann ist `recurring.to_account_id` gesetzt (Pflicht, ≠
  `account_id`, Kategorie irrelevant). Rechte wie bei Buchungen: `edit` aufs
  Quellkonto, mindestens `view` aufs Zielkonto; Sichtbarkeit in
  `listRecurring`/Prognose, wenn Quell- ODER Zielkonto sichtbar ist. In der
  Saldo-Prognose sind Transfers zwischen zwei sichtbaren Konten neutral, bei
  nur einer sichtbaren Seite wirken sie als Ab-/Zufluss (nicht in
  `recurringIncome`/`recurringExpense`). Tests: `api/recurringTransfer.test.ts`.
- **Bearbeiten**: `finance.updateRecurring` nimmt partielle Updates entgegen
  (undefined = unverändert, bei categoryId zusätzlich null = entfernen); die
  Art **type ist unveränderlich**. Validierung wie `createRecurring`, Rechte:
  `edit` auf dem aktuellen Konto, bei Konto-Wechsel `edit` aufs neue, bei
  Transfer-Zielwechsel `view` aufs Ziel; der Cron-Job verbucht ab dem neuen
  `nextDate`. Audit `recurring.updated`. Tests: `api/recurringEdit.test.ts`.
- **Enddatum**: `recurring.endDate` (TEXT, nullable, YYYY-MM-DD) = letztes
  verbuchtes Vorkommen, NULL = kein Ende. `createRecurring`/`updateRecurring`
  nehmen `endDate` optional entgegen (Update: null = entfernen) und verlangen
  endDate ≥ wirksame `nextDate` (BAD_REQUEST). Der Cron-Job
  (`lib/recurringJob.ts`) verbucht nur Vorkommen ≤ endDate; `nextDate` bleibt
  danach auf dem ersten Vorkommen jenseits des Enddatums stehen. Ablauf
  (endDate < heute) = „archiviert". Logik in `src/lib/recurring.ts`
  (`isRecurringArchived`, `sortRecurring`). Tests:
  `api/recurringEndDate.test.ts`.

## Kategorien & Budgets

- **Hierarchie**: `categories.parentId` NULL = Oberkategorie, sonst Verweis
  auf die Oberkategorie — genau EINE Ebene (Unterkategorien dürfen keine
  Kinder haben, geprüft in `finance.createCategory`). Unterkategorien erben
  Typ und Farbe der Oberkategorie; Oberkategorien mit Kindern können nicht
  gelöscht werden (CONFLICT). `listCategories` bleibt flach, das Frontend
  baut den Baum selbst.
- **Bearbeiten**: `finance.updateCategory` ({id, name, color, parentId?})
  ändert Name/Farbe/Einordnung — der Typ ist unveränderlich. parentId:
  undefined = unverändert, null = zur Oberkategorie machen, Zahl = unter
  diese Oberkategorie hängen (Verschieben/Hochstufen nur ohne eigene
  Unterkategorien, sonst CONFLICT). Namens-Duplikate (case-insensitiv, andere
  ID) → CONFLICT; beim Verschieben erbt die Kategorie die Farbe der neuen
  Oberkategorie. Audit `category.updated`. Tests: `api/categoryEdit.test.ts`.
- **Budgets**: `budgets.period` = `monthly` (Kalendermonat) oder `yearly`
  (Kalenderjahr), `budgets.rollover` (nur bei monthly) überträgt
  unverbrauchtes Budget in Folgemonate, `budgets.createdAt` ist der
  Rollover-Anker (NULL bei Bestandsbudgets = 1. Januar des laufenden Jahres).
  Effektives Limit = amount × Monate-seit-Anker − Ausgaben der abgelaufenen
  Monate seit Anker, mindestens 0. Auswertung zentral in `lib/budgets.ts`
  (`computeBudgetStatuses`) — Ausgaben einer Budget-Kategorie inkl. aller
  Unterkategorien, mit Sichtbarkeitsfilter; genutzt von
  `finance.listBudgetStatus` und `forecast.budgetForecast`.

## Splits, Projekte, Tags

- **Aufteilungsvorlagen**: Tabelle `split_templates` (Name unique, `shares`
  als JSON-Text `[{userId, weight}]`, Gewichte positiv, userIds validiert).
  Endpunkte `finance.listSplitTemplates`/`createSplitTemplate`/
  `deleteSplitTemplate`. Die gewichtete Verteilung rechnet
  `sharesFromWeights` in `contracts/splitShares.ts` (Rundung auf Cent,
  Restdifferenz auf dem ersten Anteil) — geteilt zwischen Frontend und Tests.
- **Projekte (Kostenaufteilung)**: Tabelle `projects` (Name unique, Farbe);
  `transactions.projectId` NULL = laufender Haushalt, sonst Projekt-Buchung
  (z. B. Urlaub). Endpunkte `finance.listProjects`/`createProject`/
  `deleteProject` — Löschen gesperrt (CONFLICT mit Anzahl), solange Buchungen
  referenzieren. `createTransaction` nimmt optional `projectId` (Existenz
  wird geprüft). Tests: `api/projectsSplits.test.ts`.
- **Tags/Labels**: Tabellen `tags` (Name unique, Farbe) und
  `transaction_tags` (Unique-Index (transactionId, tagId)) — mehrere Tags pro
  Buchung, haushaltsweit (keine Konto-Bindung, keine Sichtbarkeitslogik; die
  Buchungsfilter über die Kontorechte greifen wie bisher). Endpunkte
  `finance.listTags`/`createTag` (Name getrimmt, Duplikat case-insensitiv
  CONFLICT; Farbe automatisch = am seltensten verwendete Farbe der Palette
  `TAG_COLORS` in `contracts/types.ts`)/`deleteTag` (löst Zuordnungen still
  mit auf — bewusst KEIN CONFLICT)/`setTransactionTags` (Ersetzen-Semantik,
  erfordert `edit` auf dem Buchungskonto). `createTransaction` nimmt optional
  `tagIds`, `listTransactions` liefert pro Buchung `tags` gebatcht. Kaskaden:
  deleteTransaction/deleteAccount/resetFinanceData räumen `transaction_tags`
  ab (Reset löscht auch die Tags selbst). Audit: `tag.created`/`tag.deleted`/
  `transaction.tags`. Tests: `api/tags.test.ts`.

## Sparziele

- **Quellen (Sparziele 2.0)**: Tabelle `goal_sources` (goalId, accountId,
  mode `full`/`absolute`/`percent`, value NULL bzw. Cent > 0 bzw. 1–100,
  createdAt) — max. EINE Quelle pro Konto und Ziel (Duplikat → CONFLICT).
  Fortschrittsformel pro Quelle (Saldo wie `listAccounts`): full
  `max(0, saldo)`, absolute `min(value, max(0, saldo))`, percent
  `round(max(0, saldo) × value / 100)`; Gesamt = Σ sichtbarer Quellen +
  `savedAmount` + Σ Beiträge (Alt-Bestand „Manuell (Bestand)"). Zentrale
  Logik in `lib/goalProgress.ts` (`accountBalances`,
  `computeGoalProgress(db, user | null, goal)` — `user null` = ungefilterte
  Systemperspektive für Benachrichtigungen, sonst nur Quellen mit sichtbarem
  Konto, `hasHiddenSources` ohne Betrags-/Namens-Leak); geteilt von
  `finance.listGoals` (liefert `totalSaved`, `percent`, `sources[]`,
  `hasHiddenSources`), `forecast.goalForecast` und den Meilenstein-
  Benachrichtigungen. Endpunkte `finance.addGoalSource` (Ziel existiert,
  `view` aufs Konto, Modus-Validierung, Meilenstein-Vergleich) /
  `deleteGoalSource` (`view` aufs verknüpfte Konto). **Gesperrt**:
  `updateGoalSaved` und `addGoalContribution` → BAD_REQUEST („Manuelle
  Einzahlungen sind nicht mehr möglich — verknüpfe das Sparziel mit einem
  Konto."); `listGoalContributions` bleibt für den Bestand lesbar.
  `forecast.goalForecast` simuliert pro Ziel monatlich (max. 120 Monate) die
  Salden der verknüpften Konten mit den wiederkehrenden Buchungen (Vorgehen
  wie `forecast.balance` inkl. Sichtbarkeitsfilter): ETA = erster Monat mit
  Fortschritt ≥ Ziel (sonst null), `monthlyRate` = Ø Fortschrittsänderung
  der nächsten 3 simulierten Monate. Kaskaden: `deleteGoal`,
  `deleteAccount` und `resetFinanceData` löschen Quellen mit. Tests:
  `api/goalSources.test.ts`.
- **Anteils-Exklusivität**: ein Kontobetrag darf nicht doppelt verplant
  werden — die Summe der Verpflichtungen (commitment: full → max(0, Saldo),
  absolute → value ungekappt, percent → round(max(0, Saldo) × value/100))
  aller `goal_sources` eines Kontos (zielübergreifend) darf max(0, Saldo)
  nicht übersteigen; full ist zusätzlich exklusiv (nur auf quellenfreien
  Konten, blockiert jede weitere Quelle). Logik: `commitmentOf`/
  `availableForAccount` in `lib/goalProgress.ts`; geprüft in
  `finance.addGoalSource` (CONFLICT bei full-Konflikt, sonst BAD_REQUEST „Nur
  noch X verfügbar"), lesbar über `finance.goalSourceAvailability`
  ({accountId}, view-Recht). Nachträgliche Saldoänderungen können die Summe
  über den Saldo heben — gewollt, die Kappung in `sourceAmount` greift dann
  in der Fortschrittsanzeige.
- **Offene Sparziele (ohne Zielbetrag)**: `savings_goals.target_amount` ist
  nullable — NULL = offenes Ziel, der Fortschritt zeigt dann nur den
  angesparten Betrag. `createGoal`/`updateGoal` nehmen `targetAmount` nullish
  entgegen (gesetzt weiterhin positiv); `listGoals` liefert `percent: null`,
  Meilenstein-Benachrichtigungen und ETA/remaining in `forecast.goalForecast`
  entfallen (Guards an den computeGoalProgress-Aufrufern bzw. in
  `notifyGoalMilestones`). Bestands-DBs: guardierte Tabellen-Neuerstellung in
  `ensureSchema` (PRAGMA notnull-Flag, NOT NULL lässt sich per ALTER nicht
  entfernen). Tests: `api/openGoals.test.ts`.
- **Beiträge (Alt-Bestand)**: Tabelle `goal_contributions` (goalId, userId,
  amount in Cent positiv, note, createdAt) — seit Sparziele 2.0
  schreibgeschützt; zählt zusammen mit `savings_goals.savedAmount` als
  Herkunft „Manuell (Bestand)" in den Fortschritt. Lesen über
  `finance.listGoalContributions` (mit Name/Farbe des Zahlers), Löschen
  weiterhin via `deleteGoalContribution` (nur eigener Beitrag oder Admin).
  `deleteGoal` und `resetFinanceData` löschen Beiträge kaskadierend mit.

## Prognosen & Auswertungen

- **Szenario-Planung**: `forecast.balance` nimmt optional `incomePct`
  (Skalierung der wiederkehrenden Einnahmen in %, 100 = unverändert, 50–200)
  und `excludeCategoryId` entgegen. Das Szenario wirkt NUR auf zukünftige
  wiederkehrende Größen: Einnahmen werden skaliert, wiederkehrende Ausgaben
  der gewählten Oberkategorie inkl. Unterkategorien entfallen; Historie,
  Ist-Buchungen und variable Durchschnitte bleiben unverändert. Die Antwort
  enthält die wirksamen Parameter im Feld `scenario`. Tests:
  `api/scenario.test.ts`.
- **Jahresvergleich**: `finance.yearComparison` liefert pro Ausgaben-
  Oberkategorie (Unterkategorien aufgerollt, Sichtbarkeitsfilter) die Summen
  von Jahr und Vorjahr; Ausgaben ohne Kategorie als Zeile `categoryId: null`.
  Tests: `api/reconcileYear.test.ts`.

## Benachrichtigungen & Audit-Log

- **Benachrichtigungen (opt-in)**: Versand via ntfy und/oder generischem
  Webhook, zentral `sendNotification` in `lib/notify.ts` (Events: `budget`,
  `recurring`, `goal`, `mortgage`, `insurance`; Konfiguration in
  `app_settings`: `notify_ntfy_url`, `notify_webhook_url`, `notify_events` —
  Admin-Endpunkte `finance.getNotifySettings`/`setNotifySettings`/
  `sendTestNotification`). Nur http/https-URLs; Versandfehler werden nur
  geloggt, nie den Hauptflow brechen. Trigger: Budget-Kipppunkt >100 % in
  `finance.createTransaction`, Sammelmeldung am Ende von `runRecurringJob`,
  Sparziel-Meilensteine (25/50/75/100 %, ungefilterter Haushalts-
  Gesamtfortschritt vor/nach) in `finance.createTransaction` (Buchung auf
  einem ziel-verknüpften Konto) und `finance.addGoalSource`, Ablauf einer
  Zinsbindung (90/30 Tage, zweiter Durchgang im Cron), Ablauf einer
  Kündigungsfrist (90/30 Tage, dritter Durchgang im Cron). Tests:
  `api/notify.test.ts`.
- **Aktivitäts-/Audit-Log**: Tabelle `audit_log` (userId NULL = System bzw.
  Vorgänge vor dem Login, action nach Konvention `<entity>.<verb>` wie
  `transaction.created`, entity, entityId, kurzes deutsches Detail — niemals
  Passwörter/Codes/Tokens). Schreiben über `logAudit` aus `lib/audit.ts`
  (best effort, fängt Fehler intern ab; akzeptiert db- wie tx-Handle, damit
  der Eintrag im selben Transaktionskontext landet). Instrumentiert sind die
  fachlichen Mutationen in `financeRouter.ts` und `authRouter.ts` (Login
  Erfolg/Fehlschlag, Logout, TOTP, Benutzer-Verwaltung, Profil, Passwort).
  Lesen für alle Mitglieder über `finance.listAuditLog` (neueste zuerst,
  Limit max 500, optionaler entity-Filter, userName/userColor gejoint).
  Tests: `api/auditLog.test.ts`.

## Beleg-Anhänge

Metadaten in `transaction_attachments`, Dateien mit UUID-Dateinamen im
Verzeichnis `ATTACHMENTS_DIR` (Default: `<DB-Verzeichnis>/attachments`, bei
In-Memory-DB `./data/attachments`). Upload/Download/Löschen über die
Hono-Routen in `boot.ts` mit Konto-Rechten (`edit` für Upload/Löschen, `view`
für Download — via `requireAccountAccess`); erlaubt sind Bilder
(JPEG/PNG/WebP/GIF) und PDF bis 10 MB. Kaskaden (deleteTransaction,
deleteAccount, resetFinanceData) löschen Zeilen UND Dateien über
`deleteAttachmentsForTransactions` aus `lib/attachments.ts`. Tests:
`api/attachments.test.ts`.

## Währung & App-Einstellungen

Haushaltsweite Währung in `app_settings` (Key `currency`, ISO-4217-Code,
Default `EUR`); Änderung nur durch Admins (`finance.setCurrency`). Die 20
unterstützten Währungen stehen in `contracts/types.ts` (`CURRENCIES`).
Tests: `api/appSettings.test.ts`.
