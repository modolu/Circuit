import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const WALLET = "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV";
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ publicKey: null, connected: false, signMessage: undefined }),
}));
const { JupiterConnection } = await import("@/components/jupiter/jupiter-connection");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("JupiterConnection", () => {
  it("separates Circuit sign-in, Jupiter auth and Jupiter vault, and starts with a read-only check", () => {
    const t = text(renderToStaticMarkup(<JupiterConnection sessionWallet={WALLET} />));
    for (const label of ["Circuit sign-in", "Jupiter auth", "Jupiter vault", "CHECKING"]) expect(t).toContain(label);
    expect(t).not.toMatch(/Sign Jupiter login|Set up Jupiter vault/);
  });
});

/** Files that make up the Task 8 Jupiter surface. None may sign transactions or keep the JWT in browser storage. */
function sources(): Array<{ path: string; source: string }> {
  const dirs = ["components/jupiter", "src/services/jupiter", "app/api/jupiter"];
  const files = ["src/auth/jupiter-session.ts", "app/api/_lib/jupiter-route.ts", "app/api/policies/[policyId]/jupiter/deposit/route.ts"];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  return [...dirs.flatMap(walk), ...files].map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

describe("Task 8 boundary", () => {
  it("never signs or sends a transaction, calls /orders/price, or uses browser storage", () => {
    for (const { path, source } of sources()) {
      for (const forbidden of [/signTransaction/, /signAllTransactions/, /sendTransaction/, /sendRawTransaction/, /orders\/price/, /localStorage/, /sessionStorage/]) {
        expect(`${path}: ${forbidden.test(source)}`).toBe(`${path}: false`);
      }
    }
  });

  it("keeps the Jupiter API key server-side", () => {
    for (const { path, source } of sources().filter((s) => s.path.startsWith("components/"))) {
      expect(`${path}: ${/JUPITER_API_KEY|x-api-key/.test(source)}`).toBe(`${path}: false`);
    }
  });
});
