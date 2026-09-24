import type { Metadata } from "next";
import { formatUtc } from "@/components/asset/format";
import { PendingIntegrationCard } from "@/components/asset/pending-integration-card";
import { PythMarketCard } from "@/components/asset/pyth-market-card";
import { PRESTOCKS_DISCLOSURE, PrestocksMarkSummary } from "@/components/prestocks/mark-summary";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import { shortAddress } from "@/components/wallet/short-address";
import { ALL_VERIFIED_ASSETS, pendingIntegrations } from "@/src/config/assets";
import { PRESTOCKS_DISCOVERY_CHECKED_AT } from "@/src/config/prestocks";
import { getDb } from "@/src/db/client";
import { getPrestocksClient } from "@/src/integrations/prestocks/client";
import { logger } from "@/src/observability/logger";
import { cn } from "@/components/ui/cn";
import { toAppError } from "@/src/domain/errors";
import type { PythReferenceSnapshot } from "@/src/domain/reference";
import { defaultReferenceClients, getAssetReference } from "@/src/services/get-reference";
import { listPublicAssets } from "@/src/services/list-assets";
import { listPrestocksMarkets, type MarketSupportState, type PrestocksMarketRow } from "@/src/services/prestocks-markets";

export const metadata: Metadata = { title: "Markets" };
export const dynamic = "force-dynamic";

const SUPPORT: Record<MarketSupportState, { tone: ChipTone; label: string }> = {
  SUPPORTED: { tone: "success", label: "SUPPORTED" },
  ROUTE_VERIFIED: { tone: "info", label: "ROUTE VERIFIED" },
  UNVERIFIED: { tone: "muted", label: "UNVERIFIED" },
  NOT_ELIGIBLE: { tone: "warning", label: "TRANSITION · NOT ELIGIBLE" },
};

