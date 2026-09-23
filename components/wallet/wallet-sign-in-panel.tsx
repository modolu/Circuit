"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { shortAddress } from "./short-address";
import { SIGN_IN_EXPLANATION, UNSUPPORTED_WALLET_MESSAGE, useCircuitAuth } from "./use-circuit-auth";
import { WalletConnectButton } from "./wallet-connect-button";

const STATUS_TEXT = {
  requesting: "Preparing your sign-in message…",
  signing: "Approve the message in your wallet.",
  verifying: "Verifying signature…",
} as const;

/**
 * Inline connect → sign-in → signed-in flow for the landing page and dashboard.
 * `sessionWallet` is the server-verified Circuit session, not the wallet adapter state.
 */
export function WalletSignInPanel({
  sessionWallet,
  size = "lg",
  showDashboardLink = false,
  extraAction,
  className,
}: {
  sessionWallet: string | null;
  size?: "md" | "lg";
  showDashboardLink?: boolean;
  /** Rendered beside the primary action while signed out (e.g. a "View dashboard" link). */
  extraAction?: ReactNode;
  className?: string;
}) {
  const { publicKey, connected, disconnect } = useWallet();
  const { signIn, logout, status, pendingMessage, error, supportsSignMessage } = useCircuitAuth();
  const connectedAddress = publicKey?.toBase58() ?? null;
  const busy = status !== "idle";

  const errorLine = error && (
    <p role="alert" className="mt-3 text-xs text-danger">
      {error}
    </p>
  );

  if (sessionWallet) {
    const mismatch = connected && connectedAddress !== null && connectedAddress !== sessionWallet;
    return (
      <div className={className}>
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          Signed in as
          <span className="rounded-[5px] bg-raised px-2 py-[3px] font-mono text-xs text-text" title={sessionWallet}>
            {shortAddress(sessionWallet)}
          </span>
        </p>
        {mismatch && connectedAddress && (
          <p className="mt-2 text-xs text-warning">
            Your wallet is connected as <span className="font-mono">{shortAddress(connectedAddress)}</span>, which is
            not the wallet signed in to Circuit.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          {showDashboardLink && (
            <ButtonLink href="/dashboard" variant="primary" size={size}>
              Open dashboard
            </ButtonLink>
          )}
          {mismatch && (
            <Button size={size} onClick={signIn} disabled={busy}>
              Sign in as {shortAddress(connectedAddress ?? "")}
            </Button>
          )}
          <Button size={size} onClick={logout}>
            Log out
          </Button>
        </div>
        {errorLine}
      </div>
    );
  }

  if (!connected) {
    return (
      <div className={className}>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <WalletConnectButton variant="primary" size={size} label="Connect Solana wallet" />
          {extraAction}
        </div>
        {errorLine}
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="max-w-[460px] text-[13px] leading-relaxed text-muted">{SIGN_IN_EXPLANATION}</p>
      <div className="mt-4 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center">
        <Button variant="primary" size={size} onClick={signIn} disabled={busy || !supportsSignMessage}>
          {busy ? STATUS_TEXT[status] : "Sign in to Circuit"}
        </Button>
        <Button size={size} onClick={() => void disconnect()} disabled={busy}>
          Disconnect {connectedAddress ? shortAddress(connectedAddress) : "wallet"}
        </Button>
        {extraAction}
      </div>
      {!supportsSignMessage && (
        <p role="alert" className="mt-3 max-w-[460px] text-xs text-danger">
          {UNSUPPORTED_WALLET_MESSAGE}
        </p>
      )}
      {pendingMessage && (
        <figure className="mt-4 max-w-[520px]">
          <figcaption className="mb-1.5 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
            Message you are signing
          </figcaption>
          <pre
            className={cn(
              "overflow-x-auto rounded-md border border-line bg-panel-2 p-3 font-mono text-[11px] leading-relaxed",
              "whitespace-pre-wrap break-all text-muted",
            )}
          >
            {pendingMessage}
          </pre>
        </figure>
      )}
      {errorLine}
    </div>
  );
}
