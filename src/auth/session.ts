import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getPublicEnv, getSessionSecret } from "../config/env.ts";
import { AppError } from "../domain/errors.ts";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, verifySessionToken, type CircuitSession } from "./session-token.ts";

export {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  verifySessionToken,
  type CircuitSession,
} from "./session-token.ts";

/*
 * Stateless Circuit sessions (token format in session-token.ts). There is no
 * server-side store, so logout clears the cookie and tokens expire on their own.
 */

/** Secure everywhere except plain-HTTP localhost development, where browsers would drop it. */
export function isSecureCookieContext(): boolean {
  const appUrl = new URL(getPublicEnv().NEXT_PUBLIC_APP_URL);
  const isLocalHttp = appUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(appUrl.hostname);
  return !isLocalHttp;
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookieContext(),
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookieContext(),
    maxAge: 0,
  });
}

/** Reads the current request's session (Server Components and route handlers). */
export async function getSession(now: Date = new Date()): Promise<CircuitSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return null;
  }
  return verifySessionToken(token, { secret, now });
}

export async function requireSession(now: Date = new Date()): Promise<CircuitSession> {
  const session = await getSession(now);
  if (!session) throw new AppError("UNAUTHENTICATED", "Sign in with your wallet to continue.");
  return session;
}
