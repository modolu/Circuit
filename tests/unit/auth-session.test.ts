import { describe, expect, it } from "vitest";
import { createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "@/src/auth/session";

const secret = "test-secret-".padEnd(48, "x");
const walletAddress = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const now = new Date("2026-09-23T12:00:00.000Z");

describe("session tokens", () => {
  const token = createSessionToken({ walletAddress, now, secret });

  it("verifies a valid token and carries only wallet, issued-at and expiry", () => {
    const session = verifySessionToken(token, { secret, now: new Date(now.getTime() + 60_000) });
    expect(session).toEqual({
      walletAddress,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
    });
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub", "v"]);
  });

  it("never embeds the secret", () => {
    expect(token).not.toContain(secret);
    expect(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")).not.toContain(secret);
  });

  it("rejects tampered payloads and signatures", () => {
    const [prefix, payload, signature] = token.split(".") as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({ v: 1, sub: "11111111111111111111111111111111", iat: 1, exp: 9_999_999_999 }),
    ).toString("base64url");
    expect(verifySessionToken(`${prefix}.${forgedPayload}.${signature}`, { secret, now })).toBeNull();
    expect(verifySessionToken(`${prefix}.${payload}.${signature.slice(0, -2)}AA`, { secret, now })).toBeNull();
    expect(verifySessionToken(`v2.${payload}.${signature}`, { secret, now })).toBeNull();
    expect(verifySessionToken("garbage", { secret, now })).toBeNull();
  });

  it("rejects expired tokens", () => {
    const later = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
    expect(verifySessionToken(token, { secret, now: later })).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    expect(verifySessionToken(token, { secret: secret.replace("x", "y"), now })).toBeNull();
  });
});
