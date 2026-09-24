import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearJupiterSessionCookie,
  decodeJupiterSession,
  encodeJupiterSession,
  JUPITER_SESSION_COOKIE_NAME,
  readJupiterJwtFromRequest,
  setJupiterSessionCookie,
} from "@/src/auth/jupiter-session";
import { assetMetadataSchema, liveBuyDepositGate, type AssetMetadata } from "@/src/domain/asset";
import { AppError } from "@/src/domain/errors";
import { createJupiterClient, JupiterRequestError } from "@/src/integrations/jupiter/client";
import { createLogger, REDACTED } from "@/src/observability/logger";
import { signatureBase64ToBase58 } from "@/src/services/jupiter/auth";
import { toJupiterAppError } from "@/src/services/jupiter/errors";
import * as f from "../fixtures/jupiter";

const WALLET = "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV";
const OTHER = "11111111111111111111111111111112";
// JWT-shaped placeholder, not a real token.
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LW5vdC1yZWFsIn0.c2lnbmF0dXJlLW5vdC1yZWFs";

afterEach(() => vi.unstubAllEnvs());

describe("Jupiter session cookie", () => {
  it("binds the JWT to the Circuit wallet", () => {
    const value = encodeJupiterSession(WALLET, JWT);
    expect(decodeJupiterSession(value, WALLET)).toBe(JWT);
    expect(decodeJupiterSession(value, OTHER)).toBeNull();
    expect(decodeJupiterSession(undefined, WALLET)).toBeNull();
    expect(decodeJupiterSession(`${WALLET}~not a jwt`, WALLET)).toBeNull();
    expect(() => encodeJupiterSession(WALLET, "not-a-jwt")).toThrow(AppError);
  });

  it("is HttpOnly, SameSite=Lax, Path=/, at most 24h, and Secure outside HTTP localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://circuit.example");
    const response = NextResponse.json({});
    setJupiterSessionCookie(response, WALLET, JWT);
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain(`${JUPITER_SESSION_COOKIE_NAME}=`);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/Max-Age=86400/);
    expect(header).toMatch(/Secure/);
    expect(header).not.toContain("circuit_session=");
  });

  it("omits Secure only on HTTP localhost, and clears with Max-Age=0", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const response = NextResponse.json({});
    setJupiterSessionCookie(response, WALLET, JWT);
    expect(response.headers.get("set-cookie")).not.toMatch(/Secure/);
    const cleared = NextResponse.json({});
    clearJupiterSessionCookie(cleared);
    expect(cleared.headers.get("set-cookie")).toMatch(new RegExp(`${JUPITER_SESSION_COOKIE_NAME}=;.*Max-Age=0`));
  });

  it("reads the JWT from a request only for the bound wallet", () => {
    const cookie = `circuit_session=v1.x.y; ${JUPITER_SESSION_COOKIE_NAME}=${encodeURIComponent(encodeJupiterSession(WALLET, JWT))}`;
    const request = new Request("http://localhost:3000/api/jupiter/status", { headers: { cookie } });
    expect(readJupiterJwtFromRequest(request, WALLET)).toBe(JWT);
    expect(readJupiterJwtFromRequest(request, OTHER)).toBeNull();
  });

  it("redacts the Jupiter cookie and JWT from logs", () => {
    const lines: string[] = [];
    const log = createLogger({}, (line) => lines.push(line));
    log.info("x", { circuit_jupiter_session: "anything", jwt: JWT, note: `Bearer ${JWT}`, challenge: "sign me" });
    const out = lines.join("\n");
    expect(out).not.toContain(JWT);
    expect(out).not.toContain("sign me");
    expect(out).toContain(REDACTED);
  });
});

describe("Jupiter auth helpers", () => {
  it("converts a 64-byte base64 signature to base58 and rejects anything else", () => {
    const bytes = new Uint8Array(64).fill(7);
    const base58 = signatureBase64ToBase58(Buffer.from(bytes).toString("base64"));
    expect(base58).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(() => signatureBase64ToBase58(Buffer.from(new Uint8Array(63)).toString("base64"))).toThrow(AppError);
    expect(() => signatureBase64ToBase58("not base64!")).toThrow(AppError);
  });

  it("maps Jupiter failures to stable Circuit errors", () => {
    expect(toJupiterAppError(new JupiterRequestError("unauthorized", 401), "vault").code).toBe("PROVIDER_AUTH_REQUIRED");
    expect(toJupiterAppError(new JupiterRequestError("gateway_forbidden", 403), "vault").code).toBe("PROVIDER_UNAVAILABLE");
    expect(toJupiterAppError(new JupiterRequestError("forbidden", 403), "deposit").code).toBe("PROVIDER_REJECTED");
    expect(toJupiterAppError(new JupiterRequestError("bad_request", 400, "Amount too small"), "deposit").message).toContain("Amount too small");
    const timeout = toJupiterAppError(new JupiterRequestError("timeout"), "auth");
    expect(timeout.code).toBe("PROVIDER_UNAVAILABLE");
    expect(timeout.retryable).toBe(true);
  });
});

