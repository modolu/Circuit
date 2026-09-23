import { describe, expect, it, vi } from "vitest";
import { createJupiterClient, JupiterRequestError } from "@/src/integrations/jupiter/client";
import { createLogger, REDACTED } from "@/src/observability/logger";
import * as f from "../fixtures/jupiter";

const KEY = "jup_test_key_not_real_0123456789";

function clientReturning(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { client: createJupiterClient({ apiKey: KEY, fetchImpl }), calls };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JupiterRequestError);
    return error as JupiterRequestError;
  }
  throw new Error("expected failure");
}

describe("Jupiter client (read-only calls)", () => {
  it("returns a token only for an exact mint match", async () => {
    const { client, calls } = clientReturning(f.tokenSearchFixture);
    expect((await client.findTokenByMint(f.AAPLX_MINT))?.decimals).toBe(8);
    expect(calls[0]!.url).toBe(`https://api.jup.ag/tokens/v2/search?query=${f.AAPLX_MINT}`);
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    const fuzzy = clientReturning([{ ...f.tokenSearchFixture[0], id: f.USDC_MINT }]);
    expect(await fuzzy.client.findTokenByMint(f.AAPLX_MINT)).toBeNull();
  });

  it("never sends a taker when quoting, and refuses a quote that carries a transaction", async () => {
    const { client, calls } = clientReturning(f.swapQuoteFixture);
    await client.quoteRoute({ inputMint: f.USDC_MINT, outputMint: f.AAPLX_MINT, amountAtomic: 10_500_000n });
    expect(new URL(calls[0]!.url).searchParams.has("taker")).toBe(false);
    const withTx = clientReturning({ ...f.swapQuoteFixture, transaction: "AAAA" });
    expect((await failure(withTx.client.quoteRoute({ inputMint: f.USDC_MINT, outputMint: f.AAPLX_MINT, amountAtomic: 1n }))).reason).toBe("malformed_response");
  });

  it("distinguishes a gateway permission 403 from a Trigger-service 403, without leaking the key", async () => {
    const gateway = clientReturning({ code: 403, message: `API key ${KEY} does not have access to this endpoint` }, 403);
    const g = await failure(gateway.client.requestAuthChallenge(f.FAKE_WALLET, "message"));
    expect(g.reason).toBe("gateway_forbidden");
    expect(`${g.message} ${g.providerMessage}`).not.toContain(KEY);

    const service = clientReturning({ error: "userPubkey does not match the authenticated wallet" }, 403);
    expect((await failure(service.client.requestAuthChallenge(f.FAKE_WALLET, "message"))).reason).toBe("forbidden");
  });

  it("validates challenge responses and surfaces 400 details as bad_request", async () => {
    const ok = clientReturning(f.messageChallengeFixture);
    expect((await ok.client.requestAuthChallenge(f.FAKE_WALLET, "message")).type).toBe("message");
    const bad = clientReturning({ error: "Request validation failed", details: { type: "Invalid option" } }, 400);
    expect((await failure(bad.client.requestAuthChallenge(f.FAKE_WALLET, "message"))).reason).toBe("bad_request");
    const malformed = clientReturning({ type: "message" });
    expect((await failure(malformed.client.requestAuthChallenge(f.FAKE_WALLET, "message"))).reason).toBe("malformed_response");
  });
});

describe("secret handling", () => {
  it("redacts JWT-shaped values, API keys and transactions from logs", () => {
    const lines: string[] = [];
    const log = createLogger({}, (line) => lines.push(line));
    log.info("jupiter.debug", {
      headers: { "x-api-key": KEY, Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig" },
      token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig",
      depositSignedTx: "AQAAAAAAAAAAAAAsignedtx",
      signedTransaction: "AQAAAAAAAAAAAAAsignedtx",
      transaction: "AQAAAAAAAAAAAAAunsignedtx",
      challenge: f.messageChallengeFixture.challenge,
      triggerMint: f.AAPLX_MINT,
    });
    const entry = JSON.parse(lines[0]!);
    expect(entry.headers).toEqual({ "x-api-key": REDACTED, Authorization: REDACTED });
    for (const key of ["token", "depositSignedTx", "signedTransaction", "transaction", "challenge"]) expect(entry[key]).toBe(REDACTED);
    expect(entry.triggerMint).toBe(f.AAPLX_MINT);
  });
});
