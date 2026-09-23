import type { PolicySide } from "../../domain/policy.ts";

/*
 * Trigger V2 token compatibility (docs verified 2026-09-23): Token-2022 is supported,
 * but "tokens with transfer-fee or transfer-hook extensions are rejected at deposit
 * unless whitelisted". The restriction applies to the DEPOSIT (input) mint, so BUY
 * and SELL are assessed separately. Extension names are the canonical names
 * reported by Solana's parsed mint data (spl-token-2022).
 */

export const TRIGGER_RESTRICTED_DEPOSIT_EXTENSIONS = ["transferFeeConfig", "transferHook"] as const;

export interface MintProfile {
  mint: string;
  program: "spl-token" | "spl-token-2022";
  extensions: readonly string[];
  /** For transferHook: the configured hook program, or null when none is set. */
  transferHookProgramId?: string | null;
}

export type DepositCompatibility =
  | { status: "COMPATIBLE"; notes: string[] }
  | { status: "RESTRICTED_UNLESS_WHITELISTED"; restrictedExtensions: string[]; notes: string[] };

export function assessDepositMint(input: MintProfile, { whitelisted = false }: { whitelisted?: boolean } = {}): DepositCompatibility {
  const restricted = input.extensions.filter((ext) =>
    (TRIGGER_RESTRICTED_DEPOSIT_EXTENSIONS as readonly string[]).includes(ext),
  );
  if (restricted.length === 0 || whitelisted) {
    return { status: "COMPATIBLE", notes: whitelisted && restricted.length ? ["Whitelisted by Jupiter (verified live)."] : [] };
  }
  const notes = restricted.includes("transferHook") && input.transferHookProgramId === null
    ? ["transferHook extension present with no hook program set. The docs restrict by extension, so treat it as restricted until a live deposit craft proves otherwise."]
    : [];
  return { status: "RESTRICTED_UNLESS_WHITELISTED", restrictedExtensions: restricted, notes };
}

/** The deposit mint is the policy's input: USDC for BUY, the stock token for SELL. */
export function assessPolicySide(side: PolicySide, { stock, quote }: { stock: MintProfile; quote: MintProfile }, options?: { whitelisted?: boolean }) {
  return assessDepositMint(side === "BUY" ? quote : stock, options);
}