describe("Jupiter client auth and vault calls", () => {
  function clientWith(responses: Array<{ body: unknown; status: number }>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift() ?? { body: {}, status: 500 };
      return new Response(JSON.stringify(next.body), { status: next.status });
    }) as unknown as typeof fetch;
    return { client: createJupiterClient({ apiKey: "k_not_real", fetchImpl }), calls };
  }
  const vault = { userPubkey: WALLET, vaultPubkey: OTHER, privyVaultId: "privy-placeholder" };

  it("verifies a message signature in base58 and returns the token", async () => {
    const { client, calls } = clientWith([{ body: { token: JWT }, status: 200 }]);
    expect(await client.verifyAuth(WALLET, "5sig")).toBe(JWT);
    expect(calls[0]!.url).toBe("https://api.jup.ag/trigger/v2/auth/verify");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ type: "message", walletPubkey: WALLET, signature: "5sig" });
  });

  it("maps vault 404 to null and sends the JWT as a bearer token", async () => {
    const { client, calls } = clientWith([{ body: { error: "Vault not found" }, status: 404 }]);
    expect(await client.getVault(JWT)).toBeNull();
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
  });

  it("treats a vault 409 as the existing vault, not a failure", async () => {
    const fromDetails = clientWith([{ body: { error: "Vault already exists", details: vault }, status: 409 }]);
    expect(await fromDetails.client.registerVault(JWT)).toEqual({ vault: { userPubkey: WALLET, vaultPubkey: OTHER }, created: false });
    expect(fromDetails.calls[0]!.init.method).toBe("GET");
    const refetch = clientWith([{ body: { error: "exists" }, status: 409 }, { body: vault, status: 200 }]);
    expect((await refetch.client.registerVault(JWT)).created).toBe(false);
    expect(refetch.calls[1]!.url).toBe("https://api.jup.ag/trigger/v2/vault");
  });

  it("scrubs the JWT from provider error messages", async () => {
    const { client } = clientWith([{ body: { error: `bad token ${JWT}` }, status: 401 }]);
    try {
      await client.getVault(JWT);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(JupiterRequestError);
      const e = error as JupiterRequestError;
      expect(e.reason).toBe("unauthorized");
      expect(`${e.message} ${e.providerMessage}`).not.toContain(JWT);
    }
  });

  it("crafts a deposit with the documented body", async () => {
    const { client, calls } = clientWith([{ body: f.depositCraftFixture, status: 200 }]);
    const crafted = await client.craftDeposit(JWT, {
      inputMint: f.USDC_MINT,
      outputMint: f.AAPLX_MINT,
      userAddress: WALLET,
      amount: "10500000",
      orderType: "price",
      orderSubType: "single",
    });
    expect(crafted.requestId).toBe(f.depositCraftFixture.requestId);
    expect(calls[0]!.url).toBe("https://api.jup.ag/trigger/v2/deposit/craft");
  });
});

describe("live BUY deposit gate", () => {
  const base = {
    reference: {
      provider: "pyth_pro",
      role: "underlying_equity",
      symbol: "Equity.US.AAPL/USD",
      feedId: 922,
      channel: "fixed_rate@200ms",
      assetType: "equity",
      description: "x",
    },
    comparisonFeeds: [],
    execution: { status: "PENDING_JUPITER_VERIFICATION" },
    jupiter: {
      checkedAt: "2026-09-23T17:00:00Z",
      docsVersion: "test",
      levels: {},
      sides: { BUY: { result: "PASSED", detail: "x" }, SELL: { result: "RESTRICTED", detail: "x" } },
    },
    referenceBasis: {
      status: "RESOLVED",
      policyReference: "Pyth Equity.US.AAPL/USD",
      executionMonitor: "Jupiter AAPLx/USD",
      triggerMapping: "IDENTITY",
      disclosure: "x",
      detail: "x",
    },
    verification: { pythLiveCheck: { status: "PASSED" } },
  } as unknown as AssetMetadata;

  it("fails closed on missing or malformed evidence without breaking the reference", () => {
    const parsed = assetMetadataSchema.parse({ ...base, jupiter: { bogus: true }, verification: { internal: "x" } });
    expect(parsed.reference.feedId).toBe(922);
    expect(liveBuyDepositGate(parsed)).toMatchObject({ ok: false });
  });

  it("requires Pyth, BUY compatibility and a resolved reference basis", () => {
    expect(liveBuyDepositGate(base)).toEqual({ ok: true });
    expect(liveBuyDepositGate({ ...base, verification: { pythLiveCheck: { status: "NOT_ENTITLED" } } })).toMatchObject({ reason: "PYTH_LIVE_CHECK_REQUIRED" });
    expect(liveBuyDepositGate({ ...base, jupiter: undefined })).toMatchObject({ reason: "BUY_DEPOSIT_NOT_COMPATIBLE" });
    expect(liveBuyDepositGate({ ...base, referenceBasis: { ...base.referenceBasis!, status: "UNRESOLVED" } })).toMatchObject({
      reason: "REFERENCE_BASIS_UNRESOLVED",
    });
    expect(liveBuyDepositGate({ ...base, referenceBasis: undefined })).toMatchObject({ reason: "REFERENCE_BASIS_UNRESOLVED" });
  });
});
