import { describe, expect, it } from "vitest";
import {
  authChallengeResponseSchema,
  cancelInitiateResponseSchema,
  confirmCancelResponseSchema,
  createOrderResponseSchema,
  depositCraftResponseSchema,
  orderHistoryResponseSchema,
  swapQuoteResponseSchema,
  tokenInfoSchema,
} from "@/src/integrations/jupiter/schemas";
import * as f from "../fixtures/jupiter";

describe("Jupiter DTO schemas", () => {
  it("accept the captured and documented shapes", () => {
    expect(authChallengeResponseSchema.parse(f.messageChallengeFixture).type).toBe("message");
    expect(authChallengeResponseSchema.parse(f.transactionChallengeFixture).type).toBe("transaction");
    expect(depositCraftResponseSchema.parse(f.depositCraftFixture).requestId).toBe(f.depositCraftFixture.requestId);
    expect(createOrderResponseSchema.parse(f.createOrderFixture).depositConfirmed).toBe(true);
    const history = orderHistoryResponseSchema.parse(f.historyFixture);
    expect(history.orders[0]!.events.map((e) => e.type)).toEqual(["deposit", "fill"]);
    expect(cancelInitiateResponseSchema.parse(f.cancelInitiateFixture).requestId).toBe("cancel-request-uuid");
    expect(confirmCancelResponseSchema.parse(f.confirmCancelFixture).txSignature).toBe("PLACEHOLDER_WITHDRAW_SIG");
  });

  it("ignore unknown fields in token and quote payloads", () => {
    const token = tokenInfoSchema.parse(f.tokenSearchFixture[0]);
    expect(token).toMatchObject({ id: f.AAPLX_MINT, decimals: 8, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" });
    expect("stats24h" in token).toBe(false);
    const quote = swapQuoteResponseSchema.parse(f.swapQuoteFixture);
    expect(quote).toMatchObject({ inAmount: "10500000", outAmount: "3098940", transaction: null });
    expect("unknownNewField" in quote).toBe(false);
  });

  it("reject malformed external payloads", () => {
    expect(authChallengeResponseSchema.safeParse({ type: "message" }).success).toBe(false);
    expect(authChallengeResponseSchema.safeParse({ type: "email", challenge: "x" }).success).toBe(false);
    expect(depositCraftResponseSchema.safeParse({ ...f.depositCraftFixture, amount: 10.5 }).success).toBe(false);
    expect(createOrderResponseSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(orderHistoryResponseSchema.safeParse({ orders: "nope" }).success).toBe(false);
    expect(tokenInfoSchema.safeParse({ ...f.tokenSearchFixture[0], decimals: "8" }).success).toBe(false);
  });
});
