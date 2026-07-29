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
- `relations.ts` — Drizzle-Relationen; `seed.ts` — Seed-Daten;
  `migrations/` — drizzle-kit-Artefakte (dev: `npm run db:push`);
  `stubs/better-sqlite3-stub.cjs` — ersetzt `better-sqlite3` im Server-Bundle
  per esbuild-Alias (die App läuft rein auf sql.js/WASM, siehe Root-AGENTS.md).
- Datumsformat in der DB: Text `YYYY-MM-DD`; Geldbeträge als Integer in Cent.
