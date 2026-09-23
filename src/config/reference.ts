/**
 * Reference-data configuration (CIRCUIT_ARCHITECTURE.md §10).
 *
 * PYTH_REFERENCE_CHANNEL: Pyth Pro channels must be at or above a feed's
 * `min_channel`. Equity.US.AAPL/USD (feed 922) reports `fixed_rate@50ms`;
 * `fixed_rate@200ms` is permitted, and a 200ms cadence is ample for an
 * on-demand dashboard reference.
 *
 * MAX_REFERENCE_AGE_MS: a non-carried value older than this is STALE. On the
 * 200ms channel a newly generated price is at most ~200ms old at the Pyth
 * router; 3s leaves room for the server→Pyth round trip and small clock skew
 * while still flagging a stalled feed well before its value is misleading.
 *
 * MAX_FUTURE_SKEW_MS: provider timestamps further ahead of our clock than this
 * cannot be trusted, so the reference is treated as UNAVAILABLE.
 */

export const PYTH_CHANNELS = ["real_time", "fixed_rate@50ms", "fixed_rate@200ms", "fixed_rate@1000ms"] as const;
export type PythChannel = (typeof PYTH_CHANNELS)[number];

export const DEFAULT_PYTH_BASE_URL = "https://pyth-lazer.dourolabs.app";
export const PYTH_REFERENCE_CHANNEL: PythChannel = "fixed_rate@200ms";
export const PYTH_REQUEST_TIMEOUT_MS = 5_000;

export const MAX_REFERENCE_AGE_MS = 3_000;
export const MAX_FUTURE_SKEW_MS = 1_000;
