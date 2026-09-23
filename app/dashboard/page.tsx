import type { Metadata } from "next";
import { AssetReferenceCard, type ReferenceState } from "@/components/asset/asset-reference-card";
import { formatUsd } from "@/components/asset/format";
import { PolicyList } from "@/components/policy/policy-list";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { POLICY_STATUS_TONE, StatusChip, type PolicyStatus } from "@/components/ui/status-chip";
import { ValueBlock } from "@/components/ui/value-block";
import { shortAddress } from "@/components/wallet/short-address";
import { WalletSignInPanel } from "@/components/wallet/wallet-sign-in-panel";
import { getAuthenticatedWallet } from "@/src/auth/current-wallet";
import { getSession } from "@/src/auth/session";
import { getDb } from "@/src/db/client";
import type { PublicAsset } from "@/src/domain/asset";
import { toAppError } from "@/src/domain/errors";
import { getPythClient } from "@/src/integrations/pyth/client";
import { logger } from "@/src/observability/logger";
import { getAssetReference } from "@/src/services/get-reference";
import { listPublicAssets } from "@/src/services/list-assets";
import { listPolicyViewsForWallet, type PolicyView } from "@/src/services/policy-view";

export const metadata: Metadata = {
  title: "Policies",
};

// Milestone numbers refer to CIRCUIT_ARCHITECTURE.md §32.
const INFRASTRUCTURE = [
  {
    provider: "Pyth",
    role: "Reference data",
    body: "Independent market context and freshness for each supported stock token.",
    milestone: "Milestone 2",
    integrated: true,
  },
  {
    provider: "Jupiter Trigger",
    role: "Execution rail",
    body: "Autonomous price-trigger execution that keeps running without Circuit or your browser.",
    milestone: "Milestone 4",
    integrated: false,
  },
  {
    provider: "Solana",
    role: "Settlement evidence",
    body: "Final transaction evidence for every fill, linked from the policy's audit trail.",
    milestone: "Milestone 6",
    integrated: false,
  },
] as const;

const LIFECYCLE: ReadonlyArray<{ status: PolicyStatus; meaning: string }> = [
  { status: "DRAFT", meaning: "Compiled from your inputs. Nothing authorized." },
  { status: "ARMING", meaning: "Wallet signing and provider confirming." },
  { status: "ARMED", meaning: "Provider confirmed the order exists." },
];

const TERMINAL: ReadonlyArray<{ status: PolicyStatus; meaning: string }> = [
  { status: "EXECUTED", meaning: "Fill confirmed with onchain evidence" },
  { status: "CANCELLED", meaning: "Cancellation confirmed by provider" },
  { status: "EXPIRED", meaning: "Expiry reached without a fill" },
  { status: "FAILED", meaning: "Arming or execution failed" },
];

function LifecycleStep({ status, meaning }: { status: PolicyStatus; meaning: string }) {
  return (
    <div>
      <StatusChip tone={POLICY_STATUS_TONE[status]}>{status}</StatusChip>
      <p className="mt-2 text-xs leading-normal text-muted">{meaning}</p>
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="font-mono text-dim">
      <span className="md:hidden">↓</span>
      <span className="hidden md:inline">→</span>
    </span>
  );
}

type CatalogState =
  | { status: "loaded"; entries: Array<{ asset: PublicAsset; state: ReferenceState }> }
  | { status: "unavailable" };

/** Loads curated assets and one live Pyth reference each. Failures become honest states, never old values. */
async function loadCatalog(): Promise<CatalogState> {
  const db = getDb();
  let assets: PublicAsset[];
  try {
    assets = await listPublicAssets(db);
  } catch (error) {
    logger.error("dashboard.catalog_failed", { error: error instanceof Error ? error : undefined });
    return { status: "unavailable" };
  }
  const pyth = getPythClient();
  const entries = await Promise.all(
    assets.map(async (asset) => {
      try {
        const { reference } = await getAssetReference(db, asset.id, { pyth });
        return { asset, state: { status: "available", reference } as ReferenceState };
      } catch (error) {
        const appError = toAppError(error);
        logger.warn("dashboard.reference_unavailable", {
          assetId: asset.id,
          code: appError.code,
          reason: typeof appError.cause === "string" ? appError.cause : undefined,
        });
        return { asset, state: { status: "unavailable", message: appError.message } as ReferenceState };
      }
    }),
  );
  return { status: "loaded", entries };
}

