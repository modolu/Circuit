import { PublicKey } from "@solana/web3.js";
import { percentDifference } from "../../domain/money.ts";
import { prestocksItemSchema, type PrestocksItem } from "./types.ts";

/** Normalized PreStocks product: exact decimal strings, first-party URLs, a valid Solana mint. */
export interface PrestocksProduct {
  name: string;
  symbol: string;
  contractAddress: string;
  productUrl: string;
  imageUrl: string | null;
  markPriceUsd: string;
  tokenPriceUsd: string | null;
  /** (tokenPrice − markPrice) / markPrice × 100, exact decimal maths, 2 dp half-even. Null without a token price. */
  premiumPercent: string | null;
}

function isValidMint(address: string): boolean {
  try {
    return new PublicKey(address).toBytes().length === 32;
  } catch {
    return false;
  }
}

/** Premium (+) or discount (−) of the token market price to the PreStocks mark, in percent. */
export function premiumToMarkPercent(markPriceUsd: string, tokenPriceUsd: string, scale = 2): string {
  return percentDifference(markPriceUsd, tokenPriceUsd, scale);
}

export function mapPrestocksItem(raw: unknown): PrestocksProduct | null {
  const parsed = prestocksItemSchema.safeParse(raw);
  if (!parsed.success || !isValidMint(parsed.data.contract_address)) return null;
  const item: PrestocksItem = parsed.data;
  const tokenPriceUsd = item.tokenPrice ?? null;
  return {
    name: item.name,
    symbol: item.symbol,
    contractAddress: item.contract_address,
    productUrl: item.external_url,
    imageUrl: item.image ?? null,
    markPriceUsd: item.markPrice,
    tokenPriceUsd,
    premiumPercent: tokenPriceUsd ? premiumToMarkPercent(item.markPrice, tokenPriceUsd) : null,
  };
}
