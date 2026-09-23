"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { PolicyStatus } from "@/src/domain/policy";

type Action = "arm" | "reconcile" | "cancel" | "simulate-fill";

const ENDPOINT: Record<Action, (id: string) => string> = {
  arm: (id) => `/api/policies/${id}/arm`,
  reconcile: (id) => `/api/policies/${id}/reconcile`,
  cancel: (id) => `/api/policies/${id}/cancel`,
  "simulate-fill": (id) => `/api/policies/${id}/mock/simulate-fill`,
};

const CANCEL_OUTCOME_NOTE: Record<string, string> = {
  ALREADY_FILLED: "The simulated provider had already filled this order, so it is EXECUTED, not cancelled.",
  ALREADY_EXPIRED: "The simulated order had already expired.",
  ALREADY_FAILED: "The simulated provider reported the order as failed.",
};

/**
 * Lifecycle controls for one policy. Simulated-mode controls are labelled as such,
 * and "Simulate provider fill" changes only the mock provider: Circuit's state
 * changes only when it reconciles.
 */
export function PolicyActions({
  policyId,
  status,
  mode,
  simulated,
}: {
  policyId: string;
  status: PolicyStatus;
  mode: "mock" | "live";
  simulated: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providerFilled, setProviderFilled] = useState(false);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(ENDPOINT[action](policyId), { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        data?: { outcome?: string; diagnostic?: string | null; providerState?: string };
        error?: { message: string };
      };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "The request failed. Try again.");
      if (action === "simulate-fill") {
        // Deliberately no refresh: the provider changed, Circuit has not reconciled yet.
        setProviderFilled(body.data.providerState === "FILLED");
        setNotice(
          body.data.providerState === "FILLED"
            ? "The simulated provider now reports FILLED. Circuit still shows ARMED until it reconciles."
            : `The simulated provider reports ${body.data.providerState}.`,
        );
        return;
      }
      if (action === "cancel" && body.data.outcome && CANCEL_OUTCOME_NOTE[body.data.outcome]) {
        setNotice(CANCEL_OUTCOME_NOTE[body.data.outcome]!);
      }
      if (action === "reconcile" && body.data.diagnostic) setNotice(body.data.diagnostic);
      setProviderFilled(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const feedback = (
    <>
      {notice && (
        <p data-testid="policy-action-notice" className="mt-3 text-xs leading-relaxed text-warning">
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

  if (status === "DRAFT") {
    if (mode === "live") {
      return (
        <div>
          <Button variant="primary" size="lg" disabled className="w-full">
            Arm policy
          </Button>
          <p className="mt-2 text-center text-xs text-muted">Live Jupiter execution is not configured yet.</p>
        </div>
      );
    }
    return (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <StatusChip tone="info">SIMULATED</StatusChip>
          <span className="text-xs text-muted">Demo execution</span>
        </div>
        <p className="text-[13px] leading-relaxed text-muted">
          This demo uses a simulated Jupiter provider. No transaction will be sent and no funds will move.
        </p>
        <Button
          data-testid="arm-simulated"
          variant="primary"
          size="lg"
          className="mt-4 w-full"
          disabled={busy !== null}
          onClick={() => run("arm")}
        >
          {busy === "arm" ? "Arming simulated order…" : "Arm simulated order"}
        </Button>
        {feedback}
      </div>
    );
  }

  if (status === "ARMED") {
    if (simulated && mode !== "mock") {
      return <p className="text-[13px] text-muted">This simulated policy can only be managed while Circuit runs in mock mode.</p>;
    }
    return (
      <div className="flex flex-col gap-2.5">
        <Button data-testid="reconcile" size="lg" disabled={busy !== null} onClick={() => run("reconcile")}>
          {busy === "reconcile" ? "Reconciling…" : providerFilled ? "Reconcile now" : "Refresh status"}
        </Button>
        <Button data-testid="cancel-simulated" variant="danger" size="lg" disabled={busy !== null} onClick={() => run("cancel")}>
          {busy === "cancel" ? "Cancelling…" : simulated ? "Cancel simulated order" : "Cancel order"}
        </Button>
        {simulated && (
          <div className="mt-2 rounded-md border border-dashed border-line-strong p-3">
            <p className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
              Demo control <StatusChip tone="info">MOCK PROVIDER</StatusChip>
            </p>
            <Button
              data-testid="simulate-fill"
              size="md"
              className="w-full"
              disabled={busy !== null || providerFilled}
              onClick={() => run("simulate-fill")}
            >
              {busy === "simulate-fill" ? "Simulating…" : "Simulate provider fill"}
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Tells the simulated provider the order filled. Circuit records EXECUTED only after it reconciles.
            </p>
          </div>
        )}
        {feedback}
      </div>
    );
  }

  return feedback;
}