export default async function DashboardPage() {
  const session = await getSession();
  const wallet = session?.walletAddress ?? null;
  const catalog = wallet ? await loadCatalog() : null;
  let policies: PolicyView[] = [];
  if (wallet) {
    try {
      const walletRecord = await getAuthenticatedWallet(getDb());
      policies = walletRecord ? await listPolicyViewsForWallet(getDb(), walletRecord.id) : [];
    } catch (error) {
      logger.error("dashboard.policies_failed", { error: error instanceof Error ? error : undefined });
    }
  }
  const firstReference =
    catalog?.status === "loaded"
      ? catalog.entries.find((entry) => entry.state.status === "available")
      : undefined;
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Policies</h1>
          <p className="mt-1.5 text-[13px] text-muted">
            Your execution policies and their provider-confirmed state will appear here.
          </p>
        </div>
        {wallet ? (
          <StatusChip tone="success" className="self-start sm:self-auto">
            SIGNED IN · {shortAddress(wallet)}
          </StatusChip>
        ) : (
          <StatusChip tone="muted" className="self-start sm:self-auto">
            NOT SIGNED IN
          </StatusChip>
        )}
      </div>

      {wallet && policies.length > 0 ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Your policies</SectionLabel>
            <ButtonLink href="/policies/new" variant="primary">
              + New policy
            </ButtonLink>
          </div>
          <PolicyList policies={policies} />
        </div>
      ) : wallet ? (
        <Card as="section" aria-labelledby="empty-heading" className="px-5 py-10 sm:px-8 sm:py-12">
          <SectionLabel>Your policies</SectionLabel>
          <h2 id="empty-heading" className="mt-3 max-w-[520px] text-lg font-semibold sm:text-xl">
            No policies yet.
          </h2>
          <p className="mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted">
            Draft a bounded policy for a verified stock token. Drafts are saved here with their captured Pyth
            reference; arming with Jupiter comes in a later milestone.
          </p>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start">
            <ButtonLink href="/policies/new" variant="primary" size="lg">
              New policy
            </ButtonLink>
          </div>
          <WalletSignInPanel sessionWallet={wallet} size="md" className="mt-6" />
        </Card>
      ) : null}

      {catalog && (
        <section aria-labelledby="reference-heading" className="mt-12">
          <SectionLabel id="reference-heading" className="mb-3">
            Verified assets · live reference
          </SectionLabel>
          {catalog.status === "unavailable" ? (
            <Card className="px-5 py-8 text-[13px] text-muted sm:px-6">
              The asset catalog could not be loaded. Refresh the page to try again.
            </Card>
          ) : catalog.entries.length === 0 ? (
            <Card className="px-5 py-8 sm:px-6">
              <p className="text-[15px] font-semibold">No verified assets are enabled yet.</p>
              <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-muted">
                An asset appears here once its issuer, Solana mint and Pyth equity feed have been verified and
                Circuit&apos;s Pyth access can read that feed.
              </p>
            </Card>
          ) : (
            <div className="grid gap-3">
              {catalog.entries.map(({ asset, state }) => (
                <AssetReferenceCard key={asset.id} asset={asset} state={state} />
              ))}
            </div>
          )}
        </section>
      )}

      {!wallet ? (
        <Card as="section" aria-labelledby="empty-heading" className="px-5 py-10 sm:px-8 sm:py-12">
          <SectionLabel>Get started</SectionLabel>
          <h2 id="empty-heading" className="mt-3 max-w-[520px] text-lg font-semibold sm:text-xl">
            Connect a Solana wallet to create your first execution policy.
          </h2>
          <p className="mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted">
            Your wallet is your Circuit identity. Circuit never asks for your seed phrase or private
            keys, and nothing executes until you authorize it in your wallet.
          </p>
          <WalletSignInPanel sessionWallet={null} className="mt-6" />
        </Card>
      ) : null}

      <section aria-labelledby="stack-heading" className="mt-12">
        <SectionLabel id="stack-heading" className="mb-3">
          Infrastructure roles
        </SectionLabel>
        <div className="grid gap-3 md:grid-cols-3">
          {INFRASTRUCTURE.map((item) => (
            <Card as="article" key={item.provider} className="flex flex-col p-5">
              <p className="font-mono text-xs font-medium tracking-[0.08em] text-accent uppercase">
                {item.provider}
              </p>
              <h3 className="mt-2 text-[15px] font-semibold">{item.role}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{item.body}</p>
              <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                {item.integrated ? (
                  <StatusChip tone="info">SERVER INTEGRATION</StatusChip>
                ) : (
                  <StatusChip tone="muted">NOT INTEGRATED YET</StatusChip>
                )}
                <span className="font-mono text-[11px] text-muted">{item.milestone}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <div className="mt-12 grid gap-3 lg:grid-cols-[1fr_400px]">
        <Card as="section" aria-labelledby="lifecycle-heading" className="p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionLabel id="lifecycle-heading">Policy lifecycle</SectionLabel>
            <p className="text-[11px] text-muted">How Circuit models a policy, not your current state</p>
          </div>
          <div className="mt-5 grid items-start gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.2fr]">
            {LIFECYCLE.map((step) => (
              <div key={step.status} className="contents">
                <LifecycleStep {...step} />
                <Arrow />
              </div>
            ))}
            <ul className="grid gap-3 border-l border-line pl-4">
              {TERMINAL.map((step) => (
                <li key={step.status} className="flex flex-col gap-1">
                  <StatusChip tone={POLICY_STATUS_TONE[step.status]} className="self-start">
                    {step.status}
                  </StatusChip>
                  <span className="text-xs text-muted">{step.meaning}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
            A policy only becomes ARMED, EXECUTED or CANCELLED after the execution provider or
            Solana confirms it. FAILED is never shown as CANCELLED.
          </p>
        </Card>

        <Card as="section" aria-labelledby="review-heading" className="p-5 sm:p-6">
          <SectionLabel id="review-heading">What you review before arming</SectionLabel>
          <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
            <ValueBlock
              label="Pyth reference"
              value={
                firstReference?.state.status === "available" ? formatUsd(firstReference.state.reference.priceUsd) : null
              }
              meta={
                firstReference?.state.status === "available"
                  ? `${firstReference.asset.symbol} · ${firstReference.state.reference.freshness} · ${firstReference.state.reference.symbol}`
                  : undefined
              }
              emptyText={wallet ? "No live reference available yet" : "Sign in to load live reference data"}
            />
            <ValueBlock
              label="Your trigger"
              value={null}
              emphasis="accent"
              emptyText="Compiled from your policy in Milestone 3"
            />
          </div>
        </Card>
      </div>
    </main>
  );
}
