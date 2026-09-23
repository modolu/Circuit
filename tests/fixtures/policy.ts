import { parsePythJson, type PythClient } from "@/src/integrations/pyth/client";
import { pythLatestPriceResponseSchema } from "@/src/integrations/pyth/types";
import { equityResponseText, FIXTURE_UPDATE_US, receivedAfter } from "./pyth";

/**
 * A fake Pyth client for tests: deterministic payloads for feed 922 (price
 * 227.35 in the fixture), optionally STALE, CARRIED or failing. Never used by production code.
 */
export function fixturePyth(mode: "FRESH" | "STALE" | "CARRIED" | Error = "FRESH"): PythClient {
  return {
    async latestPrice() {
      if (mode instanceof Error) throw mode;
      const feedUpdateUs = mode === "CARRIED" ? FIXTURE_UPDATE_US - 3_600_000_000n : FIXTURE_UPDATE_US;
      const text = equityResponseText({ feedUpdateUs });
      return {
        response: pythLatestPriceResponseSchema.parse(parsePythJson(text)),
        receivedAt: receivedAfter(mode === "STALE" ? 60_000 : 300),
      };
    },
  };
}
