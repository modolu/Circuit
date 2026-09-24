import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { afterAll, describe, expect, it } from "vitest";
import { getServerEnv } from "@/src/config/env";
import { PRESTOCKS_ASSETS } from "@/src/config/assets";
import { USDC } from "@/src/config/tokens";
import { createJupiterClient, getJupiterClient, JupiterRequestError } from "@/src/integrations/jupiter/client";
import { assessPolicySide, type MintProfile } from "@/src/integrations/jupiter/token-compat";
import { createPrestocksClient } from "@/src/integrations/prestocks/client";
import type { PrestocksProduct } from "@/src/integrations/prestocks/mapper";

/*
 * OPT-IN live PreStocks compatibility probe (`pnpm test:prestocks-live`). NO FUNDS:
 * first-party catalog + product pages, onchain mint reads, Jupiter Tokens by exact mint,
 * and a quote-only USDC → token route with NO taker. It never produces, signs or submits
 * a transaction, never crafts a Trigger deposit and never creates an order.
 */

const hasKey = Boolean(getServerEnv().JUPITER_API_KEY);
const jupiter = hasKey ? getJupiterClient() : createJupiterClient({ apiKey: undefined });
const lines: string[] = [];
const summary: Array<[string, string]> = [];
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

interface CandidateResult {
  product: PrestocksProduct;
  lifecycle: string;
  mintValid: boolean;
  program: string;
  decimals: number | null;
  extensions: string[];
  jupiterRecognized: boolean;
  jupiterDecimals: number | null;
  routeOut: string | null;
  routeLabel: string;
  buy: string;
  sell: string;
  eligible: boolean;
  reason: string;
}
const results: CandidateResult[] = [];

/** First-party product-page lifecycle notice (e.g. "⚠️ … has gone public"). Status text only; prices come from the API. */
async function lifecycleNotice(url: string): Promise<string | null> {
  const html = await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
  const warning = text.match(/⚠️?\s*([^.!]{0,160}[.!]?[^.!]{0,200}[.!]?)/);
  return warning ? warning[1]!.trim() : null;
}

const selected: Array<[string, string]> = [];

afterAll(() => {
  const out = (line = "") => process.stdout.write(`${line}\n`);
  out("\n=== PreStocks live compatibility probe (no funds) ===");
  const width = Math.max(...[...summary, ...selected].map(([label]) => label.length));
  for (const [label, value] of summary) out(`${label.padEnd(width)} : ${value}`);
  out("");
  for (const line of lines) out(line);
  out("");
  for (const [label, value] of selected) out(`${label.padEnd(width)} : ${value}`);
  out("");
});

