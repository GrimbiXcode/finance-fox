import "dotenv/config";
import { defineConfig } from "drizzle-kit";

import path from "node:path";

const rawUrl = (process.env.DATABASE_URL || "file:./data/finance-fox.db").replace(/^file:/, "");
const url = rawUrl === ":memory:" ? rawUrl : path.resolve(rawUrl);

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: { url },
});
