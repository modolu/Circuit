import { describe, expect, it } from "vitest";
import { USDC } from "@/src/config/tokens";
import { compilePolicy, type CompilePolicyInput } from "@/src/services/compile-policy";

// Fictional test asset. Never seeded, never rendered in production.
const TEST_ASSET = { symbol: "TEST_ASSET", underlyingSymbol: "TEST", mintAddress: "TEST_MINT_NOT_REAL", decimals: 8 };
const NOW = new Date("2026-09-23T12:00:00.000Z");
const IN_24H = new Date("2026-09-24T12:00:00.000Z");

function input(overrides: Partial<CompilePolicyInput> = {}): CompilePolicyInput {
  return {
    asset: TEST_ASSET,
    quote: USDC,
    side: "BUY",
    triggerDirection: "BELOW",
    expressionType: "ABSOLUTE_PRICE",
    expressionValue: "181",
    amount: "100",
    maxSlippageBps: 50,
    now: NOW,
    expiresAt: IN_24H,
    referenceSnapshot: { priceUsd: "200.00", freshness: "FRESH" },
    ...overrides,
  };
}

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return "NO_ERROR";
};

describe("compilePolicy: absolute triggers", () => {
  it.each([
    ["BUY", "BELOW", "181", "AT_OR_BELOW"],
    ["BUY", "ABOVE", "215", "AT_OR_ABOVE"],
    ["SELL", "ABOVE", "220", "AT_OR_ABOVE"],
    ["SELL", "BELOW", "170", "AT_OR_BELOW"],
  ] as const)("%s %s $%s", (side, triggerDirection, price, condition) => {
    const amount = side === "BUY" ? "100" : "0.25";
    const compiled = compilePolicy(input({ side, triggerDirection, expressionValue: price, amount }));
    expect(compiled.compiledTriggerUsd).toBe(`${price}.00`);
    expect(compiled.triggerCondition).toBe(condition);
    expect(compiled.orderFamily).toBe("SINGLE_PRICE_TRIGGER");
    if (side === "BUY") {
      expect([compiled.inputMint, compiled.outputMint]).toEqual([USDC.mintAddress, TEST_ASSET.mintAddress]);
      expect(compiled.inputAmountAtomic).toBe(100_000_000n);
    } else {
      expect([compiled.inputMint, compiled.outputMint]).toEqual([TEST_ASSET.mintAddress, USDC.mintAddress]);
      expect(compiled.inputAmountAtomic).toBe(25_000_000n);
    }
    expect(compiled.expiresAt.toISOString()).toBe(IN_24H.toISOString());
  });

  it("does not need the reference mathematically, but reports the distance and an already-met condition", () => {
    const compiled = compilePolicy(input({ expressionValue: "210" }));
    expect(compiled.compiledTriggerUsd).toBe("210.00");
    expect(compiled.distanceFromReferencePercent).toBe("5.00");
    expect(compiled.warnings).toEqual(["TRIGGER_ALREADY_MET"]);
  });
});

describe("compilePolicy: relative triggers", () => {
  it.each([
    ["BELOW", "3", "200.00", "194.00"],
    ["ABOVE", "3", "200.00", "206.00"],
    ["BELOW", "1", "227.35", "225.07"],
    ["ABOVE", "1", "227.35", "229.63"],
    ["BELOW", "3.25", "123456789.12345", "119444443.47"],
  ] as const)("%s %s%% from $%s → $%s", (triggerDirection, pct, priceUsd, expected) => {
    const compiled = compilePolicy(
      input({
        triggerDirection,
        expressionType: "RELATIVE_PERCENT",
        expressionValue: pct,
        referenceSnapshot: { priceUsd, freshness: "FRESH" },
      }),
    );
    expect(compiled.compiledTriggerUsd).toBe(expected);
    expect(compiled.sourceExpressionValue).toBe(pct);
  });
});

describe("compilePolicy: reference freshness", () => {
  it("STALE blocks every draft", () => {
    for (const expressionType of ["ABSOLUTE_PRICE", "RELATIVE_PERCENT"] as const) {
      expect(
        errorCode(() => compilePolicy(input({ expressionType, expressionValue: "3", referenceSnapshot: { priceUsd: "200", freshness: "STALE" } }))),
      ).toBe("REFERENCE_STALE");
    }
  });

  it("CARRIED blocks relative triggers but allows absolute ones", () => {
    const carried = { priceUsd: "200", freshness: "CARRIED" as const };
    expect(errorCode(() => compilePolicy(input({ expressionType: "RELATIVE_PERCENT", expressionValue: "3", referenceSnapshot: carried })))).toBe(
      "REFERENCE_STALE",
    );
    expect(compilePolicy(input({ referenceSnapshot: carried })).compiledTriggerUsd).toBe("181.00");
  });
});

describe("compilePolicy: validation", () => {
  it.each([
    [{ maxSlippageBps: 75 }, "VALIDATION_ERROR"],
    [{ maxSlippageBps: 10_000 }, "VALIDATION_ERROR"],
    [{ expiresAt: NOW }, "VALIDATION_ERROR"],
    [{ expiresAt: new Date(NOW.getTime() - 1) }, "VALIDATION_ERROR"],
    [{ expiresAt: new Date(NOW.getTime() + 169 * 3600 * 1000) }, "VALIDATION_ERROR"],
    [{ amount: "0" }, "VALIDATION_ERROR"],
    [{ amount: "-5" }, "VALIDATION_ERROR"],
    [{ amount: "1.0000001" }, "VALIDATION_ERROR"],
    [{ side: "SELL" as const, amount: "0.123456789" }, "VALIDATION_ERROR"],
    [{ expressionValue: "0" }, "VALIDATION_ERROR"],
  ])("rejects %o", (overrides, expected) => {
    expect(errorCode(() => compilePolicy(input(overrides)))).toBe(expected);
  });

  it("is deterministic: identical input gives identical output", () => {
    const relative = input({ expressionType: "RELATIVE_PERCENT", expressionValue: "2.5", referenceSnapshot: { priceUsd: "227.35123", freshness: "FRESH" } });
    expect(compilePolicy(relative)).toEqual(compilePolicy({ ...relative }));
  });
});