describe("PreStocks live probe", () => {
  let products: PrestocksProduct[] = [];

  it("fetches and validates the first-party catalog", async () => {
    const catalog = await createPrestocksClient().fetchCatalog();
    products = catalog.products;
    summary.push(["PreStocks API", "PASS"]);
    summary.push(["catalog items", `${products.length} valid, ${catalog.rejectedCount} rejected`]);
    expect(products.length).toBeGreaterThan(0);
  }, 30_000);

  it("assesses every current product: lifecycle, mint, Jupiter, quote-only route, deposit compatibility", async () => {
    const conn = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
    for (const product of products) {
      const lifecycle = (await lifecycleNotice(product.productUrl).catch(() => "page unavailable")) ?? "CURRENT";
      let mintValid = false;
      let program = "?";
      let decimals: number | null = null;
      let extensions: string[] = [];
      let hookProgram: string | null | undefined;
      try {
        const { value } = await conn.getParsedAccountInfo(new PublicKey(product.contractAddress));
        const data = value?.data as { program?: string; parsed?: { type?: string; info?: { decimals?: number; extensions?: Array<{ extension: string; state: Record<string, unknown> }> } } } | undefined;
        mintValid = data?.parsed?.type === "mint";
        program = data?.program ?? "?";
        decimals = data?.parsed?.info?.decimals ?? null;
        const ext = data?.parsed?.info?.extensions ?? [];
        extensions = ext.map((e) => e.extension);
        hookProgram = ext.find((e) => e.extension === "transferHook")?.state.programId as string | null | undefined;
      } catch {
        mintValid = false;
      }
      const token = await jupiter.findTokenByMint(product.contractAddress).catch(() => null);
      let routeOut: string | null = null;
      let routeLabel = "";
      try {
        const quote = await jupiter.quoteRoute({ inputMint: USDC.mintAddress, outputMint: product.contractAddress, amountAtomic: 10_500_000n });
        routeOut = BigInt(quote.outAmount) > 0n ? quote.outAmount : null;
        routeLabel = [quote.router, ...(quote.routePlan ?? []).map((r) => r.swapInfo?.label)].filter(Boolean).join("/");
      } catch (error) {
        routeLabel = error instanceof JupiterRequestError ? error.reason : "error";
      }
      const stock: MintProfile = {
        mint: product.contractAddress,
        program: program === "spl-token-2022" ? "spl-token-2022" : "spl-token",
        extensions,
        transferHookProgramId: hookProgram,
      };
      const quoteMint: MintProfile = { mint: USDC.mintAddress, program: "spl-token", extensions: [] };
      const buy = assessPolicySide("BUY", { stock, quote: quoteMint }).status;
      const sell = assessPolicySide("SELL", { stock, quote: quoteMint }).status;
      const reasons: string[] = [];
      if (lifecycle !== "CURRENT") reasons.push("lifecycle notice");
      if (!mintValid) reasons.push("mint invalid");
      if (!token || token.id !== product.contractAddress) reasons.push("not recognized by Jupiter");
      if (token && decimals !== null && token.decimals !== decimals) reasons.push("decimals mismatch");
      if (!routeOut) reasons.push("no USDC route");
      if (buy !== "COMPATIBLE") reasons.push("BUY deposit restricted");
      if (!product.tokenPriceUsd) reasons.push("no token price");
      results.push({
        product,
        lifecycle,
        mintValid,
        program,
        decimals,
        extensions,
        jupiterRecognized: Boolean(token && token.id === product.contractAddress),
        jupiterDecimals: token?.decimals ?? null,
        routeOut,
        routeLabel,
        buy,
        sell,
        eligible: reasons.length === 0,
        reason: reasons.join(", ") || "all checks passed",
      });
    }
    const eligible = results.filter((r) => r.eligible);
    summary.push(["eligible pre-IPO items", String(eligible.length)]);
    for (const r of results) {
      lines.push(
        [
          r.product.symbol.padEnd(11),
          r.product.contractAddress,
          `dec ${r.decimals ?? "?"}`,
          r.program === "spl-token-2022" ? "Token-2022" : r.program,
          `jup ${r.jupiterRecognized ? "YES" : "NO"}`,
          `route ${r.routeOut ? `YES out ${r.routeOut} (${r.routeLabel})` : `NO (${r.routeLabel})`}`,
          `ext [${r.extensions.join(",") || "none"}]`,
          `BUY ${r.buy}`,
          `SELL ${r.sell}`,
          `mark $${r.product.markPriceUsd}`,
          `token $${r.product.tokenPriceUsd ?? "n/a"}`,
          `premium ${r.product.premiumPercent ?? "n/a"}%`,
          `status ${r.lifecycle === "CURRENT" ? "CURRENT" : `NOTICE: ${r.lifecycle.slice(0, 90)}`}`,
          r.eligible ? "ELIGIBLE" : `NOT ELIGIBLE (${r.reason})`,
        ].join(" | "),
      );
    }
    expect(results.length).toBe(products.length);
  }, 240_000);

  it("re-verifies the curated technical candidate", () => {
    const curated = PRESTOCKS_ASSETS[0];
    if (!curated) {
      selected.push(["Selected technical candidate", "NONE CONFIGURED"]);
      return;
    }
    const row = results.find((r) => r.product.contractAddress === curated.mintAddress);
    const pass = (ok: boolean | undefined) => (ok ? "PASS" : "FAIL");
    selected.push(["Selected technical candidate", curated.symbol]);
    selected.push(["Exact mint", pass(row !== undefined && row.product.symbol === curated.reference.symbol)]);
    selected.push(["Solana mint", pass(row?.mintValid && row.decimals === curated.decimals && row.program === curated.tokenProgram)]);
    selected.push(["Jupiter token recognition", pass(row?.jupiterRecognized && row.jupiterDecimals === curated.decimals)]);
    selected.push(["USDC → token route", pass(Boolean(row?.routeOut))]);
    selected.push(["BUY Trigger compatibility", row?.buy === "COMPATIBLE" ? "PASS (documented deposit-mint rule; live deposit craft NOT TESTED)" : "FAIL"]);
    selected.push(["SELL Trigger compatibility", row ? `${row.sell} (live SELL disabled)` : "?"]);
    selected.push(["Product status", row?.lifecycle ?? "?"]);
    selected.push(["Live funded order", "NOT TESTED"]);
    expect(row?.eligible).toBe(true);
  });
});

export { results as prestocksProbeResults, TOKEN_2022 };
