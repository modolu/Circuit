import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import nacl from "tweetnacl";
import { afterAll, describe, expect, it } from "vitest";
import { VERIFIED_ASSETS } from "@/src/config/assets";
import { getServerEnv } from "@/src/config/env";
import { USDC } from "@/src/config/tokens";
import { createJupiterClient, getJupiterClient, JupiterRequestError } from "@/src/integrations/jupiter/client";
import { assessPolicySide, type MintProfile } from "@/src/integrations/jupiter/token-compat";

/*
 * OPT-IN live Jupiter compatibility probe (`pnpm test:jupiter-live`). No funds:
 * no signing, no taker, no vault registration, no deposit, no order. Prints a
 * summary through stdout and never the API key.
 */

const aaplx = VERIFIED_ASSETS.find((asset) => asset.symbol === "AAPLx")!;
const hasKey = Boolean(getServerEnv().JUPITER_API_KEY);
const summary: Array<[string, string]> = [];
const record = (label: string, value: string) => summary.push([label, value]);
const describeError = (error: unknown) =>
  error instanceof JupiterRequestError ? `${error.reason}${error.status ? ` (HTTP ${error.status})` : ""}` : "unexpected error";

afterAll(() => {
  const width = Math.max(...summary.map(([label]) => label.length));
  process.stdout.write(`\n=== Jupiter live compatibility probe (no funds) ===\n`);
  for (const [label, value] of summary) process.stdout.write(`${label.padEnd(width)} : ${value}\n`);
  process.stdout.write(`${"Trigger JWT".padEnd(width)} : NOT TESTED (requires a wallet signature)\n`);
  process.stdout.write(`${"Vault".padEnd(width)} : NOT TESTED\n`);
  process.stdout.write(`${"Deposit craft".padEnd(width)} : NOT TESTED\n`);
  process.stdout.write(`${"Live order".padEnd(width)} : NOT TESTED\n\n`);
});

describe("Jupiter live probe", () => {
  const client = getJupiterClient();
  const keyless = createJupiterClient({ apiKey: undefined });

  it("API key accepted by the gateway", async () => {
    if (!hasKey) {
      record("Jupiter API key", "MISSING (set JUPITER_API_KEY in .env.local); key checks NOT TESTED");
      return;
    }
    try {
      await client.findTokenByMint(USDC.mintAddress);
      record("Jupiter API key", "PASS");
    } catch (error) {
      record("Jupiter API key", `FAIL: ${describeError(error)}`);
      throw error;
    }
  });

  it("AAPLx recognized by exact mint in Tokens V2", async () => {
    const token = await (hasKey ? client : keyless).findTokenByMint(aaplx.mintAddress);
    record(`AAPLx exact mint recognized${hasKey ? "" : " (keyless)"}`, token ? "PASS" : "FAIL");
    expect(token?.id).toBe(aaplx.mintAddress);
    record("AAPLx decimals (Jupiter / issuer)", `${token?.decimals} / ${aaplx.decimals}`);
    record("Token program (Jupiter)", token?.tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ? "Token-2022" : String(token?.tokenProgram));
    record("Jupiter verified / tags", `${token?.isVerified} / ${(token?.tags ?? []).join(",")}`);
    expect(token?.decimals).toBe(aaplx.decimals);
  });

  it("onchain Token-2022 extensions and BUY/SELL deposit compatibility", async () => {
    const conn = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
    const { value } = await conn.getParsedAccountInfo(new PublicKey(aaplx.mintAddress));
    const parsed = (value?.data as { program?: string; parsed?: { info?: { extensions?: Array<{ extension: string; state: Record<string, unknown> }> } } }) ?? {};
    const extensions = parsed.parsed?.info?.extensions ?? [];
    const hook = extensions.find((e) => e.extension === "transferHook");
    const scaled = extensions.find((e) => e.extension === "scaledUiAmountConfig");
    const stock: MintProfile = {
      mint: aaplx.mintAddress,
      program: parsed.program === "spl-token-2022" ? "spl-token-2022" : "spl-token",
      extensions: extensions.map((e) => e.extension),
      transferHookProgramId: (hook?.state.programId as string | null | undefined) ?? undefined,
    };
    const quote: MintProfile = { mint: USDC.mintAddress, program: "spl-token", extensions: [] };
    const restricted = stock.extensions.filter((e) => e === "transferFeeConfig" || e === "transferHook");
    record("Onchain extensions", stock.extensions.join(", "));
    record("Forbidden deposit extensions", restricted.length ? restricted.join(", ") + (hook ? ` (hook programId ${String(hook.state.programId)})` : "") : "none");
    if (scaled) record("ScaledUiAmount multiplier", `${String(scaled.state.multiplier)} → ${String(scaled.state.newMultiplier)} @ ${String(scaled.state.newMultiplierEffectiveTimestamp)}`);
    record("BUY USDC → AAPLx deposit", assessPolicySide("BUY", { stock, quote }).status);
    record("SELL AAPLx → USDC deposit", assessPolicySide("SELL", { stock, quote }).status);
    expect(parsed.program).toBe("spl-token-2022");
  });

  it("USDC → AAPLx spot route (quote only, no taker)", async () => {
    try {
      const quoteResult = await (hasKey ? client : keyless).quoteRoute({
        inputMint: USDC.mintAddress,
        outputMint: aaplx.mintAddress,
        amountAtomic: 10_500_000n,
      });
      const labels = (quoteResult.routePlan ?? []).map((r) => r.swapInfo?.label).filter(Boolean).join("+");
      record("USDC → AAPLx route (10.5 USDC)", `PASS (out ${quoteResult.outAmount} raw, ${quoteResult.router ?? "?"}${labels ? `/${labels}` : ""})`);
      expect(BigInt(quoteResult.outAmount)).toBeGreaterThan(0n);
    } catch (error) {
      record("USDC → AAPLx route (10.5 USDC)", `FAIL: ${describeError(error)}`);
      throw error;
    }
  });

  it("Trigger V2 auth challenge (permission check with key; reachability without)", async () => {
    const throwaway = new PublicKey(nacl.sign.keyPair().publicKey).toBase58();
    if (!hasKey) {
      try {
        const challenge = await keyless.requestAuthChallenge(throwaway, "message");
        record("Trigger endpoint (keyless)", `REACHABLE (challenge type ${challenge.type}); key permission NOT TESTED`);
      } catch (error) {
        record("Trigger endpoint (keyless)", `FAIL: ${describeError(error)}`);
      }
      return;
    }
    try {
      const challenge = await client.requestAuthChallenge(throwaway, "message");
      record("Trigger endpoint permission", `PASS (challenge type ${challenge.type})`);
    } catch (error) {
      record(
        "Trigger endpoint permission",
        error instanceof JupiterRequestError && error.reason === "gateway_forbidden"
          ? "FAIL: API key lacks Trigger permission (gateway 403)"
          : `FAIL: ${describeError(error)}`,
      );
      throw error;
    }
  });
});
