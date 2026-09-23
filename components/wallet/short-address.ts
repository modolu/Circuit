/** `7xKXabc…xyz9fQ2` → `7xKX…9fQ2`. Display only; always keep the full address for logic. */
export function shortAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
