import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatSession, formatUtc } from "@/components/asset/format";
import { PolicyActions } from "@/components/policy/policy-actions";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { POLICY_STATUS_TONE, StatusChip } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";
import { WalletSignInPanel } from "@/components/wallet/wallet-sign-in-panel";
import { getAuthenticatedWallet } from "@/src/auth/current-wallet";
import { getDb } from "@/src/db/client";
import { formatUsd } from "@/src/domain/money";
import { describeSlippage } from "@/src/domain/policy";
import { toAppError } from "@/src/domain/errors";
import { getExecutionMode, getExecutionProvider } from "@/src/integrations/jupiter/provider";
import { logger } from "@/src/observability/logger";
import { getPolicyViewForWallet } from "@/src/services/policy-view";
import { reconcilePolicy } from "@/src/services/reconcile-policy";

export const metadata: Metadata = { title: "Policy" };

const EVENT_LABELS: Record<string, string> = {
  POLICY_CREATED: "Policy drafted",
  REFERENCE_CAPTURED: "Pyth reference captured",
  POLICY_COMPILED: "Policy compiled",
  POLICY_ARMING: "Arming started",
  PROVIDER_ORDER_CREATED: "Provider confirmed order",
  POLICY_ARMED: "Policy ARMED",
  CANCEL_REQUESTED: "Cancellation requested",
  SIMULATED_FILL_REQUESTED: "Simulated fill requested (demo control)",
  PROVIDER_ORDER_FILLED: "Provider reported FILLED",
  PROVIDER_ORDER_CANCELLED: "Provider confirmed cancellation",
  PROVIDER_ORDER_EXPIRED: "Provider reported expiry",
  PROVIDER_ORDER_FAILED: "Provider reported failure",
  POLICY_EXECUTED: "Policy EXECUTED",
  POLICY_CANCELLED: "Policy CANCELLED",
  POLICY_EXPIRED: "Policy EXPIRED",
  POLICY_FAILED: "Policy FAILED",
};

const SOURCE_LABELS: Record<string, string> = { MOCK_PROVIDER: "MOCK PROVIDER" };

function Row({ term, children, sub }: { term: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line py-3 last:border-b-0">
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="text-right font-mono text-[13px]">
        {children}
        {sub && <span className="mt-0.5 block text-[11px] text-muted">{sub}</span>}
      </dd>
    </div>
  );
}