function MarketCard({ row }: { row: PrestocksMarketRow }) {
  const support = SUPPORT[row.support.state];
  return (
    <Card
      as="article"
      key={row.contractAddress}
      aria-labelledby={`market-${row.symbol}`}
      className={cn("flex flex-col p-5", row.support.state === "SUPPORTED" && "border-accent/60")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>{row.name}</SectionLabel>
          <h2 id={`market-${row.symbol}`} className="mt-1 text-lg font-semibold">
            {row.symbol}
          </h2>
        </div>
        <StatusChip tone={support.tone}>{support.label}</StatusChip>
      </div>
      <div className="mt-3">
        <PrestocksMarkSummary markPriceUsd={row.markPriceUsd} tokenPriceUsd={row.tokenPriceUsd} premiumPercent={row.premiumPercent} />
      </div>
      <dl className="mt-1 flex items-baseline justify-between gap-4 py-2.5">
        <dt className="text-xs text-muted">Solana contract</dt>
        <dd className="font-mono text-[13px]" title={row.contractAddress}>
          {shortAddress(row.contractAddress)}
        </dd>
      </dl>
      <p className="text-[11px] leading-relaxed text-muted">{row.support.detail}</p>
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
        {row.assetId && (
          <ButtonLink href={`/policies/new?asset=${row.assetId}`} variant="primary">
            Create policy
          </ButtonLink>
        )}
        <a href={row.productUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-accent underline-offset-2 hover:underline">
          PreStocks product page ↗
        </a>
      </div>
    </Card>
  );
}

/** The live Pyth reference, or null (logged) when unavailable: never an earlier value. */
async function pythReference(assetId: string): Promise<PythReferenceSnapshot | null> {
  try {
    const { reference } = await getAssetReference(getDb(), assetId, defaultReferenceClients());
    return reference.provider === "PYTH" ? reference : null;
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("markets.pyth_reference_unavailable", { assetId, code: appError.code, reason: typeof appError.cause === "string" ? appError.cause : undefined });
    return null;
  }
}

/** Recorded no-funds Jupiter checks from the curated config (exact mint match). */
function jupiterChecks(mintAddress: string) {
  const levels = ALL_VERIFIED_ASSETS.find((entry) => entry.mintAddress === mintAddress)?.jupiter.levels;
  return {
    tokenRecognized: levels?.JUPITER_TOKEN_RECOGNIZED?.result === "PASSED",
    routingVerified: levels?.SPOT_ROUTE_VERIFIED?.result === "PASSED",
  };
}

export default async function MarketsPage() {
  const db = getDb();
  const markets = await listPrestocksMarkets(db, { prestocks: getPrestocksClient() });
  if (markets.status === "unavailable") logger.warn("markets.prestocks_unavailable", { reason: markets.reason });
  // Executable assets come from the database; verified-but-disabled integrations (e.g. AAPLx
  // while Pyth US-equity access is pending) come from the curated config and are never seeded.
  const executable = await listPublicAssets(db).catch(() => []);
  const pythAssets = await Promise.all(
    executable
      .filter((asset) => asset.reference.provider === "PYTH" && asset.reference.configured)
      .map(async (asset) => ({ asset, reference: await pythReference(asset.id), jupiter: jupiterChecks(asset.mintAddress) })),
  );
  const pending = pendingIntegrations(new Set(executable.map((asset) => asset.mintAddress)));
  const rows = markets.status === "available" ? markets.rows : [];
  const supportedRows = rows.filter((row) => row.support.state === "SUPPORTED");
  const otherRows = rows.filter((row) => row.support.state !== "SUPPORTED");

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Markets</h1>
        <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-muted">
          Tokenized stocks Circuit can reference: private-company exposure from PreStocks&apos; first-party catalog, and
          public equities referenced by Pyth. Circuit support is a technical integration state, not a recommendation.
        </p>
      </div>

      {markets.status === "unavailable" ? (
        <Card className="px-5 py-8 sm:px-6">
          <p className="text-[15px] font-semibold">Reference temporarily unavailable</p>
          <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-muted">
            The PreStocks catalog could not be loaded, so no marks or prices are shown. Nothing is displayed from an old
            response. Refresh to try again.
          </p>
        </Card>
      ) : (
        <>
          <dl className="mb-4 grid gap-2 rounded-lg border border-line bg-panel-2 px-4 py-3 text-xs leading-relaxed sm:grid-cols-3">
            <div>
              <dt className="font-semibold">PreStocks mark</dt>
              <dd className="text-muted">PreStocks&apos; reference value. Circuit compiles your trigger from it.</dd>
            </div>
            <div>
              <dt className="font-semibold">Token market price</dt>
              <dd className="text-muted">The onchain token&apos;s price. This is what Jupiter monitors.</dd>
            </div>
            <div>
              <dt className="font-semibold">Premium / discount</dt>
              <dd className="text-muted">How far the token trades above or below the mark.</dd>
            </div>
          </dl>
          <p className="mb-3 font-mono text-[11px] text-muted">
            PreStocks response received {formatUtc(markets.receivedAt, true)} · support states checked{" "}
            {formatUtc(PRESTOCKS_DISCOVERY_CHECKED_AT)}
            {markets.rejectedCount > 0 ? ` · ${markets.rejectedCount} malformed item(s) skipped` : ""}
          </p>
        </>
      )}

      {supportedRows.length + pythAssets.length > 0 && (
        <section aria-labelledby="markets-available" className="mb-8">
          <SectionLabel id="markets-available" className="mb-3">
            Available in Circuit
          </SectionLabel>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="supported-markets">
            {supportedRows.map((row) => (
              <MarketCard key={row.contractAddress} row={row} />
            ))}
            {pythAssets.map(({ asset, reference, jupiter }) => (
              <PythMarketCard key={asset.id} asset={asset} reference={reference} jupiter={jupiter} />
            ))}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section aria-labelledby="markets-public" className="mb-8">
          <SectionLabel id="markets-public">Public-market integrations</SectionLabel>
          <p className="mt-1 mb-3 max-w-[640px] text-xs leading-relaxed text-muted">
            Verified on Solana and Jupiter, with a Pyth reference mapping. Not executable in this deployment.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="public-market-integrations">
            {pending.map((integration) => (
              <PendingIntegrationCard key={integration.mintAddress} integration={integration} />
            ))}
          </div>
        </section>
      )}

      {otherRows.length > 0 && (
        <section aria-labelledby="markets-prestocks">
          <SectionLabel id="markets-prestocks" className="mb-3">
            Other PreStocks products
          </SectionLabel>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="prestocks-markets">
            {otherRows.map((row) => (
              <MarketCard key={row.contractAddress} row={row} />
            ))}
          </div>
        </section>
      )}

      <p className="mt-8 max-w-[760px] text-xs leading-relaxed text-muted">
        {PRESTOCKS_DISCLOSURE}
      </p>
    </main>
  );
}
