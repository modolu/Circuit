import { describe, expect, it, vi } from "vitest";
import { createPythClient, PythRequestError } from "@/src/integrations/pyth/client";
import { equityResponseText } from "../fixtures/pyth";

const KEY = "test-pyth-key-not-real";

function clientWith(respond: (init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(init ?? {});
  }) as unknown as typeof fetch;
  return { client: createPythClient({ apiKey: KEY, baseUrl: "https://pyth.test", fetchImpl }), calls };
}

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PythRequestError);
    return (error as PythRequestError).reason;
  }
  throw new Error("expected failure");
}

describe("Pyth REST client", () => {
  it("POSTs the documented latest_price request with a bearer key", async () => {
    const { client, calls } = clientWith(() => new Response(equityResponseText(), { status: 200 }));
    const { response } = await client.latestPrice({ feedIds: [922], channel: "fixed_rate@200ms" });

    expect(calls[0]!.url).toBe("https://pyth.test/v1/latest_price");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      priceFeedIds: [922],
      properties: ["price", "exponent", "confidence", "publisherCount", "marketSession", "feedUpdateTimestamp", "bestBidPrice", "bestAskPrice"],
      formats: [],
      channel: "fixed_rate@200ms",
      parsed: true,
    });
    expect(response.parsed.priceFeeds[0]!.confidence).toBe("1250");
  });

  it("classifies provider failures without leaking the key", async () => {
    expect(await reason(clientWith(() => new Response("Not entitled: feed 922", { status: 403 })).client.latestPrice({ feedIds: [922], channel: "fixed_rate@200ms" }))).toBe("not_entitled");
    expect(await reason(clientWith(() => new Response("", { status: 401 })).client.latestPrice({ feedIds: [922], channel: "fixed_rate@200ms" }))).toBe("unauthorized");
    expect(await reason(clientWith(() => new Response("", { status: 503 })).client.latestPrice({ feedIds: [922], channel: "fixed_rate@200ms" }))).toBe("http_error");
    expect(await reason(clientWith(() => new Response("<html>", { status: 200 })).client.latestPrice({ feedIds: [922], channel: "fixed_rate@200ms" }))).toBe("malformed_response");
    expect(await reason(clientWith(() => new Response('{"parsed":{}}', { status: 200 })).client.latestPrice({ feedIds: [922], channel: "fixed_rate@200ms" }))).toBe("malformed_response");
    expect(await reason(clientWith(() => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }).client.latestPrice({ feedIds: [922], channel: "fixed_rate@200ms" }))).toBe("timeout");

    const error = new PythRequestError("not_entitled", 403);
    expect(error.message).not.toContain(KEY);
  });

  it("refuses to call Pyth without a key", async () => {
    const client = createPythClient({ apiKey: undefined, fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(await reason(client.latestPrice({ feedIds: [922], channel: "fixed_rate@200ms" }))).toBe("missing_api_key");
  });
});
