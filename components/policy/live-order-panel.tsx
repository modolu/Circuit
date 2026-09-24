"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { formatUtc } from "@/components/asset/format";
import { Button } from "@/components/ui/button";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";
import { formatUsd, formatUsdCents } from "@/src/domain/money";
import type { PolicyStatus } from "@/src/domain/policy";
import { SolscanLink } from "./solscan-link";
import { signPreparedTransaction, type SignTransaction } from "./wallet-transaction";

/*
 * LIVE Jupiter Trigger controls for one policy (Task 9). Every wallet signature here comes
 * from an explicit click on exactly two buttons: "Authorize deposit & arm" and
 * "Confirm withdrawal". Nothing signs, submits or re-sends on render, refresh or reconcile.
 */

export function depositAuthorizationText(assetSymbol: string): string {
  return `Signing this transaction authorizes the displayed USDC amount to be deposited into your Jupiter Trigger vault. If the subsequent order creation succeeds, Jupiter will monitor ${assetSymbol}/USD and execute under the policy shown above.`;
}
export const REAL_TRANSACTION_WARNING = "This is a real Solana transaction and can move funds.";
export const WITHDRAWAL_TEXT =
  "Jupiter has stopped this order from filling. Sign this withdrawal transaction to return the unfilled funds from your Jupiter vault to your wallet.";

export interface LiveReview {
  assetSymbol: string;
  referenceProvider: "PYTH" | "PRESTOCKS";
  /** Token-level caveat from the curated config (e.g. a Token-2022 transfer fee). */
  tokenNote?: string | null;
  amountDisplay: string;
  amountSymbol: string;
  referenceSymbol: string | null;
  referenceUsd: string | null;
  compiledTriggerUsd: string;
  direction: "ABOVE" | "BELOW";
  slippageBps: number;
  expiresAt: string;
  policyReference: string | null;
  executionMonitor: string | null;
  disclosure: string | null;
}

export interface LiveDetails {
  depositPreparationId: string | null;
  depositTxSignature: string | null;
  pendingWithdrawal: { id: string; purpose: "CANCEL" | "WITHDRAW_EXPIRED"; status: "PREPARED" | "SUBMITTING"; submitted: boolean } | null;
}

export interface LiveOrderPanelProps {
  policyId: string;
  sessionWallet: string;
  status: PolicyStatus;
  providerOrderId: string | null;
  providerState: string | null;
  providerProgress: { inputUsed: string | null; outputAmount: string | null; fillPercent: string | null } | null;
  readiness: { ready: boolean; message: string | null };
  jupiterConnected: boolean;
  review: LiveReview;
  live: LiveDetails | null;
}

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

async function post<T>(url: string, body: unknown = {}): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const envelope = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !envelope.data) throw new ApiError(envelope.error?.message ?? "The request failed. Try again.", envelope.error?.code);
  return envelope.data;
}

const PROVIDER_STATE_TONE: Record<string, ChipTone> = {
  PENDING: "accent",
  OPEN: "accent",
  EXECUTING: "warning",
  PENDING_WITHDRAW: "warning",
  FILLED: "success",
  CANCELLED: "muted",
  EXPIRED: "muted",
  FAILED: "danger",
};

function ReviewRow({ term, children, sub }: { term: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line py-2.5 last:border-b-0">
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="text-right font-mono text-[13px]">
        {children}
        {sub && <span className="mt-0.5 block text-[11px] text-muted">{sub}</span>}
      </dd>
    </div>
  );
}

