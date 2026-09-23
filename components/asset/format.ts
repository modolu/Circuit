/** Formats an exact decimal string as USD without float conversion: "227.35" → "$227.35". */
export function formatUsd(decimal: string): string {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? decimal.slice(1) : decimal).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = fraction.padEnd(2, "0");
  return `${negative ? "-" : ""}$${grouped}.${cents}`;
}

/** Display-only relative age ("0.8s ago", "3m ago", "2d ago"). */
export function formatAge(ageMs: number): string {
  if (ageMs < 10_000) return `${(ageMs / 1000).toFixed(1)}s ago`;
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 120) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

const SESSION_LABELS: Record<string, string> = {
  regular: "Regular session",
  preMarket: "Pre-market",
  postMarket: "Post-market",
  overNight: "Overnight",
  closed: "Market closed",
};

export function formatSession(session: string | null): string {
  return session ? (SESSION_LABELS[session] ?? session) : "Session not reported";
}
