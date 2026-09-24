import { describe, expect, it, vi } from "vitest";
import { premiumLabel } from "@/components/prestocks/mark-summary";
import { AppError } from "@/src/domain/errors";
import { Dec } from "@/src/domain/money";
import { compileTriggerUsd } from "@/src/domain/policy";
import { createPrestocksClient, PrestocksRequestError } from "@/src/integrations/prestocks/client";
import { mapPrestocksItem, premiumToMarkPercent } from "@/src/integrations/prestocks/mapper";
import { ANDURIL_MINT, ANTHROPIC_MINT, prestocksResponseText, SPACEX_MINT } from "../fixtures/references";

function clientReturning(body: string, status = 200) {
  const fetchImpl = vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
  return { client: createPrestocksClient({ fetchImpl, now: () => new Date("2026-09-24T06:40:00.000Z") }), fetchImpl };
}

async function failure(promise: Promise<unknown>): Promise<PrestocksRequestError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PrestocksRequestError);
    return error as PrestocksRequestError;
  }
  throw new Error("expected failure");
}

describe("PreStocks client", () => {
  it("maps the current catalog shape with exact source digits, first-party URLs and exact mints", async () => {
    const { client, fetchImpl } = clientReturning(prestocksResponseText());
    const catalog = await client.fetchCatalog();
    expect(fetchImpl).toHaveBeenCalledWith("https://prestocks.com/api/prestocks", expect.objectContaining({ cache: "no-store" }));
    expect(catalog.receivedAt.toISOString()).toBe("2026-09-24T06:40:00.000Z");
    expect(catalog.products.map((p) => p.contractAddress)).toEqual([ANTHROPIC_MINT, ANDURIL_MINT, SPACEX_MINT]);
    const anduril = catalog.products[1]!;
    // Lexical digits preserved: never round-tripped through a JS number.
    expect(anduril.markPriceUsd).toBe("152.58461595");
    expect(anduril.tokenPriceUsd).toBe("149.84259417358612");
    expect(anduril.productUrl).toBe("https://www.prestocks.com/anduril");
    expect(catalog.products[0]).toMatchObject({ symbol: "ANTHROPIC", markPriceUsd: "1000", tokenPriceUsd: "1020", premiumPercent: "2.00" });
    expect(catalog.rejectedCount).toBe(0);
  });

  it("skips malformed items without discarding the good ones", async () => {
    const extra = `,
      {"name":"Bad mint","symbol":"BAD","external_url":"https://www.prestocks.com/bad","contract_address":"not-a-mint","markPrice":1},
      {"name":"Zero mark","symbol":"ZERO","external_url":"https://www.prestocks.com/zero","contract_address":"${ANTHROPIC_MINT}","markPrice":0},
      {"name":"Foreign URL","symbol":"FOREIGN","external_url":"https://tessera.example/x","contract_address":"${ANTHROPIC_MINT}","markPrice":10},
      {"name":"Exponent","symbol":"EXP","external_url":"https://www.prestocks.com/exp","contract_address":"${ANTHROPIC_MINT}","markPrice":1e-7},
      "not an object"`;
    const catalog = await clientReturning(prestocksResponseText({ extra })).client.fetchCatalog();
    expect(catalog.products.map((p) => p.symbol)).toEqual(["ANTHROPIC", "ANDURIL", "SPACEX"]);
    expect(catalog.rejectedCount).toBe(5);
  });

  it("treats the token price as optional: no premium, but the mark still maps", async () => {
    const catalog = await clientReturning(prestocksResponseText({ anthropicToken: null })).client.fetchCatalog();
    expect(catalog.products[0]).toMatchObject({ markPriceUsd: "1000", tokenPriceUsd: null, premiumPercent: null });
  });

  it("fails safely on timeouts, network errors, non-200 and malformed responses", async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect((await failure(createPrestocksClient({ fetchImpl: timeout }).fetchCatalog())).reason).toBe("timeout");
    const network = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await failure(createPrestocksClient({ fetchImpl: network }).fetchCatalog())).reason).toBe("network");
    expect(await failure(clientReturning("oops", 503).client.fetchCatalog())).toMatchObject({ reason: "http_error", status: 503 });
    for (const body of ["<html>not json</html>", "{}", "[]", '[{"symbol":"X"}]']) {
      expect((await failure(clientReturning(body).client.fetchCatalog())).reason).toBe("malformed_response");
    }
  });

  it("ignores unknown provider fields", () => {
    const item = { name: "N", symbol: "N1", external_url: "https://prestocks.com/n", contract_address: ANTHROPIC_MINT, markPrice: "5", futureField: [1, 2] };
    expect(mapPrestocksItem(item)).toMatchObject({ symbol: "N1", markPriceUsd: "5" });
  });
});

