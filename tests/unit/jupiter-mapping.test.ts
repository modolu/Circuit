import { describe, expect, it } from "vitest";
import {
  JupiterMappingError,
  JUPITER_TRIGGER_MIN_ORDER_USD,
  meetsProviderMinimum,
  normalizeJupiterOrderState,
  toCreatePriceOrderRequest,
  toDepositCraftRequest,
  toJupiterSinglePriceOrderIntent,
  toProviderExpiry,
  toProviderPriceNumber,
  type CompiledPolicyForJupiter,
} from "@/src/integrations/jupiter/trigger";
import { createSinglePriceOrderRequestSchema, depositCraftRequestSchema } from "@/src/integrations/jupiter/schemas";
import { AAPLX_MINT, FAKE_WALLET, USDC_MINT } from "../fixtures/jupiter";

const NOW = new Date("2026-09-23T12:00:00.000Z");
const EXPIRES = new Date("2026-09-24T12:00:00.000Z");
const mints = { stockMint: AAPLX_MINT, quoteMint: USDC_MINT, now: NOW };

function policy(side: "BUY" | "SELL", triggerDirection: "ABOVE" | "BELOW", overrides: Partial<CompiledPolicyForJupiter> = {}): CompiledPolicyForJupiter {
  return {
    side,
    triggerDirection,
    inputMint: side === "BUY" ? USDC_MINT : AAPLX_MINT,
    outputMint: side === "BUY" ? AAPLX_MINT : USDC_MINT,
    inputAmountAtomic: side === "BUY" ? 10_500_000n : 3_200_000n,
    compiledTriggerUsd: "181.00",
    slippageBps: 50,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

describe("Circuit → Trigger V2 single price order", () => {
  it.each([
    ["BUY", "BELOW", USDC_MINT, AAPLX_MINT, "below"],
    ["BUY", "ABOVE", USDC_MINT, AAPLX_MINT, "above"],
    ["SELL", "ABOVE", AAPLX_MINT, USDC_MINT, "above"],
    ["SELL", "BELOW", AAPLX_MINT, USDC_MINT, "below"],
  ] as const)("%s %s → input %s, output %s, %s", (side, direction, inputMint, outputMint, condition) => {
    const intent = toJupiterSinglePriceOrderIntent(policy(side, direction), mints);
    expect(intent).toMatchObject({ orderType: "single", inputMint, outputMint, triggerCondition: condition });
    // The monitored token is always the stock: output on BUY, input on SELL.
    expect(intent.triggerMint).toBe(AAPLX_MINT);
    expect(intent.triggerMint).toBe(side === "BUY" ? intent.outputMint : intent.inputMint);
  });

  it("keeps amounts as atomic strings, sends slippage explicitly and expiry in milliseconds", () => {
    const intent = toJupiterSinglePriceOrderIntent(policy("BUY", "BELOW"), mints);
    expect(intent.inputAmount).toBe("10500000");
    expect(intent.slippageBps).toBe(50);
    expect(intent.expiresAt).toBe(1790251200000);
    expect(intent.expiresAt).toBe(EXPIRES.getTime());
  });

  it("rejects mints that do not match the side, bad slippage and past expiry", () => {
    expect(() => toJupiterSinglePriceOrderIntent(policy("BUY", "BELOW", { inputMint: AAPLX_MINT, outputMint: USDC_MINT }), mints)).toThrow(JupiterMappingError);
    expect(() => toJupiterSinglePriceOrderIntent(policy("BUY", "BELOW", { slippageBps: 10_001 }), mints)).toThrow(JupiterMappingError);
    expect(() => toJupiterSinglePriceOrderIntent(policy("BUY", "BELOW", { expiresAt: NOW }), mints)).toThrow(JupiterMappingError);
    for (const bps of [25, 50, 100]) expect(toJupiterSinglePriceOrderIntent(policy("BUY", "BELOW", { slippageBps: bps }), mints).slippageBps).toBe(bps);
  });

  it("builds deposit-craft and create bodies that satisfy the documented schemas", () => {
    const intent = toJupiterSinglePriceOrderIntent(policy("BUY", "BELOW"), mints);
    const deposit = toDepositCraftRequest(intent, FAKE_WALLET);
    expect(depositCraftRequestSchema.parse(deposit)).toEqual({
      inputMint: USDC_MINT,
      outputMint: AAPLX_MINT,
      userAddress: FAKE_WALLET,
      amount: "10500000",
      orderType: "price",
      orderSubType: "single",
    });
    const create = toCreatePriceOrderRequest(intent, { depositRequestId: "req-id", depositSignedTx: "PLACEHOLDER", userPubkey: FAKE_WALLET });
    expect(createSinglePriceOrderRequestSchema.safeParse(create).success).toBe(true);
    expect(JSON.stringify(create)).toContain('"triggerPriceUsd":181');
  });
});

describe("provider numeric boundary", () => {
  it.each([
    ["181.00", 181, "181"],
    ["181.5", 181.5, "181.5"],
    ["220.53", 220.53, "220.53"],
    ["0.01", 0.01, "0.01"],
    ["119444443.47", 119444443.47, "119444443.47"],
  ])("%s → JSON number %s (serialized %s)", (decimal, number, serialized) => {
    const value = toProviderPriceNumber(decimal);
    expect(value).toBe(number);
    expect(JSON.stringify(value)).toBe(serialized);
  });

  it("refuses values a JSON number cannot carry exactly", () => {
    for (const bad of ["1234567890123456.78", "0", "-5", "1e3", "abc", "", "9007199254740993"]) {
      expect(() => toProviderPriceNumber(bad), bad).toThrow(JupiterMappingError);
    }
  });

  it("maps UTC expiry to integer milliseconds without touching stored dates", () => {
    const stored = new Date("2026-09-30T00:00:00.000Z");
    expect(toProviderExpiry(stored, NOW)).toBe(Date.UTC(2026, 8, 30));
    expect(stored.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
});

describe("provider minimum and states", () => {
  it("checks the 10 USD minimum exactly", () => {
    expect(JUPITER_TRIGGER_MIN_ORDER_USD).toBe("10");
    expect(meetsProviderMinimum({ inputAmountAtomic: 10_000_000n, inputDecimals: 6, inputUsdPrice: "1" })).toEqual({ ok: true, usdValue: "10" });
    expect(meetsProviderMinimum({ inputAmountAtomic: 9_999_999n, inputDecimals: 6, inputUsdPrice: "1" }).ok).toBe(false);
    expect(meetsProviderMinimum({ inputAmountAtomic: 2_900_000n, inputDecimals: 8, inputUsdPrice: "336.9" }).ok).toBe(false);
    expect(meetsProviderMinimum({ inputAmountAtomic: 3_000_000n, inputDecimals: 8, inputUsdPrice: "336.9" })).toEqual({ ok: true, usdValue: "10.107" });
  });

  it("maps documented order states and never guesses unknown ones", () => {
    expect(["open", "filled", "cancelled", "expired", "failed"].map(normalizeJupiterOrderState)).toEqual(["OPEN", "FILLED", "CANCELLED", "EXPIRED", "FAILED"]);
    expect(["pending", "executing", "pending_withdraw"].map(normalizeJupiterOrderState)).toEqual(["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS"]);
    expect(normalizeJupiterOrderState("fill_success")).toBe("UNKNOWN"); // a rawState, not an orderState
    expect(normalizeJupiterOrderState("something_new")).toBe("UNKNOWN");
  });
});
