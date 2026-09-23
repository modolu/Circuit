import { describe, expect, it } from "vitest";
import { buildLoginMessage, LOGIN_STATEMENT } from "@/src/auth/wallet-message";

const fields = {
  appOrigin: "https://circuit.example",
  walletAddress: "11111111111111111111111111111111",
  nonce: "a".repeat(64),
  issuedAt: new Date("2026-09-23T12:00:00.000Z"),
  expiresAt: new Date("2026-09-23T12:05:00.000Z"),
  cluster: "mainnet-beta" as const,
};

describe("canonical login message", () => {
  it("is deterministic and matches the documented format exactly", () => {
    expect(buildLoginMessage(fields)).toBe(buildLoginMessage({ ...fields }));
    expect(buildLoginMessage(fields)).toBe(
      [
        "circuit.example wants you to sign in with your Solana account:",
        "11111111111111111111111111111111",
        "",
        LOGIN_STATEMENT,
        "",
        "URI: https://circuit.example",
        "Version: 1",
        "Chain ID: solana:mainnet",
        `Nonce: ${"a".repeat(64)}`,
        "Issued At: 2026-09-23T12:00:00.000Z",
        "Expiration Time: 2026-09-23T12:05:00.000Z",
      ].join("\n"),
    );
  });

  it("binds domain, wallet, nonce, times and chain", () => {
    const message = buildLoginMessage({ ...fields, appOrigin: "http://localhost:3000", cluster: "devnet" });
    expect(message.startsWith("localhost:3000 wants you to sign in")).toBe(true);
    expect(message).toContain("URI: http://localhost:3000");
    expect(message).toContain(fields.walletAddress);
    expect(message).toContain(`Nonce: ${fields.nonce}`);
    expect(message).toContain("Issued At: 2026-09-23T12:00:00.000Z");
    expect(message).toContain("Expiration Time: 2026-09-23T12:05:00.000Z");
    expect(message).toContain("Chain ID: solana:devnet");
  });

  it("states it is authentication only, not a transaction or fund authority", () => {
    expect(LOGIN_STATEMENT).toMatch(/Sign in to Circuit/);
    expect(LOGIN_STATEMENT).toMatch(/not a transaction/);
    expect(LOGIN_STATEMENT).toMatch(/does not authorize Circuit to move funds/);
  });
});
