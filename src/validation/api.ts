import { z } from "zod";
import { isValidWalletAddress } from "../auth/verify-wallet.ts";

export const walletAddressSchema = z
  .string()
  .trim()
  .min(32)
  .max(44)
  .refine(isValidWalletAddress, "must be a valid Solana wallet address");

export const authNonceRequestSchema = z.object({ walletAddress: walletAddressSchema }).strict();

export const authVerifyRequestSchema = z
  .object({
    walletAddress: walletAddressSchema,
    nonce: z.string().regex(/^[0-9a-f]{64}$/, "must be a Circuit login nonce"),
    // 64-byte Ed25519 signature, base64 encoded (88 characters).
    signature: z.string().min(80).max(96),
  })
  .strict();
