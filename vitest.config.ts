import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Live provider checks are opt-in only: `pnpm test:live` (Pyth), `pnpm test:jupiter-live`, `pnpm test:prestocks-live`, or "1" for all. */
function testInclude(live: string | undefined): string[] {
  if (live === "pyth") return ["tests/live/pyth.live.test.ts"];
  if (live === "jupiter") return ["tests/live/jupiter.live.test.ts"];
  if (live === "prestocks") return ["tests/live/prestocks.live.test.ts"];
  if (live === "1") return ["tests/live/**/*.test.ts"];
  return ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"];
}

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
    include: testInclude(process.env.CIRCUIT_LIVE_TESTS),
    // Each integration file boots an in-process Postgres (PGlite) and applies the migrations.
    hookTimeout: 60_000,
  },
});
