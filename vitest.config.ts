import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws outside a React Server bundle; tests run server modules directly.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include:
      // Live provider checks are opt-in only (`pnpm test:live`).
      process.env.CIRCUIT_LIVE_TESTS === "1"
        ? ["tests/live/**/*.test.ts"]
        : ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"],
    // Each integration file boots an in-process Postgres (PGlite) and applies the migrations.
    hookTimeout: 60_000,
  },
});
