import "server-only";
import { ALL_VERIFIED_ASSETS } from "../config/assets.ts";
import { PRESTOCKS_DISCOVERY } from "../config/prestocks.ts";
import type { DbExecutor } from "../db/client.ts";
import { listActiveAssets } from "../db/repositories/assets.ts";
import { PrestocksRequestError, type PrestocksClient } from "../integrations/prestocks/client.ts";
import { toPublicAsset } from "./list-assets.ts";

/*
 * The PreStocks market list for /markets: live first-party catalog prices joined with
 * Circuit's technical support state. Catalog products are DISCOVERY data; only a curated,
 * seeded asset whose exact mint matches is "SUPPORTED" (policy creation available).
 */

export type MarketSupportState = "SUPPORTED" | "ROUTE_VERIFIED" | "UNVERIFIED" | "NOT_ELIGIBLE";

export interface PrestocksMarketRow {
  name: string;
  symbol: string;
  contractAddress: string;
  productUrl: string;
  markPriceUsd: string;
  tokenPriceUsd: string | null;
  premiumPercent: string | null;
  support: { state: MarketSupportState; detail: string };
  /** The Circuit asset id when SUPPORTED. */
  assetId: string | null;
}

export type PrestocksMarkets =
  | { status: "available"; receivedAt: string; rows: PrestocksMarketRow[]; rejectedCount: number }
  | { status: "unavailable"; reason: string };

export async function listPrestocksMarkets(db: DbExecutor, { prestocks }: { prestocks: PrestocksClient }): Promise<PrestocksMarkets> {
  let catalog;
  try {
    catalog = await prestocks.fetchCatalog();
  } catch (error) {
    return { status: "unavailable", reason: error instanceof PrestocksRequestError ? error.reason : "unexpected" };
  }
  const curated = new Set(ALL_VERIFIED_ASSETS.filter((a) => a.referenceProvider === "PRESTOCKS").map((a) => a.mintAddress));
  const supported = new Map<string, string>();
  for (const row of await listActiveAssets(db)) {
    const asset = toPublicAsset(row);
    if (asset && asset.reference.provider === "PRESTOCKS" && asset.reference.configured && curated.has(row.mintAddress)) {
      supported.set(row.mintAddress, row.id);
    }
  }
  const rows = catalog.products.map((product): PrestocksMarketRow => {
    const assetId = supported.get(product.contractAddress) ?? null;
    const discovery = PRESTOCKS_DISCOVERY[product.contractAddress];
    const support: PrestocksMarketRow["support"] = assetId
      ? { state: "SUPPORTED", detail: "Circuit policy available (BUY)." }
      : discovery && discovery.symbol === product.symbol
        ? { state: discovery.status, detail: discovery.detail }
        : { state: "UNVERIFIED", detail: "Not yet checked by Circuit; not enabled." };
    return {
      name: product.name,
      symbol: product.symbol,
      contractAddress: product.contractAddress,
      productUrl: product.productUrl,
      markPriceUsd: product.markPriceUsd,
      tokenPriceUsd: product.tokenPriceUsd,
      premiumPercent: product.premiumPercent,
      support,
      assetId,
    };
  });
  return { status: "available", receivedAt: catalog.receivedAt.toISOString(), rows, rejectedCount: catalog.rejectedCount };
}