/** The final authorization review. Values are the persisted policy's, never re-typed input. */
export function LiveOrderReview({ review, vaultAddress }: { review: LiveReview; vaultAddress: string | null }) {
  const condition = review.direction === "BELOW" ? "BELOW (price falls to or below)" : "ABOVE (price rises to or above)";
  return (
    <div data-testid="live-order-review">
      <div className="flex items-center gap-2">
        <StatusChip tone="danger">LIVE ORDER</StatusChip>
        <span className="text-xs text-muted">Real funds · Jupiter Trigger</span>
      </div>
      <dl className="mt-3">
        <ReviewRow term="Asset">{review.assetSymbol}</ReviewRow>
        <ReviewRow term="Side">BUY</ReviewRow>
        <ReviewRow term="Input">
          {review.amountDisplay} {review.amountSymbol}
        </ReviewRow>
        {review.referenceProvider === "PRESTOCKS" ? (
          <>
            <ReviewRow term="Trigger reference" sub="PreStocks · first-party mark price">
              PreStocks mark{review.referenceSymbol ? ` (${review.referenceSymbol})` : ""}
            </ReviewRow>
            <ReviewRow term="Captured PreStocks mark">{review.referenceUsd ? formatUsdCents(review.referenceUsd) : "Not recorded"}</ReviewRow>
          </>
        ) : (
          <>
            <ReviewRow term="Trigger reference" sub="Pyth · independent underlying reference">
              {review.referenceSymbol ?? "Pyth equity reference"}
            </ReviewRow>
            <ReviewRow term="Captured Pyth reference">{review.referenceUsd ? formatUsd(review.referenceUsd) : "Not recorded"}</ReviewRow>
          </>
        )}
        <ReviewRow term="Compiled target" sub="Circuit · sent to Jupiter unchanged">
          <span className="text-accent">{formatUsd(review.compiledTriggerUsd)}</span>
        </ReviewRow>
        <ReviewRow term="Execution monitor" sub="Jupiter · executes the Trigger order">
          Jupiter {review.assetSymbol}/USD
        </ReviewRow>
        <ReviewRow term="Condition">{condition}</ReviewRow>
        <ReviewRow term="Slippage">{review.slippageBps} bps</ReviewRow>
        <ReviewRow term="Expiry">{formatUtc(review.expiresAt, true)}</ReviewRow>
        <ReviewRow term="Jupiter vault">{vaultAddress ? <span title={vaultAddress}>{shortAddress(vaultAddress)}</span> : "—"}</ReviewRow>
      </dl>
      <p className="mt-3 rounded-md border border-warning/40 bg-warning/8 p-3 text-xs leading-relaxed">
        <strong className="font-semibold">Note:</strong>{" "}
        {review.disclosure ?? `${review.assetSymbol} is a secondary-market token and may trade at a premium or discount to the underlying stock.`}{" "}
        {review.referenceProvider === "PRESTOCKS"
          ? `PreStocks provides the reference mark; Jupiter's trigger engine monitors the actual ${review.assetSymbol} token's USD market price, not the mark.`
          : `Pyth informs this policy; Jupiter's trigger engine monitors ${review.assetSymbol}/USD, not Pyth.`}{" "}
        Deposit and settlement evidence is recorded from Solana.
      </p>
      {review.tokenNote && <p className="mt-2 text-xs leading-relaxed text-muted">{review.tokenNote}</p>}
    </div>
  );
}

