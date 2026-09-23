import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  compileTriggerUsd,
  describePolicy,
  isTerminalStatus,
  POLICY_STATUSES,
  type PolicyStatus,
} from "@/src/domain/policy";

const ALLOWED: Array<[PolicyStatus, PolicyStatus]> = [
  ["DRAFT", "ARMING"],
  ["ARMING", "ARMED"],
  ["ARMING", "FAILED"],
  ["ARMED", "EXECUTED"],
  ["ARMED", "CANCELLED"],
  ["ARMED", "EXPIRED"],
  ["ARMED", "FAILED"],
  ["DRAFT", "CANCELLED"],
];

describe("policy state machine", () => {
  it("allows exactly the architecture's transitions", () => {
    for (const from of POLICY_STATUSES) {
      for (const to of POLICY_STATUSES) {
        const expected = ALLOWED.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it.each([
    ["EXECUTED", "ARMED"],
    ["CANCELLED", "EXECUTED"],
    ["EXPIRED", "ARMED"],
    ["DRAFT", "ARMED"],
    ["DRAFT", "EXECUTED"],
    ["FAILED", "ARMING"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(expect.objectContaining({ code: "POLICY_STATE_CONFLICT" }));
  });

  it("treats EXECUTED, CANCELLED, EXPIRED and FAILED as terminal", () => {
    expect(POLICY_STATUSES.filter(isTerminalStatus)).toEqual(["EXECUTED", "CANCELLED", "EXPIRED", "FAILED"]);
  });
});

describe("compileTriggerUsd", () => {
  const fresh = { priceUsd: "200.00", freshness: "FRESH" as const };

  it("keeps absolute prices unchanged at cent scale", () => {
    expect(compileTriggerUsd({ direction: "BELOW", expressionType: "ABSOLUTE_PRICE", expressionValue: "181", reference: null }))
      .toEqual({ sourceExpressionValue: "181", compiledTriggerUsd: "181.00" });
    expect(() => compileTriggerUsd({ direction: "BELOW", expressionType: "ABSOLUTE_PRICE", expressionValue: "181.005", reference: null }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("compiles relative triggers and rounds in the stricter direction", () => {
    const rel = (direction: "ABOVE" | "BELOW", expressionValue: string, priceUsd = "200.00") =>
      compileTriggerUsd({ direction, expressionType: "RELATIVE_PERCENT", expressionValue, reference: { priceUsd, freshness: "FRESH" } })
        .compiledTriggerUsd;
    expect(rel("BELOW", "3")).toBe("194.00");
    expect(rel("ABOVE", "3")).toBe("206.00");
    expect(rel("BELOW", "1", "227.35")).toBe("225.07"); // 225.0765 → down
    expect(rel("ABOVE", "1", "227.35")).toBe("229.63"); // 229.6235 → up
    expect(rel("BELOW", "0.5", "227.35123")).toBe("226.21"); // 226.21447385 → down
  });

  it("rejects percentages of 100 or more, and relative triggers without a usable reference", () => {
    const run = (value: string, reference: Parameters<typeof compileTriggerUsd>[0]["reference"]) =>
      () => compileTriggerUsd({ direction: "BELOW", expressionType: "RELATIVE_PERCENT", expressionValue: value, reference });
    expect(run("100", fresh)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(run("3", null)).toThrow(expect.objectContaining({ code: "REFERENCE_UNAVAILABLE" }));
    expect(run("3", { priceUsd: "200", freshness: "STALE" })).toThrow(expect.objectContaining({ code: "REFERENCE_STALE" }));
    expect(run("3", { priceUsd: "200", freshness: "CARRIED" })).toThrow(expect.objectContaining({ code: "REFERENCE_STALE" }));
  });
});

describe("describePolicy", () => {
  it("writes the absolute BUY sentence from structured fields", () => {
    expect(
      describePolicy({
        side: "BUY",
        direction: "BELOW",
        assetSymbol: "AAPLx",
        underlyingSymbol: "AAPL",
        quoteSymbol: "USDC",
        amountDisplay: "100",
        compiledTriggerUsd: "181.00",
        expressionType: "ABSOLUTE_PRICE",
        expressionValue: "181",
        referenceUsd: "184.20",
      }),
    ).toBe("Buy up to 100 USDC of AAPLx if the USD price falls to or below $181.00 before expiry.");
  });

  it("explains relative compilation and SELL wording", () => {
    expect(
      describePolicy({
        side: "SELL",
        direction: "ABOVE",
        assetSymbol: "AAPLx",
        underlyingSymbol: "AAPL",
        quoteSymbol: "USDC",
        amountDisplay: "0.25",
        compiledTriggerUsd: "206.00",
        expressionType: "RELATIVE_PERCENT",
        expressionValue: "3",
        referenceUsd: "200.00",
      }),
    ).toBe(
      "Sell 0.25 AAPLx for USDC if the USD price rises to or above $206.00 before expiry. Compiled from 3% above the captured Pyth AAPL reference of $200.00.",
    );
  });
});
