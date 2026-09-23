import "server-only";
import { randomBytes } from "node:crypto";
import type { DbExecutor } from "../../db/client.ts";
import {
  findMockOrderByClientRequestId,
  findMockOrderByProviderId,
  insertMockOrderIfAbsent,
  transitionMockOrder,
} from "../../db/repositories/mock-provider-orders.ts";
import type { MockProviderOrder } from "../../db/schema.ts";
import { EXECUTION_PROVIDERS } from "../../domain/policy.ts";
import { ProviderError, type ProviderOrder, type SimulatedExecutionProvider } from "./types.ts";

/*
 * SIMULATED execution provider (CIRCUIT_JUPITER_MODE=mock only). Demo
 * infrastructure: it never calls Jupiter or Solana. Its durable state lives in
 * `mock_provider_orders`, standing in for the provider's own records, so orders
 * survive reloads, browser closure and serverless restarts. Order ids are
 * `mock_<32 hex>`: never a Jupiter id, Solana signature or transaction hash.
 */

export const MOCK_ORDER_ID_PREFIX = "mock_";

function newMockOrderId(): string {
  return `${MOCK_ORDER_ID_PREFIX}${randomBytes(16).toString("hex")}`;
}

function toProviderOrder(row: MockProviderOrder): ProviderOrder {
  return {
    providerOrderId: row.providerOrderId,
    clientRequestId: row.clientRequestId,
    rawState: row.state,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    filledAt: row.filledAt,
    cancelledAt: row.cancelledAt,
  };
}

export interface MockProviderOptions {
  db: DbExecutor;
  now?: () => Date;
  /** Tests only: make the next createOrder fail with this error. */
  failCreateWith?: ProviderError;
}

export function createMockProvider({ db, now = () => new Date(), failCreateWith }: MockProviderOptions): SimulatedExecutionProvider {
  /** Like a real trigger order, an open mock order expires on its own once past expiry. */
  async function load(providerOrderId: string): Promise<MockProviderOrder | undefined> {
    const row = await findMockOrderByProviderId(db, providerOrderId);
    if (row?.state === "OPEN" && row.expiresAt.getTime() <= now().getTime()) {
      return (await transitionMockOrder(db, { providerOrderId, from: "OPEN", to: "EXPIRED", at: now() })) ??
        (await findMockOrderByProviderId(db, providerOrderId));
    }
    return row;
  }

  async function transitionFromOpen(providerOrderId: string, to: "FILLED" | "CANCELLED"): Promise<ProviderOrder> {
    const current = await load(providerOrderId);
    if (!current) throw new ProviderError("not_found", true);
    if (current.state !== "OPEN") return toProviderOrder(current);
    const moved = await transitionMockOrder(db, { providerOrderId, from: "OPEN", to, at: now() });
    const latest = moved ?? (await findMockOrderByProviderId(db, providerOrderId));
    if (!latest) throw new ProviderError("not_found", true);
    return toProviderOrder(latest);
  }

  return {
    id: EXECUTION_PROVIDERS.MOCK,
    simulated: true,
    configured: true,

    async createOrder(request) {
      if (failCreateWith) throw failCreateWith;
      const existing = await findMockOrderByClientRequestId(db, request.clientRequestId);
      if (existing) {
        if (existing.policyId !== request.policyId) throw new ProviderError("rejected", true);
        return toProviderOrder(existing);
      }
      const inserted = await insertMockOrderIfAbsent(db, {
        providerOrderId: newMockOrderId(),
        clientRequestId: request.clientRequestId,
        policyId: request.policyId,
        expiresAt: request.expiresAt,
        createdAt: now(),
      });
      const order = inserted ?? (await findMockOrderByClientRequestId(db, request.clientRequestId));
      if (!order || order.policyId !== request.policyId) throw new ProviderError("rejected", true);
      return toProviderOrder(order);
    },

    async getOrder(providerOrderId) {
      const row = await load(providerOrderId);
      return row ? toProviderOrder(row) : null;
    },

    cancelOrder: (providerOrderId) => transitionFromOpen(providerOrderId, "CANCELLED"),
    simulateFill: (providerOrderId) => transitionFromOpen(providerOrderId, "FILLED"),
  };
}
