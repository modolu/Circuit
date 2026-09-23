import "server-only";
import { EXECUTION_PROVIDERS } from "../../domain/policy.ts";
import { ProviderError, type ExecutionProvider } from "./types.ts";

/**
 * Live mode before the Jupiter Trigger V2 adapter exists. Every operation fails
 * safely with no HTTP calls, and it NEVER falls back to the simulated provider.
 */
export function createUnconfiguredLiveProvider(): ExecutionProvider {
  const refuse = async (): Promise<never> => {
    throw new ProviderError("not_configured", true);
  };
  return {
    id: EXECUTION_PROVIDERS.LIVE,
    simulated: false,
    configured: false,
    createOrder: refuse,
    getOrder: refuse,
    cancelOrder: refuse,
  };
}
