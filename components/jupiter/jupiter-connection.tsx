"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";
import { WalletConnectButton } from "@/components/wallet/wallet-connect-button";

/*
 * Live-mode Jupiter Trigger connection. Three separate credentials are shown as such:
 * - Circuit sign-in: this app's session (already done to see this panel).
 * - Jupiter auth: an off-chain message signature that gives the server a 24h Jupiter
 *   JWT, kept in an HttpOnly cookie that browser code never reads.
 * - Jupiter vault: Jupiter's per-wallet custodial vault, created only by an explicit click.
 * Nothing here signs or sends a transaction.
 */

export const JUPITER_AUTH_EXPLANATION =
  "Jupiter requires a wallet signature to authenticate this wallet for Trigger orders. This authentication signature does not transfer tokens or submit a transaction.";
export const JUPITER_VAULT_EXPLANATION =
  "Jupiter uses a per-wallet custodial vault for Trigger deposits. Creating the vault does not transfer funds.";

type VaultState = { status: "READY"; vaultPubkey: string } | { status: "NOT_REGISTERED" } | null;
interface StatusData {
  authenticated: boolean;
  expired: boolean;
  vault: VaultState;
}

export type View =
  | { kind: "loading" }
  | { kind: "not_connected" }
  | { kind: "expired" }
  | { kind: "challenge_ready"; challenge: string }
  | { kind: "no_vault" }
  | { kind: "vault_ready"; vaultPubkey: string }
  | { kind: "unavailable"; message: string };

/**
 * The browser wallet adapter, independent of the Circuit session. After a reload the
 * Circuit cookie is still valid while the adapter may be disconnected: that is not a
 * signed-out state, it only means the wallet must be reconnected before Jupiter auth.
 */
export type WalletState =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "mismatch"; connectedAddress: string }
  | { kind: "unsupported" }
  | { kind: "ready" };

export function walletStateFor({
  sessionWallet,
  connectedAddress,
  connected,
  connecting,
  canSignMessage,
}: {
  sessionWallet: string;
  connectedAddress: string | null;
  connected: boolean;
  connecting: boolean;
  canSignMessage: boolean;
}): WalletState {
  if (!connected || !connectedAddress) return connecting ? { kind: "connecting" } : { kind: "disconnected" };
  if (connectedAddress !== sessionWallet) return { kind: "mismatch", connectedAddress };
  if (!canSignMessage) return { kind: "unsupported" };
  return { kind: "ready" };
}

export type Busy = null | "challenge" | "signing" | "verifying" | "registering" | "disconnecting";

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

class ApiError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function call<T>(url: string, init?: { body?: unknown }): Promise<T> {
  const response = await fetch(url, init
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body ?? {}) }
    : { method: "GET", cache: "no-store" });
  const envelope = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !envelope.data) {
    throw new ApiError(envelope.error?.message ?? "Circuit could not reach Jupiter. Try again.", envelope.error?.code);
  }
  return envelope.data;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unavailableView(cause: unknown): View {
  if (cause instanceof ApiError && cause.code === "UNAUTHENTICATED") {
    return {
      kind: "unavailable",
      message: "Circuit could not confirm your session while checking Jupiter. Reload the page. If this continues, log out and sign in again.",
    };
  }
  return { kind: "unavailable", message: cause instanceof Error ? cause.message : "Jupiter status is unavailable." };
}

function viewFromStatus(status: StatusData): View {
  if (status.expired) return { kind: "expired" };
  if (!status.authenticated) return { kind: "not_connected" };
  if (status.vault?.status === "READY") return { kind: "vault_ready", vaultPubkey: status.vault.vaultPubkey };
  return { kind: "no_vault" };
}

const CHIP: Record<View["kind"], { tone: ChipTone; label: string }> = {
  loading: { tone: "muted", label: "CHECKING" },
  not_connected: { tone: "muted", label: "NOT CONNECTED" },
  expired: { tone: "warning", label: "SESSION EXPIRED" },
  challenge_ready: { tone: "accent", label: "CHALLENGE READY" },
  no_vault: { tone: "info", label: "AUTHENTICATED · NO VAULT" },
  vault_ready: { tone: "success", label: "VAULT READY" },
  unavailable: { tone: "warning", label: "STATUS UNAVAILABLE" },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[13px]">{children}</span>
    </div>
  );
}

function WalletRowValue({ wallet }: { wallet: WalletState }) {
  switch (wallet.kind) {
    case "ready":
    case "unsupported":
      return <>Connected</>;
    case "mismatch":
      return <span className="text-warning">Different wallet ({shortAddress(wallet.connectedAddress)})</span>;
    case "connecting":
      return <span className="text-muted">Connecting…</span>;
    default:
      return <span className="text-muted">Not connected</span>;
  }
}

export interface JupiterConnectionViewProps {
  sessionWallet: string;
  view: View;
  wallet: WalletState;
  busy: Busy;
  error: string | null;
  onRequestChallenge: () => void;
  onSignChallenge: (challenge: string) => void;
  onCancelChallenge: () => void;
  onRegisterVault: () => void;
  onDisconnectJupiter: () => void;
  onRetryStatus: () => void;
}

