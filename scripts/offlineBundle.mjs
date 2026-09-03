import path from "node:path";

/**
 * Gemeinsame esbuild-Einstellungen für alles, was Server-Code im Browser
 * ausführt (heute: der Service Worker).
 *
 * Der Kern ist das Plugin `serverModuleSwaps`: Es tauscht beim Bündeln genau
 * die drei Module aus, die am Node-Laufzeitumfeld hängen, gegen ihre
 * browserseitigen Zwillinge. Alles andere — die fünf Daten-Router, die gesamte
 * Fachlogik, `ensureSchema` — wandert unverändert in den Browser. Das ist der
 * Grund, warum die App offline nicht nur Daten anzeigt, sondern auch rechnet.
 *
 * Vorbild ist der bestehende `--alias:better-sqlite3=…`-Kniff im Server-Build.
 */

export function offlineBundleOptions(root) {
  /** Server-Modul → browserseitiger Zwilling */
  const swaps = new Map([
    [
      path.join(root, "api", "queries", "connection.ts"),
      path.join(root, "src", "offline", "db", "connection.ts"),
    ],
    [
      path.join(root, "api", "lib", "attachmentStore.ts"),
      path.join(root, "src", "offline", "shims", "attachmentStore.ts"),
    ],
    [
      path.join(root, "api", "lib", "env.ts"),
      path.join(root, "src", "offline", "shims", "env.ts"),
    ],
  ]);

  const serverModuleSwaps = {
    name: "ff-server-module-swaps",
    setup(build) {
      // Relative Importe auflösen und gegen die Tauschliste halten. `--alias`
      // greift nur bei Paketnamen, die betroffenen Module werden aber überall
      // relativ importiert ("../queries/connection", "./env", …).
      build.onResolve({ filter: /^\.{1,2}\// }, args => {
        if (!args.importer) return null;
        const resolved = path.resolve(path.dirname(args.importer), args.path);
        const target =
          swaps.get(resolved) ??
          swaps.get(`${resolved}.ts`) ??
          swaps.get(path.join(resolved, "index.ts"));
        return target ? { path: target } : null;
      });
    },
  };

  return {
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    plugins: [serverModuleSwaps],
    alias: {
      // Drizzles better-sqlite3-Treiber wird nur wegen seines statischen
      // Imports aufgelöst — gefahren wird auf sql.js (WASM).
      "better-sqlite3": path.join(
        root,
        "db",
        "stubs",
        "better-sqlite3-stub.cjs"
      ),
      "node:crypto": path.join(root, "src", "offline", "shims", "node-crypto.ts"),
      "node:zlib": path.join(root, "src", "offline", "shims", "node-zlib.ts"),
      "@contracts": path.join(root, "contracts"),
      "@db": path.join(root, "db"),
      "@": path.join(root, "src"),
    },
  };
}