describe("premium / discount to mark (exact decimals)", () => {
  it.each([
    ["1000", "1020", "2.00"],
    ["1000", "970", "-3.00"],
    ["1000", "1000", "0.00"],
    ["1037.77671708", "1030.6565848243488", "-0.69"],
    ["987654321987.12", "1000000000000", "1.25"],
  ])("mark %s, token %s → %s%%", (mark, token, expected) => {
    expect(premiumToMarkPercent(mark, token)).toBe(expected);
  });

  it("keeps very small differences exact at higher scale, with no float error", () => {
    expect(premiumToMarkPercent("1000", "1000.01", 4)).toBe("0.0010");
    expect(premiumToMarkPercent("0.1", "0.3", 6)).toBe("200.000000"); // 0.1 + 0.2 style float traps do not apply
    const exact = new Dec("1030.6565848243488").minus("1037.77671708").dividedBy("1037.77671708").times(100);
    expect(premiumToMarkPercent("1037.77671708", "1030.6565848243488", 12)).toBe(exact.toFixed(12, Dec.ROUND_HALF_EVEN));
  });

  it("labels neutrally: premium, discount or at mark", () => {
    expect(premiumLabel("2.00")).toEqual({ label: "Premium to mark", value: "2.00%" });
    expect(premiumLabel("-1.39")).toEqual({ label: "Discount to mark", value: "1.39%" });
    expect(premiumLabel("0.00")).toEqual({ label: "At mark", value: "0.00%" });
    expect(premiumLabel(null)).toBeNull();
  });
});

describe("mark-relative compilation reuses the deterministic compiler", () => {
  const mark = { priceUsd: "1000", freshness: "CURRENT_RESPONSE" as const };
  it("3% below a 1000 mark → 970.00; 2% above → 1020.00", () => {
    expect(compileTriggerUsd({ direction: "BELOW", expressionType: "RELATIVE_PERCENT", expressionValue: "3", reference: mark }).compiledTriggerUsd).toBe("970.00");
    expect(compileTriggerUsd({ direction: "ABOVE", expressionType: "RELATIVE_PERCENT", expressionValue: "2", reference: mark }).compiledTriggerUsd).toBe("1020.00");
  });

  it("rounds a source-precision mark to cents in the stricter direction only", () => {
    const precise = { priceUsd: "1037.77671708", freshness: "CURRENT_RESPONSE" as const };
    // 1037.77671708 × 0.97 = 1006.6434155676 → BELOW rounds down
    expect(compileTriggerUsd({ direction: "BELOW", expressionType: "RELATIVE_PERCENT", expressionValue: "3", reference: precise }).compiledTriggerUsd).toBe("1006.64");
    // 1037.77671708 × 1.02 = 1058.5322514216 → ABOVE rounds up
    expect(compileTriggerUsd({ direction: "ABOVE", expressionType: "RELATIVE_PERCENT", expressionValue: "2", reference: precise }).compiledTriggerUsd).toBe("1058.54");
  });

  it("still blocks relative triggers without a reference", () => {
    expect(() => compileTriggerUsd({ direction: "BELOW", expressionType: "RELATIVE_PERCENT", expressionValue: "3", reference: null })).toThrow(AppError);
  });
});

describe("browser input boundary", () => {
  it("a create-policy request cannot carry a mark, token price, provider or contract address", async () => {
    const { createPolicyRequestSchema } = await import("@/src/validation/policy");
    const base = { assetId: "00000000-0000-4000-8000-000000000001", side: "BUY", triggerDirection: "BELOW", expressionType: "RELATIVE_PERCENT", expressionValue: "3", amount: "25", maxSlippageBps: 50, expiryHours: 24 };
    expect(createPolicyRequestSchema.safeParse(base).success).toBe(true);
    for (const extra of [{ markPrice: "1" }, { tokenPrice: "1" }, { referenceProvider: "PRESTOCKS" }, { provider: "PYTH" }, { contractAddress: ANTHROPIC_MINT }, { referenceUsd: "1" }]) {
      expect(createPolicyRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });
});
