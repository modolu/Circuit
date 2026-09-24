import { z } from "zod";

/*
 * PreStocks first-party catalog (GET https://prestocks.com/api/prestocks, verified
 * 2026-09-24). Public, no API key. Each item is validated on its own: one malformed
 * product never invalidates the others. Unknown fields are ignored.
 *
 * Semantics (PreStocks product pages label these "Mark Price", "Token Price", "Premium %"):
 * - markPrice: PreStocks' benchmark value for one token of the private company.
 * - tokenPrice: the current market price of the onchain PreStocks token.
 * Neither is called an oracle, and the mark is not a redemption guarantee.
 * The response carries no per-price timestamp.
 */

export const PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";

/** Numeric fields whose JSON source digits are preserved (never round-tripped through a JS number). */
export const PRESTOCKS_DECIMAL_KEYS = new Set(["markPrice", "tokenPrice", "markValuation", "impliedValuation", "supply"]);

const decimalString = z.string().regex(/^\d+(\.\d+)?$/);
const positiveDecimal = decimalString.refine((value) => /[1-9]/.test(value), "must be positive");
const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const firstPartyUrl = z.url().refine((value) => /^https:\/\/(www\.)?prestocks\.com\//.test(value), "must be a prestocks.com URL");

export const prestocksItemSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().regex(/^[A-Z0-9]{1,20}$/),
  description: z.string().optional(),
  image: z.string().optional(),
  external_url: firstPartyUrl,
  contract_address: solanaAddress,
  markPrice: positiveDecimal,
  markValuation: decimalString.optional(),
  // Not required for a mark-referenced policy: without it only premium/discount is unavailable.
  tokenPrice: positiveDecimal.nullish(),
  impliedValuation: decimalString.nullish(),
  supply: decimalString.optional(),
});

export type PrestocksItem = z.infer<typeof prestocksItemSchema>;

export const prestocksCatalogSchema = z.array(z.unknown()).min(1);
