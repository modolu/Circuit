import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { VERIFIED_ASSETS, verifiedAssetSchema } from "@/src/config/assets";
import { parseServerEnv } from "@/src/config/env";
import { executions, policies, policyEventSource, policyStatus } from "@/src/db/schema";
import { POLICY_EVENT_SOURCES, POLICY_STATUSES } from "@/src/domain/policy";

describe("schema matches CIRCUIT_ARCHITECTURE.md", () => {
  it("defines exactly the architecture's policy statuses and event sources", () => {
    expect(POLICY_STATUSES).toEqual(["DRAFT", "ARMING", "ARMED", "EXECUTED", "CANCELLED", "EXPIRED", "FAILED"]);
    expect(POLICY_EVENT_SOURCES).toEqual(["USER", "CIRCUIT", "JUPITER", "SOLANA", "SYSTEM"]);
    expect(policyStatus.enumValues).toEqual(POLICY_STATUSES);
    expect(policyEventSource.enumValues).toEqual(POLICY_EVENT_SOURCES);
  });

  it("stores token quantities as numeric(78,0) mapped to bigint, never number", () => {
    for (const column of [policies.amountAtomic, executions.inputAmountAtomic, executions.outputAmountAtomic]) {
      expect(column.getSQLType()).toBe("numeric(78, 0)");
      expect(column.dataType).toBe("bigint");
    }
    const atomic = policies.amountAtomic.mapFromDriverValue("123456789012345678901234567890");
    expect(atomic).toBe(123456789012345678901234567890n);
  });

  it("keeps USD values as exact decimal strings", () => {
    for (const column of [policies.compiledTriggerUsd, policies.pythReferenceUsd, executions.effectivePriceUsd]) {
      expect(column.getSQLType()).toBe("numeric");
      expect(column.dataType).toBe("string");
    }
  });

  it("declares the architecture's policy indexes", () => {
    const names = getTableConfig(policies).indexes.map((index) => index.config.name);
    expect(names).toEqual(
      expect.arrayContaining(["policies_wallet_created_idx", "policies_status_expires_idx", "policies_provider_order_id_key"]),
    );
  });
});

describe("database configuration", () => {
  it("accepts only postgres URLs and never echoes the value", () => {
    const bad = "https://user:hunter2@example.invalid/db";
    expect(() => parseServerEnv({ DATABASE_URL: bad })).toThrow(/DATABASE_URL/);
    try {
      parseServerEnv({ DATABASE_URL: bad });
    } catch (error) {
      expect(String(error)).not.toContain("hunter2");
    }
  });
});

describe("verified asset catalog", () => {
  it("ships empty until assets are verified", () => {
    expect(VERIFIED_ASSETS).toEqual([]);
  });

  it("rejects fictional or malformed mints", () => {
    const result = verifiedAssetSchema.safeParse({
      symbol: "TEST_ASSET",
      displayName: "Test",
      issuer: "Test",
      underlyingSymbol: "TEST",
      mintAddress: "TEST_MINT_NOT_REAL",
      decimals: 8,
      pythFeedId: "x",
      inputEnabled: true,
      outputEnabled: true,
      active: false,
      verification: {
        issuerSource: "https://example.invalid",
        mintSource: "https://example.invalid",
        pythFeedSource: "https://example.invalid",
        jupiterTriggerSource: "https://example.invalid",
        verifiedAt: "2026-01-01",
      },
    });
    expect(result.success).toBe(false);
  });
});
