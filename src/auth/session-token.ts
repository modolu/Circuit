import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/*
 * Pure Circuit session tokens: `v1.<base64url JSON payload>.<base64url HMAC-SHA-256>`.
 * The payload holds only the wallet address, issued-at and expiry. No Next.js
 * imports, so this runs anywhere (tests, scripts). Cookies live in session.ts.
 */

export const SESSION_COOKIE_NAME = "circuit_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const TOKEN_PREFIX = "v1";

const payloadSchema = z
  .object({
    v: z.literal(1),
    sub: z.string().min(32).max(44),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict();

export interface CircuitSession {
  walletAddress: string;
  issuedAt: Date;
  expiresAt: Date;
}

function sign(input: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

export function createSessionToken({
  walletAddress,
  now,
  secret,
  ttlSeconds = SESSION_TTL_SECONDS,
}: {
  walletAddress: string;
  now: Date;
  secret: string;
  ttlSeconds?: number;
}): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: walletAddress, iat, exp: iat + ttlSeconds })).toString(
    "base64url",
  );
  const signed = `${TOKEN_PREFIX}.${payload}`;
  return `${signed}.${sign(signed, secret).toString("base64url")}`;
}

/** Returns the session, or `null` for any malformed, forged or expired token. */
export function verifySessionToken(token: string, { secret, now }: { secret: string; now: Date }): CircuitSession | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const [prefix, payload, signature] = parts as [string, string, string];

  const expected = sign(`${prefix}.${payload}`, secret);
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) return null;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (parsed.data.exp <= nowSeconds || parsed.data.iat > nowSeconds + 60) return null;

  return {
    walletAddress: parsed.data.sub,
    issuedAt: new Date(parsed.data.iat * 1000),
    expiresAt: new Date(parsed.data.exp * 1000),
  };
}
