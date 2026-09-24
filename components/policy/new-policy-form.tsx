"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { formatAge, formatSession } from "@/components/asset/format";
import { RefreshReferenceButton } from "@/components/asset/refresh-reference-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { SectionLabel } from "@/components/ui/section-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";
import { isAppError } from "@/src/domain/errors";
import { formatUsd, percentDifference, toAtomicUnits } from "@/src/domain/money";
import {
  compileTriggerUsd,
  describePolicy,
  describeSlippage,
  EXPIRY_HOURS_OPTIONS,
  isTriggerAlreadyMet,
  POLICY_TYPES,
  SLIPPAGE_BPS_OPTIONS,
  type ExpiryHours,
  type SlippageBps,
  type SourceExpressionType,
} from "@/src/domain/policy";
import { PrestocksMarkSummary } from "@/components/prestocks/mark-summary";
import { formatUsdCents } from "@/src/domain/money";
import type { ReferenceFreshness, ReferenceSnapshot } from "@/src/domain/reference";

export interface FormAsset {
  id: string;
  symbol: string;
  displayName: string;
  underlyingSymbol: string;
  mintAddress: string;
  decimals: number;
  referenceSymbol: string;
  referenceProvider: "PYTH" | "PRESTOCKS";
  /** "Pyth AAPL reference" or "PreStocks mark". */
  referenceName: string;
}

type PolicyTypeKey = (typeof POLICY_TYPES)[number]["key"];

const EXPIRY_LABELS: Record<ExpiryHours, string> = { 24: "24h", 72: "3d", 168: "7d" };
const EXPIRY_LONG: Record<ExpiryHours, string> = { 24: "24 hours", 72: "3 days", 168: "7 days" };

const FRESHNESS_TONE: Record<ReferenceFreshness, ChipTone> = {
  FRESH: "success",
  CARRIED: "warning",
  STALE: "danger",
  CURRENT_RESPONSE: "info",
};

function errorMessage(error: unknown): string {
  return isAppError(error) ? error.message : "Check this value.";
}