export function LiveOrderPanel(props: LiveOrderPanelProps) {
  const { policyId, sessionWallet, status, providerOrderId, providerState, providerProgress, readiness, jupiterConnected, review, live } = props;
  const router = useRouter();
  const { publicKey, connected, signTransaction } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ id: string; vaultAddress: string | null } | null>(null);
  const [withdrawal, setWithdrawal] = useState<{ id: string; unsignedTransaction: string; purpose: string } | null>(null);

  const connectedAddress = publicKey?.toBase58() ?? null;
  const walletMatches = connected && connectedAddress === sessionWallet;
  const walletProblem = !connected
    ? "Connect the wallet you signed in to Circuit with."
    : !walletMatches
      ? `Your wallet is connected as ${shortAddress(connectedAddress ?? "")}, not the wallet signed in to Circuit (${shortAddress(sessionWallet)}).`
      : !signTransaction
        ? "This wallet cannot sign transactions."
        : null;

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "PROVIDER_AUTH_REQUIRED") {
        setError(`${cause.message} Reconnect Jupiter on the dashboard, then come back.`);
      } else {
        setError(cause instanceof Error ? cause.message : "The request failed. Try again.");
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const reconcile = () =>
    run("reconcile", async () => {
      const data = await post<{ diagnostic: string | null }>(`/api/policies/${policyId}/reconcile`);
      if (data.diagnostic) setNotice(data.diagnostic);
      router.refresh();
    });

  const prepare = () =>
    run("prepare", async () => {
      const data = await post<{ preparation: { id: string; receiverAddress: string | null } }>(`/api/policies/${policyId}/jupiter/deposit`);
      setPrepared({ id: data.preparation.id, vaultAddress: data.preparation.receiverAddress });
    });

  const authorize = () =>
    run("authorize", async () => {
      if (walletProblem || !signTransaction) throw new Error(walletProblem ?? "This wallet cannot sign transactions.");
      // Re-fetch the preparation: the server reuses it while fresh and re-crafts an expired blockhash.
      const fresh = await post<{ preparation: { id: string; receiverAddress: string | null }; unsignedTransaction: string }>(
        `/api/policies/${policyId}/jupiter/deposit`,
      );
      setPrepared({ id: fresh.preparation.id, vaultAddress: fresh.preparation.receiverAddress });
      let signedTransaction: string;
      try {
        signedTransaction = await signPreparedTransaction(signTransaction as SignTransaction, fresh.unsignedTransaction);
      } catch {
        throw new Error("The deposit signature was cancelled or failed in your wallet. Nothing was submitted.");
      }
      const data = await post<{ outcome: string }>(`/api/policies/${policyId}/jupiter/arm`, { preparationId: fresh.preparation.id, signedTransaction });
      if (data.outcome === "CONFIRMATION_PENDING") setNotice("Jupiter created the order and is confirming the deposit. Reconcile shortly.");
      router.refresh();
    });

  const resubmit = () =>
    run("resubmit", async () => {
      if (!live?.depositPreparationId) throw new Error("No signed deposit is recorded for this policy.");
      await post(`/api/policies/${policyId}/jupiter/arm`, { preparationId: live.depositPreparationId });
      router.refresh();
    });

  const startWithdrawal = () =>
    run("cancel", async () => {
      const data = await post<{ outcome: string; preparation: { id: string; purpose: string } | null; unsignedTransaction: string | null }>(
        `/api/policies/${policyId}/jupiter/cancel`,
      );
      if (data.outcome !== "WITHDRAWAL_READY" || !data.preparation || !data.unsignedTransaction) {
        setNotice(
          data.outcome === "ALREADY_FILLED"
            ? "Jupiter had already filled this order, so it is EXECUTED, not cancelled."
            : data.outcome === "ALREADY_WITHDRAWN"
              ? "The deposited funds were already withdrawn."
              : "Jupiter reports this order is already closed.",
        );
        router.refresh();
        return;
      }
      setWithdrawal({ id: data.preparation.id, unsignedTransaction: data.unsignedTransaction, purpose: data.preparation.purpose });
      router.refresh();
    });

  const confirmWithdrawal = () =>
    run("withdraw", async () => {
      if (!withdrawal) return;
      if (walletProblem || !signTransaction) throw new Error(walletProblem ?? "This wallet cannot sign transactions.");
      let signedTransaction: string;
      try {
        signedTransaction = await signPreparedTransaction(signTransaction as SignTransaction, withdrawal.unsignedTransaction);
      } catch {
        throw new Error("The withdrawal signature was cancelled or failed in your wallet. Nothing was submitted.");
      }
      await post(`/api/policies/${policyId}/jupiter/confirm-cancel`, { preparationId: withdrawal.id, signedTransaction });
      setWithdrawal(null);
      router.refresh();
    });

  const retryWithdrawal = () =>
    run("withdraw", async () => {
      if (!live?.pendingWithdrawal) return;
      await post(`/api/policies/${policyId}/jupiter/confirm-cancel`, { preparationId: live.pendingWithdrawal.id });
      router.refresh();
    });

  const feedback = (
    <>
      {notice && (
        <p data-testid="live-notice" className="mt-3 text-xs leading-relaxed text-warning">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );

  const jupiterGate = !jupiterConnected && (
    <p className="mt-3 text-xs text-warning">
      Jupiter is not connected in this browser. <Link href="/dashboard" className="underline">Connect Jupiter on the dashboard</Link> first.
    </p>
  );
  const walletGate = walletProblem && <p className="mt-3 text-xs text-warning">{walletProblem}</p>;

  const header = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <StatusChip tone="accent">LIVE</StatusChip>
      <StatusChip tone="info">JUPITER TRIGGER</StatusChip>
      {providerState && <StatusChip tone={PROVIDER_STATE_TONE[providerState] ?? "muted"}>{providerState.replace("_", " ")}</StatusChip>}
    </div>
  );

  const withdrawalStep = withdrawal && (
    <div className="mt-4 rounded-md border border-line-strong p-3" data-testid="withdrawal-step">
      <p className="text-[13px] leading-relaxed">{WITHDRAWAL_TEXT}</p>
      <p className="mt-2 text-xs font-semibold text-warning">{REAL_TRANSACTION_WARNING}</p>
      {walletGate}
      <Button data-testid="confirm-withdrawal" variant="primary" size="lg" className="mt-3 w-full" disabled={busy !== null || Boolean(walletProblem)} onClick={confirmWithdrawal}>
        {busy === "withdraw" ? "Approve in your wallet…" : "Confirm withdrawal"}
      </Button>
    </div>
  );

  if (status === "DRAFT") {
    if (!readiness.ready) {
      return (
        <div data-testid="live-blocked">
          {header}
          <p className="text-[13px] leading-relaxed text-muted">Live execution is not available for this policy.</p>
          {readiness.message && <p className="mt-2 text-xs text-warning">{readiness.message}</p>}
        </div>
      );
    }
    return (
      <div>
        {header}
        <ol className="mb-3 grid gap-1 text-xs text-muted">
          <li className={prepared ? "" : "text-text"}>Step 1 · Prepare Jupiter deposit</li>
          <li className={prepared ? "text-text" : ""}>Step 2 · Review the live authorization</li>
          <li className={prepared ? "text-text" : ""}>Step 3 · Authorize deposit &amp; arm</li>
        </ol>
        {!prepared ? (
          <>
            <p className="text-[13px] leading-relaxed text-muted">
              Jupiter prepares a deposit transaction for review. Preparing does not ask your wallet to sign anything.
            </p>
            {jupiterGate}
            <Button data-testid="prepare-deposit" variant="primary" size="lg" className="mt-4 w-full" disabled={busy !== null || !jupiterConnected} onClick={prepare}>
              {busy === "prepare" ? "Preparing…" : "Prepare Jupiter deposit"}
            </Button>
          </>
        ) : (
          <>
            <LiveOrderReview review={review} vaultAddress={prepared.vaultAddress} />
            <p className="mt-4 text-[13px] leading-relaxed">{depositAuthorizationText(review.assetSymbol)}</p>
            <p className="mt-2 text-[13px] font-semibold text-warning">{REAL_TRANSACTION_WARNING}</p>
            {walletGate}
            <Button
              data-testid="authorize-deposit"
              variant="primary"
              size="lg"
              className="mt-4 w-full"
              disabled={busy !== null || Boolean(walletProblem) || !jupiterConnected}
              onClick={authorize}
            >
              {busy === "authorize" ? "Approve in your wallet…" : "Authorize deposit & arm"}
            </Button>
          </>
        )}
        {feedback}
      </div>
    );
  }

  if (status === "ARMING") {
    return (
      <div data-testid="live-arming">
        {header}
        <p className="text-[13px] font-semibold">Jupiter order confirmation pending</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Your signed deposit was sent. Circuit will not ask for another deposit while this is unresolved; it reconciles against
          Jupiter&apos;s order history.
        </p>
        {live?.depositTxSignature && (
          <p className="mt-2 text-xs">
            Deposit transaction <SolscanLink signature={live.depositTxSignature} />
          </p>
        )}
        {jupiterGate}
        <div className="mt-4 flex flex-col gap-2.5">
          <Button data-testid="reconcile" size="lg" disabled={busy !== null || !jupiterConnected} onClick={reconcile}>
            {busy === "reconcile" ? "Reconciling…" : "Reconcile now"}
          </Button>
          {!providerOrderId && live?.depositPreparationId && (
            <Button data-testid="resubmit-deposit" size="md" disabled={busy !== null || !jupiterConnected} onClick={resubmit}>
              {busy === "resubmit" ? "Resubmitting…" : "Resubmit signed deposit (no new signature)"}
            </Button>
          )}
        </div>
        {feedback}
      </div>
    );
  }

  const pending = live?.pendingWithdrawal ?? null;
  const pendingText =
    pending || providerState === "PENDING_WITHDRAW" ? (
      <div className="mt-3 rounded-md border border-warning/40 p-3" data-testid="cancellation-pending">
        <p className="text-[13px] font-semibold">Cancellation pending — withdrawal signature required.</p>
        <p className="mt-1 text-xs text-muted">Order can no longer fill. Sign withdrawal to return unfilled funds.</p>
      </div>
    ) : null;

  if (status === "ARMED") {
    const executing = providerState === "EXECUTING";
    return (
      <div data-testid="live-armed">
        {header}
        {executing && (
          <div className="mb-3 rounded-md border border-line p-3 text-xs" data-testid="live-executing">
            <p className="font-semibold">EXECUTING</p>
            {providerProgress && (providerProgress.fillPercent || providerProgress.inputUsed || providerProgress.outputAmount) ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
                {providerProgress.fillPercent && (<><dt className="text-muted">Fill</dt><dd>{providerProgress.fillPercent} (fraction)</dd></>)}
                {providerProgress.inputUsed && (<><dt className="text-muted">Input used</dt><dd>{providerProgress.inputUsed} raw</dd></>)}
                {providerProgress.outputAmount && (<><dt className="text-muted">Output so far</dt><dd>{providerProgress.outputAmount} raw</dd></>)}
              </dl>
            ) : null}
            <p className="mt-2 text-muted">Provider-reported progress. The policy is EXECUTED only when Jupiter reports it fully filled.</p>
          </div>
        )}
        {pendingText}
        {jupiterGate}
        <div className="mt-4 flex flex-col gap-2.5">
          <Button data-testid="reconcile" size="lg" disabled={busy !== null || !jupiterConnected} onClick={reconcile}>
            {busy === "reconcile" ? "Reconciling…" : "Refresh status"}
          </Button>
          {pending?.submitted && !withdrawal && (
            <Button size="md" disabled={busy !== null || !jupiterConnected} onClick={retryWithdrawal}>
              {busy === "withdraw" ? "Retrying…" : "Retry withdrawal confirmation (no new signature)"}
            </Button>
          )}
          {!executing && !withdrawal && (
            <Button data-testid="cancel-withdraw" variant="danger" size="lg" disabled={busy !== null || !jupiterConnected} onClick={startWithdrawal}>
              {busy === "cancel" ? "Asking Jupiter to stop the order…" : pending || providerState === "PENDING_WITHDRAW" ? "Get withdrawal transaction" : "Cancel & withdraw"}
            </Button>
          )}
        </div>
        {withdrawalStep}
        {feedback}
      </div>
    );
  }

  if (status === "EXPIRED") {
    const withdrawn = providerState === "CANCELLED";
    return (
      <div data-testid="live-expired">
        {header}
        {withdrawn ? (
          <p className="text-[13px]">Order expired. The deposited funds were withdrawn to your wallet.</p>
        ) : (
          <>
            <p className="text-[13px] font-semibold">Order expired. Withdraw deposited funds.</p>
            <p className="mt-1 text-xs text-muted">Funds remain in your Jupiter vault until withdrawn.</p>
            {pendingText}
            {jupiterGate}
            <div className="mt-4 flex flex-col gap-2.5">
              {pending?.submitted && !withdrawal && (
                <Button size="md" disabled={busy !== null || !jupiterConnected} onClick={retryWithdrawal}>
                  Retry withdrawal confirmation (no new signature)
                </Button>
              )}
              {!withdrawal && (
                <Button data-testid="withdraw-expired" variant="primary" size="lg" disabled={busy !== null || !jupiterConnected} onClick={startWithdrawal}>
                  {busy === "cancel" ? "Preparing withdrawal…" : "Withdraw deposited funds"}
                </Button>
              )}
            </div>
            {withdrawalStep}
          </>
        )}
        {feedback}
      </div>
    );
  }

  if (status === "CANCELLED") {
    return (
      <div>
        {header}
        <p className="text-[13px]">CANCELLED. Unfilled funds returned to your wallet.</p>
      </div>
    );
  }

  return (
    <div>
      {header}
      {feedback}
    </div>
  );
}
