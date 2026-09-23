import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { AppError } from "../domain/errors.ts";
import { JUPITER_JWT_TTL_MS } from "../integrations/jupiter/trigger.ts";
import { isSecureCookieContext } from "./session.ts";

/*
 * Jupiter Trigger JWT storage (CIRCUIT_ARCHITECTURE.md §8, §11). It is a separate
 * credential from the Circuit session:
 * - Circuit session (`circuit_session`): proves identity to Circuit, signed by Circuit.
 * - Jupiter session (`circuit_jupiter_session`): Jupiter's bearer JWT for Trigger APIs.
 * The cookie is HttpOnly (never readable by browser JS), SameSite=Lax, Secure outside
 * HTTP localhost, and lives at most Jupiter's documented 24h JWT lifetime. It is never
 * stored in the database, never returned in API JSON, and never logged. The value is
 * bound to the Circuit wallet (`<wallet>~<jwt>`), so another signed-in wallet can't reuse it.
 */

export const JUPITER_SESSION_COOKIE_NAME = "circuit_jupiter_session";
export const JUPITER_SESSION_MAX_AGE_SECONDS = Math.floor(JUPITER_JWT_TTL_MS / 1000);

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const WALLET_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SEPARATOR = "~";

export function encodeJupiterSession(walletAddress: string, jwt: string): string {
  if (!WALLET_SHAPE.test(walletAddress) || !JWT_SHAPE.test(jwt)) {
    throw new AppError("PROVIDER_REJECTED", "Jupiter returned an unexpected session token.");
  }
  return `${walletAddress}${SEPARATOR}${jwt}`;
}

/** The JWT for `walletAddress`, or null when absent, malformed, or bound to another wallet. */
export function decodeJupiterSession(value: string | undefined, walletAddress: string): string | null {
  if (!value) return null;
  const index = value.indexOf(SEPARATOR);
  if (index <= 0) return null;
  const wallet = value.slice(0, index);
  const jwt = value.slice(index + 1);
  return wallet === walletAddress && JWT_SHAPE.test(jwt) ? jwt : null;
}

export function setJupiterSessionCookie(response: NextResponse, walletAddress: string, jwt: string): void {
  response.cookies.set({
    name: JUPITER_SESSION_COOKIE_NAME,
    value: encodeJupiterSession(walletAddress, jwt),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookieContext(),
    maxAge: JUPITER_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearJupiterSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: JUPITER_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookieContext(),
    maxAge: 0,
  });
}

/** Route handlers: read the Jupiter JWT from the request's Cookie header. */
export function readJupiterJwtFromRequest(request: Request, walletAddress: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === JUPITER_SESSION_COOKIE_NAME) return decodeJupiterSession(decodeURIComponent(rest.join("=")), walletAddress);
  }
  return null;
}

/** Server Components: read the Jupiter JWT for the signed-in wallet. */
export async function readJupiterJwt(walletAddress: string): Promise<string | null> {
  return decodeJupiterSession((await cookies()).get(JUPITER_SESSION_COOKIE_NAME)?.value, walletAddress);
}
