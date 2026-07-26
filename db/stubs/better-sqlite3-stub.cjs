// Stub für den Drizzle-Treiber-Import im esbuild-Bundle.
// Das native better-sqlite3-Modul wird in diesem Projekt NICHT verwendet —
// die Datenbank läuft über sql.js (WASM) mit einem API-kompatiblen Proxy
// (siehe api/queries/connection.ts). Dieser Stub existiert nur, damit der
// statische Import in drizzle-orm/better-sqlite3/driver.js auflösbar bleibt.
function Database() {
  throw new Error(
    "better-sqlite3 (nativ) ist nicht verfügbar. " +
    "Dieses Projekt nutzt sql.js (WASM) — siehe api/queries/connection.ts."
  );
}
module.exports = Database;
module.exports.default = Database;
