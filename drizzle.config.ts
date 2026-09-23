import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";

// drizzle-kit is only used to generate SQL from src/db/schema.ts; migrations are
// applied by `pnpm db:migrate` (src/db/migrate.ts). Credentials are loaded for
// optional drizzle-kit tooling (e.g. `drizzle-kit check`) and never printed.
if (existsSync(".env.local")) loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  strict: true,
  verbose: false,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
