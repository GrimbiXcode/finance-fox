import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@db": path.resolve(templateRoot, "db"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["api/**/*.test.ts", "api/**/*.spec.ts"],
    // Tests laufen gegen eine In-Memory-DB, nicht gegen die Dev-Datenbank.
    env: {
      DATABASE_URL: "file::memory:",
    },
  },
});
