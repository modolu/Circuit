import { z } from "zod";
import {
  EXPIRY_HOURS_OPTIONS,
  POLICY_SIDES,
  SLIPPAGE_BPS_OPTIONS,
  SOURCE_EXPRESSION_TYPES,
  TRIGGER_DIRECTIONS,
} from "../domain/policy.ts";

const decimalText = z
  .string()
  .trim()
  .max(40)
  .regex(/^\d+(\.\d+)?$/, "must be a plain positive number");

/**
 * POST /api/policies body. The browser sends only the asset id and the user's
 * choices: mints, decimals, feeds and reference prices are all resolved on
 * the server. Unknown keys (e.g. `mint`, `feedId`, `referencePrice`) are rejected.
 */
export const createPolicyRequestSchema = z
  .object({
    assetId: z.uuid(),
    side: z.enum(POLICY_SIDES),
    triggerDirection: z.enum(TRIGGER_DIRECTIONS),
    expressionType: z.enum(SOURCE_EXPRESSION_TYPES),
    expressionValue: decimalText,
    amount: decimalText,
    maxSlippageBps: z.literal(SLIPPAGE_BPS_OPTIONS),
    expiryHours: z.literal(EXPIRY_HOURS_OPTIONS),
  })
  .strict();

export type CreatePolicyRequest = z.infer<typeof createPolicyRequestSchema>;
