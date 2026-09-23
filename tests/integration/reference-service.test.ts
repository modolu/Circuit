import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertAsset } from "@/src/db/repositories/assets";
import { AppError } from "@/src/domain/errors";
import { PythRequestError, type PythClient } from "@/src/integrations/pyth/client";
import { pythLatestPriceResponseSchema } from "@/src/integrations/pyth/types";
import { parsePythJson } from "@/src/integrations/pyth/client";
import { getAssetReference } from "@/src/services/get-reference";
import { listPublicAssets } from "@/src/services/list-assets";
import { fakeCatalogAsset } from "../fixtures/catalog";
import { equityResponseText, receivedAfter } from "../fixtures/pyth";
import { createTestDb } from "./test-db";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
const db = () => testDb.db;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.close();
});

function fakePyth(behaviour: "ok" | PythRequestError | "feed_absent" = "ok") {
  const requests: Array<{ feedIds: number[]; channel: string }> = [];
  const client: PythClient = {
    async latestPrice(request) {
      requests.push(request);
      if (behaviour instanceof PythRequestError) throw behaviour;
      const text = equityResponseText({ feedId: behaviour === "feed_absent" ? 1 : 922 });
      return { response: pythLatestPriceResponseSchema.parse(parsePythJson(text)), receivedAt: receivedAfter(300) };
    },
  };
  return { client, requests };
}

async function appError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected failure");
}

describe("getAssetReference", () => {
  it("fetches exactly the stored feed and channel for the asset", async () => {
    const asset = await upsertAsset(db(), fakeCatalogAsset());
    const pyth = fakePyth();
    const result = await getAssetReference(db(), asset.id, { pyth: pyth.client });

    expect(pyth.requests).toEqual([{ feedIds: [922], channel: "fixed_rate@200ms" }]);
    expect(result.reference).toMatchObject({ feedId: 922, symbol: "Equity.US.AAPL/USD", priceUsd: "227.35", freshness: "FRESH" });
    expect(result.asset.execution).toEqual({ enabled: false, status: "PENDING_JUPITER_VERIFICATION" });
  });

  it("rejects unknown and disabled assets before calling Pyth", async () => {
    const pyth = fakePyth();
    expect((await appError(getAssetReference(db(), "00000000-0000-4000-8000-000000000000", { pyth: pyth.client }))).code).toBe("NOT_FOUND");
    const disabled = await upsertAsset(db(), fakeCatalogAsset({ active: false }));
    expect((await appError(getAssetReference(db(), disabled.id, { pyth: pyth.client }))).code).toBe("ASSET_DISABLED");
    expect(pyth.requests).toEqual([]);
  });

  it("turns provider failures into REFERENCE_UNAVAILABLE with a safe message", async () => {
    const asset = await upsertAsset(db(), fakeCatalogAsset());
    for (const [behaviour, cause] of [
      [new PythRequestError("not_entitled", 403), "pyth_not_entitled"],
      [new PythRequestError("timeout"), "pyth_timeout"],
      [new PythRequestError("malformed_response", 200), "pyth_malformed_response"],
      ["feed_absent", "reference_feed_absent"],
    ] as const) {
      const error = await appError(getAssetReference(db(), asset.id, { pyth: fakePyth(behaviour).client }));
      expect(error.code).toBe("REFERENCE_UNAVAILABLE");
      expect(error.cause).toBe(cause);
      expect(error.message).toBe("The Pyth reference for this asset is unavailable right now.");
    }
  });

  it("refuses an asset whose stored feed id disagrees with its metadata", async () => {
    const asset = await upsertAsset(db(), fakeCatalogAsset({ pythFeedId: "1" }));
    const pyth = fakePyth();
    expect((await appError(getAssetReference(db(), asset.id, { pyth: pyth.client }))).code).toBe("REFERENCE_UNAVAILABLE");
    expect(pyth.requests).toEqual([]);
  });
});

describe("listPublicAssets", () => {
  it("returns only public fields for active assets", async () => {
    const assets = await listPublicAssets(db());
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(Object.keys(asset).sort()).toEqual(
        ["decimals", "displayName", "execution", "id", "issuer", "mintAddress", "reference", "symbol", "underlyingSymbol"].sort(),
      );
      expect(JSON.stringify(asset)).not.toContain("must never reach API responses");
    }
  });
});
