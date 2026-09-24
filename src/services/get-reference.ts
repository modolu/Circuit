import "server-only";
import type { DbExecutor } from "../db/client.ts";
import { findAssetById } from "../db/repositories/assets.ts";
import { assetMetadataSchema, type PublicAsset } from "../domain/asset.ts";
import { AppError } from "../domain/errors.ts";
import type { PrestocksReferenceSnapshot, PythReferenceSnapshot, ReferenceSnapshot } from "../domain/reference.ts";
import { getPrestocksClient, PrestocksRequestError, type PrestocksClient } from "../integrations/prestocks/client.ts";
import { PRESTOCKS_API_URL } from "../integrations/prestocks/types.ts";
import { getPythClient, PythRequestError, type PythClient } from "../integrations/pyth/client.ts";
import { mapLatestPrice } from "../integrations/pyth/mapper.ts";
import { toPublicAsset } from "./list-assets.ts";

/*
 * Resolves the live reference for a curated asset (CIRCUIT_ARCHITECTURE.md §10, §28).
 * The PROVIDER and its configuration (Pyth feed, or PreStocks contract address) come
 * only from the stored catalog row, never from the caller, so this is not a general
 * proxy. There is no fallback between providers and nothing is cached: when a provider
 * is unavailable there is no reference, rather than an old value shown as current.
 */

export interface AssetReference {
  asset: PublicAsset;
  reference: ReferenceSnapshot;
}

export interface ReferenceClients {
  pyth?: PythClient;
  prestocks?: PrestocksClient;
}

/** The deployment's clients for every reference provider. Every production caller uses this, so none can forget one. */
export function defaultReferenceClients(): Required<ReferenceClients> {
  return { pyth: getPythClient(), prestocks: getPrestocksClient() };
}

const UNAVAILABLE = {
  PYTH: "The Pyth reference for this asset is unavailable right now.",
  PRESTOCKS: "The PreStocks mark for this asset is unavailable right now.",
} as const;

export async function getAssetReference(db: DbExecutor, assetId: string, clients: ReferenceClients): Promise<AssetReference> {
  const row = await findAssetById(db, assetId);
  if (!row) throw new AppError("NOT_FOUND", "Asset not found.");
  if (!row.active) throw new AppError("ASSET_DISABLED", "This asset is not currently available in Circuit.");

  const asset = toPublicAsset(row);
  const metadata = assetMetadataSchema.safeParse(row.metadata);
  const provider = row.referenceProvider;
  if (!asset || !metadata.success || !asset.reference.configured) {
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE[provider], { cause: "reference_not_configured" });
  }
  const config = metadata.data.reference;

  if (config.provider === "pyth_pro") {
    if (!clients.pyth) throw new AppError("INTERNAL_ERROR", "No Pyth client configured.");
    return { asset, reference: await pythReference(clients.pyth, config) };
  }
  if (!clients.prestocks) throw new AppError("INTERNAL_ERROR", "No PreStocks client configured.");
  return { asset, reference: await prestocksReference(clients.prestocks, { ...config, mintAddress: row.mintAddress }) };
}

async function pythReference(
  pyth: PythClient,
  { feedId, symbol, channel }: { feedId: number; symbol: string; channel: Parameters<PythClient["latestPrice"]>[0]["channel"] },
): Promise<PythReferenceSnapshot> {
  let latest;
  try {
    latest = await pyth.latestPrice({ feedIds: [feedId], channel });
  } catch (error) {
    const reason = error instanceof PythRequestError ? `pyth_${error.reason}` : "pyth_unexpected";
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE.PYTH, { cause: reason, retryable: true });
  }
  const result = mapLatestPrice(latest.response, { feedId, symbol, receivedAt: latest.receivedAt });
  if (result.status === "UNAVAILABLE") {
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE.PYTH, { cause: `reference_${result.reason}` });
  }
  const r = result.reference;
  return {
    provider: "PYTH",
    referenceType: "UNDERLYING_EQUITY",
    priceUsd: r.priceUsd,
    freshness: r.freshness,
    timestampKind: "SOURCE",
    sourceTimestamp: r.feedUpdateTimestamp,
    receivedTimestamp: r.receivedTimestamp,
    pyth: {
      feedId: r.feedId,
      symbol: r.symbol,
      confidenceUsd: r.confidenceUsd,
      bestBidUsd: r.bestBidUsd,
      bestAskUsd: r.bestAskUsd,
      exponent: r.exponent,
      publisherCount: r.publisherCount,
      marketSession: r.marketSession,
      feedUpdateTimestamp: r.feedUpdateTimestamp,
      feedUpdateTimestampUs: r.feedUpdateTimestampUs,
      providerTimestamp: r.providerTimestamp,
      ageMs: r.ageMs,
      isCarriedForward: r.isCarriedForward,
    },
  };
}

/**
 * The PreStocks mark for the curated product. Matched by EXACT contract address (the curated
 * mint) and symbol; a catalog entry that does not match exactly is never used.
 */
async function prestocksReference(
  prestocks: PrestocksClient,
  config: { symbol: string; contractAddress: string; mintAddress: string; apiUrl: string },
): Promise<PrestocksReferenceSnapshot> {
  if (config.contractAddress !== config.mintAddress) {
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE.PRESTOCKS, { cause: "prestocks_mint_mismatch" });
  }
  let catalog;
  try {
    catalog = await prestocks.fetchCatalog();
  } catch (error) {
    const reason = error instanceof PrestocksRequestError ? `prestocks_${error.reason}` : "prestocks_unexpected";
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE.PRESTOCKS, { cause: reason, retryable: true });
  }
  const product = catalog.products.find((p) => p.contractAddress === config.contractAddress);
  if (!product || product.symbol !== config.symbol) {
    throw new AppError("REFERENCE_UNAVAILABLE", UNAVAILABLE.PRESTOCKS, { cause: "prestocks_product_absent" });
  }
  return {
    provider: "PRESTOCKS",
    referenceType: "MARK_PRICE",
    priceUsd: product.markPriceUsd,
    freshness: "CURRENT_RESPONSE",
    timestampKind: "RECEIVED",
    sourceTimestamp: null,
    receivedTimestamp: catalog.receivedAt.toISOString(),
    prestocks: {
      name: product.name,
      symbol: product.symbol,
      contractAddress: product.contractAddress,
      markPriceUsd: product.markPriceUsd,
      tokenPriceUsd: product.tokenPriceUsd,
      premiumPercent: product.premiumPercent,
      productUrl: product.productUrl,
      apiUrl: config.apiUrl ?? PRESTOCKS_API_URL,
    },
  };
}
