# db/AGENTS.md — Datenbankschema

Detail-Doku zur Datenbank. Übergeordnetes: `../AGENTS.md`.

- **Schema-Quelle der Wahrheit ist `schema.ts`** (Drizzle-Tabellen).
  `api/lib/migrate.ts` (`ensureSchema`) enthält dasselbe Schema als
  `CREATE TABLE IF NOT EXISTS` und läuft bei jedem Serverstart — bei
  Schemaänderungen **beide Stellen** aktualisieren.
- `ensureSchema` ist idempotent; neue Spalten an bestehenden Tabellen werden
  dort guardiert nachgerüstet (PRAGMA table_info + ALTER TABLE, siehe
  `owner_id`/`bank_id`/`iban` bei `accounts` oder `storno_of_id` bei
  `transactions`). Änderungen, die ALTER nicht hergibt (z. B. NOT NULL
  entfernen bei `savings_goals.target_amount`), laufen als guardierter
  Tabellen-Rebuild (PRAGMA-Flag prüfen, neue Tabelle, Daten kopieren,
  umbenennen). Einmalige Daten-Migrationen sind ebenfalls guardiert (z. B.
  `accounts.owner_id` → `account_owners`: nur wenn `account_owners` leer ist
  UND Konten mit `owner_id` existieren).
- **Indizes auf nachgerüstete Spalten gehören hinter ihren Guard**, nicht in
  die `CREATE TABLE`-Liste: `CREATE TABLE IF NOT EXISTS` lässt eine
  bestehende Tabelle unverändert, ein `CREATE INDEX` auf eine erst per
  `ALTER TABLE` ergänzte Spalte scheitert dort mit „no such column" und der
  Server startet nicht mehr (siehe `pension_deductions.salary_id`).
  Regressionstest: `api/migrateSchema.test.ts` baut eine Bestands-DB nach.
- `relations.ts` — Drizzle-Relationen; `seed.ts` — Seed-Daten;
  `migrations/` — drizzle-kit-Artefakte (dev: `npm run db:push`);
  `stubs/better-sqlite3-stub.cjs` — ersetzt `better-sqlite3` im Server-Bundle
  per esbuild-Alias (die App läuft rein auf sql.js/WASM, siehe Root-AGENTS.md).
- Datumsformat in der DB: Text `YYYY-MM-DD`; Geldbeträge als Integer in Cent.
- Die Vorsorge-Tabellen (`pension_*`) folgen denselben Konventionen; Monate
  als Text `YYYY-MM`, Prozentsätze als Integer in **Basispunkten**
  (530 = 5,30 %). Fachlogik dazu: `api/AGENTS.md` Abschnitt „Vorsorge".
- Die Hypotheken-Tabellen (`properties`, `mortgage_tranches`,
  `mortgage_amortizations`, `mortgage_changes`) ebenfalls — anders als die
  Vorsorge aber **ohne `user_id`-Scoping**: Wohneigentum gehört dem
  Haushalt. Achtung bei Basispunkten: 5 % sind **500** Bp, nicht 5000.
  Fachlogik: `api/AGENTS.md` Abschnitt „Hypotheken".
- `recurring.interval` hat **keine** CHECK-Constraint — das Drizzle-Enum
  (`RECURRING_INTERVALS` aus `contracts/types.ts`, relativ importiert, damit
  drizzle-kit es auflöst) wirkt rein typseitig. Ein neues Intervall braucht
  daher keine Migration, wohl aber einen Zweig in `advanceDate`
  (`api/lib/recurringSchedule.ts`).
