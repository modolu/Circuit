"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export const SIGN_IN_EXPLANATION =
  "Sign a login message to prove this wallet is yours. This does not create a transaction or authorize Circuit to move funds.";

export const UNSUPPORTED_WALLET_MESSAGE =
  "This wallet can connect to Solana but does not support the message signing Circuit uses for authentication.";

export type SignInStatus = "idle" | "requesting" | "signing" | "verifying";

interface ApiEnvelope<T> {
  data?: T;
  error?: { message: string };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || !envelope.data) {
    throw new Error(envelope.error?.message ?? "Circuit could not complete the request. Try again.");
  }
  return envelope.data;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Circuit sign-in: request a server challenge, show it, have the wallet sign
 * those exact bytes, then let the server verify and set the session cookie.
 * Runs only from an explicit user action, never on wallet connect.
 */
export function useCircuitAuth() {
  const { publicKey, signMessage } = useWallet();
  const router = useRouter();
  const [status, setStatus] = useState<SignInStatus>("idle");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supportsSignMessage = Boolean(signMessage);

  const signIn = useCallback(async () => {
    setError(null);
    if (!publicKey) {
      setError("Connect a wallet first.");
      return;
    }
    if (!signMessage) {
      setError(UNSUPPORTED_WALLET_MESSAGE);
      return;
    }
    const walletAddress = publicKey.toBase58();
    try {
      setStatus("requesting");
      const challenge = await postJson<{ nonce: string; message: string }>("/api/auth/nonce", { walletAddress });

      setPendingMessage(challenge.message);
      setStatus("signing");
      let signature: Uint8Array;
      try {
        signature = await signMessage(new TextEncoder().encode(challenge.message));
      } catch {
        throw new Error("The signature request was cancelled or failed in your wallet.");
      }

      setStatus("verifying");
      await postJson("/api/auth/verify", { walletAddress, nonce: challenge.nonce, signature: toBase64(signature) });
      setPendingMessage(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Try again.");
      setPendingMessage(null);
    } finally {
      setStatus("idle");
    }
  }, [publicKey, signMessage, router]);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await postJson("/api/auth/logout", {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-out failed. Try again.");
    } finally {
      router.refresh();
    }
  }, [router]);

  return { signIn, logout, status, pendingMessage, error, supportsSignMessage };
}
