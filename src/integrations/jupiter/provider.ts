import "server-only";
import { getServerEnv, type JupiterMode } from "../../config/env.ts";
import type { DbExecutor } from "../../db/client.ts";
import { createUnconfiguredLiveProvider } from "./live.ts";
import { createMockProvider } from "./mock.ts";
import type { ExecutionProvider } from "./types.ts";

export function getExecutionMode(): JupiterMode {
  return getServerEnv().CIRCUIT_JUPITER_MODE;
}

/**
 * The provider for the configured mode. `live` never falls back to the mock:
 * until the Jupiter adapter exists, live mode refuses every operation.
 */
export function getExecutionProvider(db: DbExecutor, mode: JupiterMode = getExecutionMode()): ExecutionProvider {
  return mode === "mock" ? createMockProvider({ db }) : createUnconfiguredLiveProvider();
}
