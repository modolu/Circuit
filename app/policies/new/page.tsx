import type { Metadata } from "next";
import { PendingIntegrationNotice } from "@/components/asset/pending-integration-card";
import { NewPolicyForm, type FormAsset } from "@/components/policy/new-policy-form";
import { PolicyBlockedState } from "@/components/policy/policy-blocked-state";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { WalletSignInPanel } from "@/components/wallet/wallet-sign-in-panel";
import { getSession } from "@/src/auth/session";
import { ALL_VERIFIED_ASSETS, pendingIntegrations } from "@/src/config/assets";
import { USDC } from "@/src/config/tokens";
import { getDb } from "@/src/db/client";
import { toAppError } from "@/src/domain/errors";
import type { ReferenceSnapshot } from "@/src/domain/reference";
import { referenceName } from "@/src/domain/reference";
import { logger } from "@/src/observability/logger";
import { defaultReferenceClients, getAssetReference } from "@/src/services/get-reference";
import { listPublicAssets } from "@/src/services/list-assets";

export const metadata: Metadata = { title: "New policy" };

function Header() {
  return (
    <div className="mb-6">
      <h1 className="text-[22px] font-semibold tracking-[-0.01em]">New policy</h1>
      <p className="mt-1.5 text-[13px] text-muted">
        Every field is explicit. Nothing is executed until you authorize it in your wallet.
      </p>
    </div>
  );
}

export default async function NewPolicyPage({ searchParams }: PageProps<"/policies/new">) {
  const session = await getSession();
  const db = getDb();
  // Executable assets are the database rows; verified-but-disabled integrations (e.g. AAPLx
  // while Pyth US-equity access is pending) come from curated config and are display-only.
  const pendingFor = (assets: { mintAddress: string }[]) => pendingIntegrations(new Set(assets.map((asset) => asset.mintAddress)));
  if (!session) {
    const pending = pendingFor(await listPublicAssets(db).catch(() => []));
    return (
      <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
        <Header />
        <Card as="section" className="px-5 py-10 sm:px-8">
          <SectionLabel>Sign in required</SectionLabel>
          <h2 className="mt-3 text-lg font-semibold">Sign in with your wallet to create a policy.</h2>
          <p className="mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted">
            Policies belong to the wallet that creates them.
          </p>
          <WalletSignInPanel sessionWallet={null} className="mt-6" />
        </Card>
        <PendingIntegrationNotice integrations={pending} />
      </main>
    );
  }

  const assets = await listPublicAssets(db);
  const pending = pendingFor(assets);
  const usable = assets.filter((asset) => asset.reference.configured);

  if (usable.length === 0) {
    return (
      <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
        <Header />
        <PolicyBlockedState
          configured={ALL_VERIFIED_ASSETS.map((asset) => ({
            symbol: asset.symbol,
            displayName: asset.displayName,
            mintAddress: asset.mintAddress,
            referenceLabel: asset.referenceProvider === "PYTH" ? "Pyth mapping" : "PreStocks mark mapping",
            referenceDetail:
              asset.referenceProvider === "PYTH"
                ? `${asset.reference.symbol} · feed ${asset.reference.feedId}`
                : `${asset.reference.symbol} · prestocks.com API`,
            liveReferenceAccess:
              asset.referenceProvider === "PYTH" ? asset.verification.pythLiveCheck.status : asset.verification.prestocksLiveCheck.status,
            jupiterRoutingVerified:
              asset.jupiter.levels.JUPITER_TOKEN_RECOGNIZED?.result === "PASSED" &&
              asset.jupiter.levels.SPOT_ROUTE_VERIFIED?.result === "PASSED",
            executionVerified: asset.execution.status === "VERIFIED",
          }))}
        />
      </main>
    );
  }

  const requested = (await searchParams).asset;
  const selected = usable.find((asset) => asset.id === requested) ?? usable[0]!;

  let reference: ReferenceSnapshot | null = null;
  let referenceError: string | null = null;
  try {
    reference = (await getAssetReference(db, selected.id, defaultReferenceClients())).reference;
  } catch (error) {
    const appError = toAppError(error);
    referenceError = appError.message;
    logger.warn("policy_form.reference_unavailable", {
      assetId: selected.id,
      code: appError.code,
      reason: typeof appError.cause === "string" ? appError.cause : undefined,
    });
  }

  const toFormAsset = (asset: (typeof usable)[number]): FormAsset => ({
    id: asset.id,
    symbol: asset.symbol,
    displayName: asset.displayName,
    underlyingSymbol: asset.underlyingSymbol,
    mintAddress: asset.mintAddress,
    decimals: asset.decimals,
    referenceSymbol: asset.reference.symbol,
    referenceProvider: asset.reference.provider,
    referenceName: referenceName(asset.reference.provider, asset.underlyingSymbol),
  });

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
      <Header />
      <NewPolicyForm
        key={selected.id}
        assets={usable.map(toFormAsset)}
        asset={toFormAsset(selected)}
        reference={reference}
        referenceError={referenceError}
        quote={{ symbol: USDC.symbol, decimals: USDC.decimals }}
      />
      <PendingIntegrationNotice integrations={pending} />
    </main>
  );
}
