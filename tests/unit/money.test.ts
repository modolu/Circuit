import { describe, expect, it } from "vitest";
import {
  applyPercentChange,
  bpsToPercent,
  formatTokenAmount,
  formatUsd,
  fromAtomicUnits,
  parsePositiveDecimal,
  percentDifference,
  roundToScale,
  toAtomicUnits,
} from "@/src/domain/money";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return "NO_ERROR";
};

describe("display ↔ atomic", () => {
  it.each([
    ["100", 6, 100_000_000n],
    ["0.25", 8, 25_000_000n],
    ["0.000001", 6, 1n],
    ["1", 0, 1n],
    ["12.5", 2, 1250n],
    ["100.000000", 6, 100_000_000n],
    ["100.0000000", 6, 100_000_000n], // trailing zeros beyond the scale add no precision
    [" 42.1 ", 6, 42_100_000n],
  ])("%s at %d decimals → %s", (display, decimals, atomic) => {
    expect(toAtomicUnits(display, decimals)).toBe(atomic);
  });

  it("keeps very large amounts exact", () => {
    const display = "123456789012345678901234567890.12345678";
    const atomic = toAtomicUnits(display, 8);
    expect(atomic).toBe(12345678901234567890123456789012345678n);
    expect(fromAtomicUnits(atomic, 8)).toBe(display);
  });

  it.each([
    [100_000_000n, 6, "100"],
    [1n, 6, "0.000001"],
    [25_000_000n, 8, "0.25"],
    [0n, 6, "0"],
    [5n, 0, "5"],
    [-150n, 2, "-1.5"],
  ])("%s at %d decimals → %s", (atomic, decimals, display) => {
    expect(fromAtomicUnits(atomic, decimals)).toBe(display);
  });

  it("round-trips across decimals", () => {
    for (const [display, decimals] of [["0.1", 1], ["987654.321", 3], ["1.23456789", 8], ["1000000", 6]] as const) {
      expect(fromAtomicUnits(toAtomicUnits(display, decimals), decimals)).toBe(display);
    }
  });

  it.each([
    ["0"],
    ["0.000"],
    ["-1"],
    ["1e3"],
    ["1,000"],
    [""],
    ["abc"],
    [".5"],
    ["01.5x"],
  ])("rejects %j", (bad) => {
    expect(code(() => toAtomicUnits(bad, 6))).toBe("VALIDATION_ERROR");
  });

  it("rejects more decimal places than the token supports instead of rounding", () => {
    expect(code(() => toAtomicUnits("1.0000001", 6))).toBe("VALIDATION_ERROR");
    expect(code(() => toAtomicUnits("0.123456789", 8))).toBe("VALIDATION_ERROR");
  });
});

describe("decimal arithmetic", () => {
  it("applies percentages exactly", () => {
    expect(applyPercentChange("200", "3", "DECREASE").toString()).toBe("194");
    expect(applyPercentChange("200.00", "3", "INCREASE").toString()).toBe("206");
    expect(applyPercentChange("227.35", "1", "DECREASE").toString()).toBe("225.0765");
    expect(applyPercentChange("123456789.12345", "3.25", "DECREASE").toString()).toBe("119444443.476937875");
  });

  it("rounds only with an explicit mode", () => {
    expect(roundToScale("194.005", 2, "DOWN")).toBe("194.00");
    expect(roundToScale("194.005", 2, "UP")).toBe("194.01");
    expect(roundToScale("194.005", 2, "HALF_EVEN")).toBe("194.00");
    expect(roundToScale("194.015", 2, "HALF_EVEN")).toBe("194.02");
    expect(roundToScale("194", 2, "UP")).toBe("194.00");
  });

  it("computes display percent differences", () => {
    expect(percentDifference("200", "194")).toBe("-3.00");
    expect(percentDifference("184.20", "181.00")).toBe("-1.74");
  });

  it("formats basis points and money without floats", () => {
    expect([25, 50, 100, 10_000].map(bpsToPercent)).toEqual(["0.25", "0.50", "1.00", "100.00"]);
    expect(formatUsd("1234567.8")).toBe("$1,234,567.80");
    expect(formatUsd("0.00005")).toBe("$0.00005");
    expect(formatTokenAmount("1234.5")).toBe("1,234.5");
  });

  it("canonicalises validated input and rejects ambiguous forms", () => {
    expect(parsePositiveDecimal("181.50", { label: "x", maxFractionDigits: 2 })).toBe("181.5");
    expect(parsePositiveDecimal("0.50", { label: "x", maxFractionDigits: 2 })).toBe("0.5");
    expect(code(() => parsePositiveDecimal("0181.50", { label: "x", maxFractionDigits: 2 }))).toBe("VALIDATION_ERROR");
  });
});
