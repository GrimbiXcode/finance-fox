/**
 * Baut den Service Worker nach `dist/public/sw.js`.
 *
 * Läuft nach `vite build`, weil die Liste der zu cachenden Dateien aus dem
 * fertigen Build stammt. Beides — Dateiliste und eine Build-Kennung — wird per
 * esbuild-`define` in den Worker gelegt: So gehört der Precache untrennbar zu
 * genau dieser Worker-Version, und ein geänderter Build erzeugt automatisch
 * einen neuen Cache-Namen.
 *
 * Klassisches IIFE statt ES-Modul: Module-Service-Worker sind erst ab
 * iOS 16.4 verfügbar, und die App soll auch auf älteren Geräten offline laufen.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { offlineBundleOptions } from "./offlineBundle.mjs";

const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.join(root, "dist", "public");

/** Dateien, die nie in den Precache gehören */
const EXCLUDED = new Set(["sw.js", "sw.js.map"]);

/**
 * WASM-Datei des Browser-Builds von sql.js. `locateFile` in
 * `src/offline/db/connection.ts` sucht sie unter genau diesem Namen im Wurzel-
 * verzeichnis.
 */
const SQL_WASM = "sql-wasm-browser.wasm";

function collectFiles(dir, base = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    // Vites internes Manifest-Verzeichnis interessiert den Browser nicht.
    if (entry.name === ".vite") continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), rel));
    } else if (!EXCLUDED.has(rel)) {
      files.push(rel);
    }
  }
  return files;
}

if (!fs.existsSync(publicDir)) {
  console.error(
    `[build-sw] ${publicDir} fehlt — bitte zuerst \`vite build\` ausführen.`
  );
  process.exit(1);
}

// sql.js braucht seine WASM-Datei zur Laufzeit. Sie muss neben der App liegen
// und in den Precache — ohne sie startet die lokale Datenbank offline nicht.
// (Der Server benutzt dieselbe Bibliothek, aber deren Node-Build in dist/.)
fs.copyFileSync(
  path.join(root, "node_modules", "sql.js", "dist", SQL_WASM),
  path.join(publicDir, SQL_WASM)
);

const files = collectFiles(publicDir).sort();

// Build-Kennung: Hash über Pfad + Inhalt aller Dateien. Damit ändert sich der
// Cache-Name genau dann, wenn sich am Build wirklich etwas geändert hat.
const hash = createHash("sha256");
for (const rel of files) {
  hash.update(rel);
  hash.update(fs.readFileSync(path.join(publicDir, rel)));
}
const buildId = hash.digest("hex").slice(0, 16);

const precache = files.map(rel => `/${rel}`);

await build({
  ...offlineBundleOptions(root),
  entryPoints: [path.join(root, "src", "sw", "index.ts")],
  outfile: path.join(publicDir, "sw.js"),
  minify: true,
  define: {
    __FF_BUILD_ID__: JSON.stringify(buildId),
    __FF_PRECACHE__: JSON.stringify(precache),
  },
});

const bytes = fs.statSync(path.join(publicDir, "sw.js")).size;
console.log(
  `[build-sw] sw.js gebaut (${(bytes / 1024).toFixed(0)} kB, Build ${buildId}, ` +
    `${precache.length} Dateien im Precache)`
);