/** Presentational panel. Every action here requires an explicit click; nothing runs on render. */
export function JupiterConnectionView({
  sessionWallet,
  view,
  wallet,
  busy,
  error,
  onRequestChallenge,
  onSignChallenge,
  onCancelChallenge,
  onRegisterVault,
  onDisconnectJupiter,
  onRetryStatus,
}: JupiterConnectionViewProps) {
  const chip = CHIP[view.kind];
  const authenticated = view.kind === "no_vault" || view.kind === "vault_ready";
  const needsJupiterAuth = view.kind === "not_connected" || view.kind === "expired" || view.kind === "unavailable";
  const walletReady = wallet.kind === "ready";

  /** What the user must do with their wallet before Jupiter auth can start (null when nothing). */
  const walletGate =
    wallet.kind === "disconnected" || wallet.kind === "connecting" ? (
      <div className="mt-4" data-testid="jupiter-wallet-disconnected">
        <p className="max-w-[560px] text-[13px] leading-relaxed text-muted">
          You are signed in to Circuit as <span className="font-mono text-text">{shortAddress(sessionWallet)}</span>, but
          that wallet is not connected in this browser right now. Connect the same wallet to authenticate with
          Jupiter. Connecting does not sign anything.
        </p>
        <WalletConnectButton className="mt-4" variant="primary" label="Connect wallet" />
      </div>
    ) : wallet.kind === "mismatch" ? (
      <p role="alert" className="mt-4 text-xs text-warning" data-testid="jupiter-wallet-mismatch">
        Your wallet is connected as <span className="font-mono">{shortAddress(wallet.connectedAddress)}</span>. Jupiter
        authentication is only available for the wallet signed in to Circuit ({shortAddress(sessionWallet)}). Switch
        accounts in your wallet to continue.
      </p>
    ) : wallet.kind === "unsupported" ? (
      <p role="alert" className="mt-4 text-xs text-danger">
        This wallet does not support message signing, which Jupiter authentication requires.
      </p>
    ) : null;

  return (
    <Card as="section" aria-labelledby="jupiter-heading" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel id="jupiter-heading">Jupiter Trigger connection</SectionLabel>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </div>

      <div className="mt-4">
        <Row label="Circuit sign-in">
          <span className="font-mono text-xs" title={sessionWallet}>{shortAddress(sessionWallet)}</span>
        </Row>
        <Row label="Wallet in this browser">
          <WalletRowValue wallet={wallet} />
        </Row>
        <Row label="Jupiter auth">
          {authenticated
            ? "Authenticated (session lasts up to 24 hours)"
            : view.kind === "expired"
              ? "Expired, reconnect"
              : view.kind === "loading"
                ? <span className="text-muted">Checking…</span>
                : view.kind === "challenge_ready"
                  ? "Waiting for your signature"
                  : "Not connected"}
        </Row>
        <Row label="Jupiter vault">
          {view.kind === "vault_ready" ? (
            <span className="font-mono text-xs" title={view.vaultPubkey}>{shortAddress(view.vaultPubkey)}</span>
          ) : view.kind === "no_vault" ? (
            "Not set up"
          ) : (
            <span className="text-muted">Needs Jupiter auth</span>
          )}
        </Row>
      </div>

      {view.kind === "unavailable" && (
        <div className="mt-4 flex flex-col items-start gap-2">
          <p className="text-[13px] text-muted">{view.message}</p>
          <Button onClick={onRetryStatus} disabled={busy !== null}>
            Check again
          </Button>
        </div>
      )}

      {needsJupiterAuth && (walletGate ?? (
        <div className="mt-4">
          <p className="max-w-[560px] text-[13px] leading-relaxed text-muted">{JUPITER_AUTH_EXPLANATION}</p>
          {view.kind === "expired" && (
            <p className="mt-2 text-xs text-warning">Your Jupiter session has expired or was rejected. Connect again.</p>
          )}
          <Button className="mt-4" variant="primary" onClick={onRequestChallenge} disabled={busy !== null || !walletReady}>
            {busy === "challenge" ? "Requesting challenge…" : view.kind === "expired" ? "Reconnect Jupiter" : "Connect Jupiter"}
          </Button>
        </div>
      ))}

      {view.kind === "challenge_ready" && (
        <div className="mt-4">
          <p className="max-w-[560px] text-[13px] leading-relaxed text-muted">{JUPITER_AUTH_EXPLANATION}</p>
          <figure className="mt-4 max-w-[560px]">
            <figcaption className="mb-1.5 text-xs text-muted">Jupiter challenge you are signing</figcaption>
            <pre className={cn(
              "overflow-x-auto rounded-md border border-line bg-panel-2 p-3 font-mono text-[11px] leading-relaxed",
              "whitespace-pre-wrap break-all text-muted",
            )}>
              {view.challenge}
            </pre>
          </figure>
          <p className="mt-2 text-xs text-muted">The Jupiter session lasts up to 24 hours.</p>
          {walletGate}
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <Button variant="primary" onClick={() => onSignChallenge(view.challenge)} disabled={busy !== null || !walletReady}>
              {busy === "signing" ? "Approve the message in your wallet…" : busy === "verifying" ? "Verifying with Jupiter…" : "Sign Jupiter login"}
            </Button>
            <Button onClick={onCancelChallenge} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {view.kind === "no_vault" && (
        <div className="mt-4">
          <p className="max-w-[560px] text-[13px] leading-relaxed text-muted">{JUPITER_VAULT_EXPLANATION}</p>
          {wallet.kind === "mismatch" && walletGate}
          <Button className="mt-4" variant="primary" onClick={onRegisterVault} disabled={busy !== null || wallet.kind === "mismatch"}>
            {busy === "registering" ? "Setting up vault…" : "Set up Jupiter vault"}
          </Button>
        </div>
      )}

      {view.kind === "vault_ready" && (
        <p className="mt-4 text-[13px] text-muted">
          Live deposit signing not enabled yet. Circuit does not ask your wallet to sign any deposit or order in this build.
        </p>
      )}

      {authenticated && (
        <Button className="mt-4" onClick={onDisconnectJupiter} disabled={busy !== null}>
          Disconnect Jupiter
        </Button>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

export function JupiterConnection({ sessionWallet }: { sessionWallet: string }) {
  const { publicKey, connected, connecting, signMessage } = useWallet();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const wallet = walletStateFor({
    sessionWallet,
    connectedAddress: publicKey?.toBase58() ?? null,
    connected,
    connecting,
    canSignMessage: Boolean(signMessage),
  });
  const walletReady = wallet.kind === "ready";

  const handleFailure = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.code === "PROVIDER_AUTH_REQUIRED") {
      setView({ kind: "expired" });
      setError(null);
      return;
    }
    setError(cause instanceof Error ? cause.message : "Jupiter request failed. Try again.");
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      return viewFromStatus(await call<StatusData>("/api/jupiter/status"));
    } catch (cause) {
      return unavailableView(cause);
    }
  }, []);

  // Read-only status check on load. It never connects a wallet, registers a vault or asks for a signature.
  useEffect(() => {
    let active = true;
    void loadStatus().then((next) => active && setView(next));
    return () => {
      active = false;
    };
  }, [loadStatus]);

  const retryStatus = useCallback(async () => {
    setError(null);
    setView({ kind: "loading" });
    setView(await loadStatus());
  }, [loadStatus]);

  const requestChallenge = useCallback(async () => {
    setError(null);
    if (!walletReady) {
      setError("Connect the wallet you signed in to Circuit with.");
      return;
    }
    setBusy("challenge");
    try {
      const data = await call<{ type: "message"; challenge: string }>("/api/jupiter/auth/challenge", { body: {} });
      setView({ kind: "challenge_ready", challenge: data.challenge });
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(null);
    }
  }, [walletReady, handleFailure]);

  const signChallenge = useCallback(async (challenge: string) => {
    setError(null);
    if (!walletReady || !signMessage) {
      setError("Connect the wallet you signed in to Circuit with.");
      return;
    }
    setBusy("signing");
    try {
      let signature: Uint8Array;
      try {
        // The exact bytes of Jupiter's challenge, unmodified.
        signature = await signMessage(new TextEncoder().encode(challenge));
      } catch {
        throw new Error("The signature request was cancelled or failed in your wallet.");
      }
      setBusy("verifying");
      await call("/api/jupiter/auth/verify", { body: { signature: toBase64(signature) } });
      setView(await loadStatus());
    } catch (cause) {
      handleFailure(cause);
      setView((current) => (current.kind === "challenge_ready" ? { kind: "not_connected" } : current));
    } finally {
      setBusy(null);
    }
  }, [walletReady, signMessage, handleFailure, loadStatus]);

  const registerVault = useCallback(async () => {
    setError(null);
    setBusy("registering");
    try {
      const result = await call<{ vault: VaultState }>("/api/jupiter/vault/register", { body: {} });
      if (result.vault?.status === "READY") setView({ kind: "vault_ready", vaultPubkey: result.vault.vaultPubkey });
      else setError("Jupiter did not return a vault for this wallet.");
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(null);
    }
  }, [handleFailure]);

  const disconnectJupiter = useCallback(async () => {
    setError(null);
    setBusy("disconnecting");
    try {
      await call("/api/jupiter/auth/logout", { body: {} });
      setView({ kind: "not_connected" });
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(null);
    }
  }, [handleFailure]);

  return (
    <JupiterConnectionView
      sessionWallet={sessionWallet}
      view={view}
      wallet={wallet}
      busy={busy}
      error={error}
      onRequestChallenge={() => void requestChallenge()}
      onSignChallenge={(challenge) => void signChallenge(challenge)}
      onCancelChallenge={() => setView({ kind: "not_connected" })}
      onRegisterVault={() => void registerVault()}
      onDisconnectJupiter={() => void disconnectJupiter()}
      onRetryStatus={() => void retryStatus()}
    />
  );
}