export default async function PolicyPage({ params }: PageProps<"/policies/[policyId]">) {
  const { policyId } = await params;
  if (!z.uuid().safeParse(policyId).success) notFound();

  const db = getDb();
  const wallet = await getAuthenticatedWallet(db);
  if (!wallet) {
    return (
      <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
        <Card as="section" className="px-5 py-10 sm:px-8">
          <SectionLabel>Sign in required</SectionLabel>
          <h1 className="mt-3 text-lg font-semibold">Sign in with the wallet that owns this policy.</h1>
          <WalletSignInPanel sessionWallet={null} className="mt-6" />
        </Card>
      </main>
    );
  }

  const mode = getExecutionMode();
  // Ownership is enforced in the query: a policy owned by another wallet is simply not found.
  let result = await getPolicyViewForWallet(db, { walletId: wallet.id, policyId });
  if (!result) notFound();

  // Reconcile armed policies on page load (CIRCUIT_ARCHITECTURE.md §14), only with the provider that armed them.
  if (result.policy.status === "ARMED" && result.policy.simulated === (mode === "mock")) {
    try {
      const reconciled = await reconcilePolicy(db, { wallet, policyId }, { provider: getExecutionProvider(db, mode) });
      if (reconciled.changed) result = (await getPolicyViewForWallet(db, { walletId: wallet.id, policyId })) ?? result;
    } catch (error) {
      const appError = toAppError(error);
      logger.warn("reconcile.page_load_failed", { policyId, code: appError.code });
    }
  }
  const { policy, events, execution } = result;
  const relative = policy.expressionType === "RELATIVE_PERCENT";

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold tracking-[-0.01em]">
              {policy.side === "BUY" ? "Buy" : "Sell"} {policy.triggerDirection === "BELOW" ? "below" : "above"} ·{" "}
              {policy.asset.symbol}
            </h1>
            <span data-testid="policy-status">
              <StatusChip tone={POLICY_STATUS_TONE[policy.status]}>{policy.status}</StatusChip>
            </span>
            {policy.simulated && <StatusChip tone="info">SIMULATED</StatusChip>}
          </div>
          <p className="mt-1.5 font-mono text-xs text-muted">policy {policy.id}</p>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          <Card as="section" aria-label="Policy rule" className="p-5 sm:p-6">
            <SectionLabel>Rule</SectionLabel>
            <p className="mt-3 rounded-r-md border-l-2 border-accent bg-panel-2 p-3.5 text-[13px] leading-relaxed">
              {policy.summary}
            </p>
            <dl className="mt-4">
              <Row term="Trigger" sub={relative ? `${policy.sourceExpressionValue}% ${policy.triggerDirection === "BELOW" ? "below" : "above"} captured reference` : "Fixed USD price"}>
                <span className="text-accent">
                  {policy.triggerDirection === "BELOW" ? "≤" : "≥"} {formatUsd(policy.compiledTriggerUsd)}
                </span>
              </Row>
              <Row term={policy.side === "BUY" ? "Maximum capital" : "Maximum sold"} sub={`${policy.amount.atomic} atomic units`}>
                {policy.amount.display} {policy.amount.symbol}
              </Row>
              <Row term="Max slippage" sub={`${policy.maxSlippageBps} bps`}>
                {describeSlippage(policy.maxSlippageBps)}
              </Row>
              <Row term="Expires">{formatUtc(policy.expiresAt)}</Row>
              <Row term="Input mint">{shortAddress(policy.inputMint)}</Row>
              <Row term="Output mint">{shortAddress(policy.outputMint)}</Row>
              <Row term="Created">{formatUtc(policy.createdAt, true)}</Row>
              {policy.armedAt && <Row term="Armed">{formatUtc(policy.armedAt, true)}</Row>}
              {policy.failure && <Row term="Failure" sub={policy.failure.message ?? undefined}>{policy.failure.code}</Row>}
            </dl>
          </Card>

          <Card as="section" aria-label="Audit trail" className="p-5 sm:p-6">
            <SectionLabel>Audit trail</SectionLabel>
            <ol className="mt-4">
              {events.map((event, index) => (
                <li key={event.id} className="grid grid-cols-[auto_16px_1fr] gap-3 pb-4 last:pb-0">
                  <span className="pt-0.5 text-right font-mono text-[11px] text-muted">{formatUtc(event.createdAt, true).slice(11)}</span>
                  <span className="relative flex justify-center" aria-hidden="true">
                    {index < events.length - 1 && <span className="absolute top-3 -bottom-4 w-px bg-line-strong" />}
                    <span className="relative mt-1 size-[11px] rounded-full border-2 border-accent bg-canvas" />
                  </span>
                  <span>
                    <span className="text-[13px] font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
                    <span className="ml-2 font-mono text-[10px] tracking-[0.06em] text-muted">
                      {SOURCE_LABELS[event.source] ?? event.source}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:sticky lg:top-[76px]">
          <Card as="section" aria-label="Captured Pyth reference" className="p-5">
            <SectionLabel tone="accent">Captured Pyth reference</SectionLabel>
            {policy.reference ? (
              <>
                <p className="mt-2 font-mono text-[28px] leading-none">{formatUsd(policy.reference.priceUsd)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusChip tone={policy.reference.freshness === "FRESH" ? "success" : "warning"}>
                    {policy.reference.freshness}
                  </StatusChip>
                  <span className="font-mono text-[11px] text-muted">{formatSession(policy.reference.marketSession)}</span>
                </div>
                <dl className="mt-3">
                  <Row term="Feed">{policy.reference.symbol}</Row>
                  <Row term="Feed updated">{formatUtc(policy.reference.feedUpdateTimestamp, true)}</Row>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-xs text-muted">Reference snapshot unavailable.</p>
            )}
          </Card>

          <Card as="section" aria-label="Execution" className="p-5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>Execution</SectionLabel>
              {policy.simulated && <StatusChip tone="info">SIMULATED</StatusChip>}
            </div>
            <dl className="mt-2">
              <Row term="Provider" sub={policy.simulated ? "Mock provider · demo execution" : undefined}>
                {policy.status === "DRAFT" ? (mode === "mock" ? "Simulated Jupiter" : "Jupiter Trigger") : policy.simulated ? "Simulated Jupiter" : "Jupiter Trigger"}
              </Row>
              {policy.providerOrderId && (
                <Row term={policy.simulated ? "Simulated order id" : "Order id"}>
                  <span data-testid="provider-order-id" title={policy.providerOrderId}>
                    {policy.providerOrderId.slice(0, 13)}…
                  </span>
                </Row>
              )}
            </dl>

            {policy.status === "EXECUTED" && execution?.evidenceSource === "SIMULATED" && (
              <p data-testid="simulated-evidence" className="mt-3 rounded-md border border-dashed border-line-strong p-3 text-xs leading-relaxed text-muted">
                The simulated provider reported this order FILLED at {formatUtc(execution.executedAt, true)}. No Solana
                transaction evidence exists for this simulated fill, and no funds moved.
              </p>
            )}
            {policy.status === "CANCELLED" && (
              <p className="mt-3 text-xs text-muted">Cancellation confirmed by the {policy.simulated ? "simulated " : ""}provider.</p>
            )}
            {policy.status === "EXPIRED" && (
              <p className="mt-3 text-xs text-muted">The {policy.simulated ? "simulated " : ""}order expired without filling.</p>
            )}

            <div className="mt-4">
              <PolicyActions policyId={policy.id} status={policy.status} mode={mode} simulated={policy.simulated} />
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
