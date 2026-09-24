import { shortAddress } from "@/components/wallet/short-address";

/** A base58 Solana transaction signature (64 bytes → 86–88 chars). Mock ids and provider UUIDs never match. */
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

export function isRealSignature(value: string | null | undefined): value is string {
  return typeof value === "string" && SIGNATURE.test(value);
}

/** Explorer link for a genuine onchain signature only. Anything else renders nothing. */
export function SolscanLink({ signature, label }: { signature: string | null | undefined; label?: string }) {
  if (!isRealSignature(signature)) return null;
  return (
    <a
      href={`https://solscan.io/tx/${signature}`}
      target="_blank"
      rel="noreferrer noopener"
      className="font-mono text-xs text-accent underline-offset-2 hover:underline"
      title={signature}
    >
      {label ?? shortAddress(signature)} ↗
    </a>
  );
}