function Field({ label, aside, children, hint, hintTone = "muted" }: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  hint?: React.ReactNode;
  hintTone?: "muted" | "warning" | "danger";
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
        <span>{label}</span>
        {aside && <span className="font-mono tracking-normal normal-case">{aside}</span>}
      </div>
      {children}
      {hint && (
        <p
          className={cn(
            "text-xs",
            hintTone === "warning" ? "text-warning" : hintTone === "danger" ? "text-danger" : "text-muted",
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

function UnitInput({ id, value, onChange, unit, prefix, label }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  unit: string;
  prefix?: string;
  label: string;
}) {
  return (
    <div className="flex h-[42px] items-center rounded-[7px] border border-line-strong bg-panel-2 px-3 transition-colors focus-within:border-accent">
      {prefix && <span className="mr-1.5 font-mono text-xs text-muted">{prefix}</span>}
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(",", "."))}
        className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
        placeholder="0"
      />
      <span className="ml-2 font-mono text-xs text-muted">{unit}</span>
    </div>
  );
}

function ReviewRow({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line py-3 last:border-b-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-right font-mono text-[13px]">
        {children}
        {sub && <span className="mt-0.5 block text-[11px] text-muted">{sub}</span>}
      </span>
    </div>
  );
}

/**
 * Structured policy form with a live review. The preview uses the same pure
 * domain compiler as the server; the server recompiles from a fresh reference
 * (from the asset's own provider: Pyth or PreStocks) when the draft is created and
 * is always authoritative.
 */
export function NewPolicyForm({
  assets,
  asset,
  reference,
  referenceError,
  quote,
}: {
  assets: FormAsset[];
  asset: FormAsset;
  reference: ReferenceSnapshot | null;
  referenceError: string | null;
  quote: { symbol: string; decimals: number };
}) {
  const router = useRouter();
  const ids = useId();
  const [typeKey, setTypeKey] = useState<PolicyTypeKey>("BUY_BELOW");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<SourceExpressionType>("ABSOLUTE_PRICE");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [percent, setPercent] = useState("");
  const [slippage, setSlippage] = useState<SlippageBps>(50);
  const [expiry, setExpiry] = useState<ExpiryHours>(24);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const policyType = POLICY_TYPES.find((type) => type.key === typeKey) ?? POLICY_TYPES[0];
  const buying = policyType.side === "BUY";
  const inputUnit = buying ? quote.symbol : asset.symbol;
  const inputDecimals = buying ? quote.decimals : asset.decimals;
  // Pyth: only a FRESH reference. PreStocks: a successful current API response with a valid mark.
  const relativeAllowed = reference?.freshness === "FRESH" || reference?.freshness === "CURRENT_RESPONSE";
  const prestocks = asset.referenceProvider === "PRESTOCKS";
  const effectiveMode: SourceExpressionType = mode === "RELATIVE_PERCENT" && !relativeAllowed ? "ABSOLUTE_PRICE" : mode;
  const expressionValue = effectiveMode === "ABSOLUTE_PRICE" ? triggerPrice : percent;

  const preview = useMemo(() => {
    let trigger: string | null = null;
    let triggerError: string | null = null;
    let amountError: string | null = null;
    if (expressionValue.trim()) {
      try {
        trigger = compileTriggerUsd({
          direction: policyType.direction,
          expressionType: effectiveMode,
          expressionValue,
          reference: reference ? { priceUsd: reference.priceUsd, freshness: reference.freshness } : null,
        }).compiledTriggerUsd;
      } catch (error) {
        triggerError = errorMessage(error);
      }
    }
    if (amount.trim()) {
      try {
        toAtomicUnits(amount, inputDecimals, buying ? "Budget" : "Amount to sell");
      } catch (error) {
        amountError = errorMessage(error);
      }
    }
    const distance = trigger && reference ? percentDifference(reference.priceUsd, trigger) : null;
    const alreadyMet = trigger && reference ? isTriggerAlreadyMet(policyType.direction, trigger, reference.priceUsd) : false;
    const sentence =
      trigger && amount.trim() && !amountError
        ? describePolicy({
            side: policyType.side,
            direction: policyType.direction,
            assetSymbol: asset.symbol,
            underlyingSymbol: asset.underlyingSymbol,
            referenceName: asset.referenceName,
            quoteSymbol: quote.symbol,
            amountDisplay: amount.trim(),
            compiledTriggerUsd: trigger,
            expressionType: effectiveMode,
            expressionValue: expressionValue.trim(),
            referenceUsd: reference?.priceUsd ?? null,
          })
        : null;
    return { trigger, triggerError, amountError, distance, alreadyMet, sentence };
  }, [amount, asset, buying, effectiveMode, expressionValue, inputDecimals, policyType, quote.symbol, reference]);

  const referenceBlocksDrafts = !reference || reference.freshness === "STALE";
  const canSubmit = !referenceBlocksDrafts && Boolean(preview.sentence) && !preview.triggerError && !submitting;

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          side: policyType.side,
          triggerDirection: policyType.direction,
          expressionType: effectiveMode,
          expressionValue: expressionValue.trim(),
          amount: amount.trim(),
          maxSlippageBps: slippage,
          expiryHours: expiry,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: { policy: { id: string } };
        error?: { message: string };
      };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "The draft could not be created. Try again.");
      router.push(`/policies/${body.data.policy.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The draft could not be created. Try again.");
      setSubmitting(false);
    }
  }

  const triggerHint = preview.triggerError ? (
    { text: preview.triggerError, tone: "danger" as const }
  ) : effectiveMode === "RELATIVE_PERCENT" && preview.trigger ? (
    { text: `Compiles to a fixed trigger of ${formatUsd(preview.trigger)} from the reference shown.`, tone: "muted" as const }
  ) : preview.alreadyMet ? (
    { text: `The reference already meets this condition, so the order could fill immediately once armed.`, tone: "warning" as const }
  ) : preview.distance ? (
    { text: `${preview.distance.startsWith("-") ? "" : "+"}${preview.distance}% from the current reference.`, tone: "muted" as const }
  ) : null;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_400px]">
      <Card as="section" aria-label="Policy inputs" className="flex flex-col gap-6 p-5 sm:p-6">
        <Field label="Asset" aside={<span title={asset.mintAddress}><span className="text-success">✓</span> {shortAddress(asset.mintAddress)}</span>}>
          <div className="flex h-[42px] items-center rounded-[7px] border border-line-strong bg-panel-2 px-3 focus-within:border-accent">
            <select
              aria-label="Asset"
              value={asset.id}
              onChange={(event) => router.push(`/policies/new?asset=${event.target.value}`)}
              className="h-full flex-1 cursor-pointer appearance-none bg-transparent text-sm outline-none"
            >
              {assets.map((option) => (
                <option key={option.id} value={option.id} className="bg-panel-2">
                  {option.symbol} · {option.displayName}
                </option>
              ))}
            </select>
            <span className="font-mono text-xs text-muted">{reference ? `${prestocks ? "mark" : "ref"} ${formatUsdCents(reference.priceUsd)}` : "no reference"}</span>
          </div>
        </Field>

        <SegmentedControl
          name={`${ids}-type`}
          legend="Policy type"
          value={typeKey}
          onChange={setTypeKey}
          columns={2}
          options={POLICY_TYPES.map((type) => ({ value: type.key, label: type.label, hint: type.hint }))}
        />

        <Field
          label={buying ? "Budget" : "Amount to sell"}
          hint={preview.amountError ?? (buying ? `Maximum ${quote.symbol} this policy may spend.` : `Raw ${asset.symbol} token units (${asset.decimals} decimals). Wallets may display a scaled amount.`)}
          hintTone={preview.amountError ? "danger" : "muted"}
        >
          <UnitInput id={`${ids}-amount`} label={buying ? "Budget" : "Amount to sell"} value={amount} onChange={setAmount} unit={inputUnit} />
        </Field>

        <div className="flex flex-col gap-2">
          <SegmentedControl
            name={`${ids}-mode`}
            legend="Trigger"
            value={effectiveMode}
            onChange={setMode}
            columns={2}
            describedBy={!relativeAllowed ? `${ids}-mode-note` : undefined}
            options={[
              { value: "ABSOLUTE_PRICE", label: "Fixed USD price" },
              { value: "RELATIVE_PERCENT", label: prestocks ? "% from PreStocks mark" : "% from current reference", disabled: !relativeAllowed },
            ]}
          />
          {!relativeAllowed && (
            <p id={`${ids}-mode-note`} className="text-xs text-muted">
              {prestocks
                ? "% triggers need a current PreStocks mark."
                : `% triggers need a FRESH Pyth reference${reference ? ` (current: ${reference.freshness})` : ""}.`}
            </p>
          )}
          {effectiveMode === "ABSOLUTE_PRICE" ? (
            <UnitInput id={`${ids}-price`} label="Trigger price" prefix="$" value={triggerPrice} onChange={setTriggerPrice} unit="USD" />
          ) : (
            <UnitInput
              id={`${ids}-percent`}
              label="Trigger percentage"
              value={percent}
              onChange={setPercent}
              unit={`% ${policyType.direction === "BELOW" ? "below" : "above"} ${prestocks ? "mark " : ""}${reference ? formatUsdCents(reference.priceUsd) : "reference"}`}
            />
          )}
          {triggerHint && (
            <p className={cn("text-xs", triggerHint.tone === "danger" ? "text-danger" : triggerHint.tone === "warning" ? "text-warning" : "text-muted")}>
              {triggerHint.text}
            </p>
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <SegmentedControl
            name={`${ids}-slippage`}
            legend="Max slippage"
            value={slippage}
            onChange={setSlippage}
            options={SLIPPAGE_BPS_OPTIONS.map((bps) => ({ value: bps, label: describeSlippage(bps) }))}
          />
          <SegmentedControl
            name={`${ids}-expiry`}
            legend="Expiry"
            value={expiry}
            onChange={setExpiry}
            options={EXPIRY_HOURS_OPTIONS.map((hours) => ({ value: hours, label: EXPIRY_LABELS[hours] }))}
          />
        </div>
      </Card>

      <Card as="section" aria-label="Policy review" className="lg:sticky lg:top-[76px]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <SectionLabel>Policy review</SectionLabel>
          <StatusChip tone="muted">DRAFT</StatusChip>
        </div>

        <div className="border-b border-line px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel tone="accent">{prestocks ? "PreStocks mark" : "Pyth equity reference"}</SectionLabel>
            <RefreshReferenceButton />
          </div>
          {reference?.provider === "PRESTOCKS" ? (
            <div data-testid="prestocks-reference">
              <p className="mt-2 font-mono text-[28px] leading-none">{formatUsdCents(reference.priceUsd)}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                <StatusChip tone={FRESHNESS_TONE[reference.freshness]}>CURRENT RESPONSE</StatusChip>
                <span>received {reference.receivedTimestamp.replace("T", " ").slice(11, 19)} UTC</span>
              </p>
              <div className="mt-3">
                <PrestocksMarkSummary
                  markPriceUsd={reference.prestocks.markPriceUsd}
                  tokenPriceUsd={reference.prestocks.tokenPriceUsd}
                  premiumPercent={reference.prestocks.premiumPercent}
                />
              </div>
            </div>
          ) : reference?.provider === "PYTH" ? (
            <>
              <p className="mt-2 font-mono text-[28px] leading-none">{formatUsd(reference.priceUsd)}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                <StatusChip tone={FRESHNESS_TONE[reference.freshness]}>{reference.freshness}</StatusChip>
                <span>{formatAge(reference.pyth.ageMs)}</span>
                <span>{formatSession(reference.pyth.marketSession)}</span>
              </p>
              <p className="mt-1.5 font-mono text-[11px] text-muted">{reference.pyth.symbol}</p>
            </>
          ) : (
            <>
              <p className="mt-2 font-mono text-[28px] leading-none text-dim" aria-label="No reference">
                <span aria-hidden="true">—</span>
              </p>
              <p className="mt-2 text-xs text-muted">{referenceError ?? "No reference loaded."}</p>
            </>
          )}
        </div>

        <div className="px-5 py-1">
          <ReviewRow label="Reference" sub={prestocks ? "PreStocks · captured when the draft is created" : "Pyth · captured when the draft is created"}>
            {prestocks ? "PreStocks mark" : `Pyth ${asset.referenceSymbol.replace(/^Equity\.[A-Z]+\./, "")}`}
          </ReviewRow>
          <ReviewRow label="Your trigger" sub={preview.distance ? `${preview.distance.startsWith("-") ? "" : "+"}${preview.distance}% vs reference` : undefined}>
            <span className="text-base text-accent">
              {preview.trigger ? `${policyType.direction === "BELOW" ? "≤" : "≥"} ${formatUsd(preview.trigger)}` : "—"}
            </span>
          </ReviewRow>
          <ReviewRow label={buying ? "Maximum capital" : "Maximum sold"}>
            {amount.trim() && !preview.amountError ? `${amount.trim()} ${inputUnit}` : "—"}
          </ReviewRow>
          <ReviewRow label="Max slippage" sub={`${slippage} bps`}>
            {describeSlippage(slippage)}
          </ReviewRow>
          <ReviewRow label="Expires" sub="UTC time fixed when the draft is created">
            {EXPIRY_LONG[expiry]} after creation
          </ReviewRow>
          <ReviewRow label="Execution monitor" sub="Jupiter Trigger monitors the token's own USD price">
            Jupiter {asset.symbol}/USD
          </ReviewRow>
        </div>

        <div className="mx-5 mb-4 rounded-r-md border-l-2 border-accent bg-panel-2 p-3.5 text-[12.5px] leading-relaxed text-text/85">
          {preview.sentence ?? "Complete the amount and trigger to see the exact policy in plain English."}
        </div>

        <div className="mx-5 mb-4 grid grid-cols-3 gap-2 text-[11px] leading-snug text-muted">
          <div className="rounded-md border border-line p-2.5">
            <b className="mb-0.5 block text-xs font-medium text-text">{prestocks ? "PreStocks" : "Pyth"}</b>
            {prestocks ? "Mark reference" : "Reference and context"}
          </div>
          <div className="rounded-md border border-line p-2.5">
            <b className="mb-0.5 block text-xs font-medium text-text">Circuit</b>Deterministic compiler
          </div>
          <div className="rounded-md border border-line p-2.5">
            <b className="mb-0.5 block text-xs font-medium text-text">Jupiter</b>Monitors and executes after arming
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-line px-5 py-4">
          <Button variant="primary" size="lg" disabled={!canSubmit} onClick={submit}>
            {submitting ? "Creating draft…" : "Create draft policy"}
          </Button>
          {submitError && (
            <p role="alert" className="text-center text-xs text-danger">
              {submitError}
            </p>
          )}
          <p className="text-center text-xs text-muted">
            {referenceBlocksDrafts
              ? `A usable ${asset.referenceName} is required before a draft can be created.`
              : "Creates a DRAFT only. Nothing is signed and no order is placed. Circuit recompiles from a fresh reference when you create it."}
          </p>
        </div>
      </Card>
    </div>
  );
}
