/**
 * Minimal structured JSON logger (CIRCUIT_ARCHITECTURE.md §21).
 *
 * Every field is passed through `redact` before serialization, so secrets are
 * masked even when a caller logs a whole headers object or provider response.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export const REDACTED = "[REDACTED]";

// Keys are compared lowercase with `-` and `_` removed.
const SENSITIVE_KEY_FRAGMENTS = [
  "authorization",
  "cookie",
  "apikey",
  "secret",
  "password",
  "jwt",
  "privatekey",
  "secretkey",
  "seedphrase",
  "mnemonic",
  "encryptionkey",
  "databaseurl",
];

// Exact keys that are secret in Circuit's auth flow. `transactionSignature` stays loggable (onchain evidence).
const SENSITIVE_EXACT_KEYS = new Set([
  "signature",
  "nonce",
  "session",
  "set-cookie",
  // Jupiter Trigger payloads: signed/unsigned transactions and challenges never go to logs.
  "transaction",
  "signedtransaction",
  "depositsignedtx",
  "challenge",
]);

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_EXACT_KEYS.has(key.toLowerCase())) return true;
  if (SENSITIVE_EXACT_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""))) return true;
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  // `accessToken`, `idToken`, `token` are secrets; `tokenMint`, `tokenSymbol` are not.
  if (normalized.endsWith("token")) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

const BEARER_VALUE = /^bearer\s+\S+/i;
const JWT_VALUE = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
const CIRCUIT_SESSION_VALUE = /^v1\.[\w-]{20,}\.[\w-]{20,}$/;
const CONNECTION_STRING_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;

function isSensitiveValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    BEARER_VALUE.test(trimmed) ||
    JWT_VALUE.test(trimmed) ||
    CIRCUIT_SESSION_VALUE.test(trimmed) ||
    CONNECTION_STRING_WITH_PASSWORD.test(trimmed)
  );
}

const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return isSensitiveValue(value) ? REDACTED : value;
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redact(value.message, depth + 1, seen),
      ...("code" in value ? { code: redact(value.code, depth + 1, seen) } : {}),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return redact(Object.fromEntries(value.entries()), depth + 1, seen);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1, seen);
  }
  return output;
}

type Sink = (line: string, level: LogLevel) => void;

const consoleSink: Sink = (line, level) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export function createLogger(baseFields: LogFields = {}, sink: Sink = consoleSink) {
  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    const entry = {
      ...(redact({ ...baseFields, ...fields }) as LogFields),
      level,
      event,
      time: new Date().toISOString(),
    };
    sink(JSON.stringify(entry), level);
  };

  return {
    debug: (event: string, fields?: LogFields) => write("debug", event, fields),
    info: (event: string, fields?: LogFields) => write("info", event, fields),
    warn: (event: string, fields?: LogFields) => write("warn", event, fields),
    error: (event: string, fields?: LogFields) => write("error", event, fields),
    child: (fields: LogFields) => createLogger({ ...baseFields, ...fields }, sink),
  };
}

export type Logger = ReturnType<typeof createLogger>;

export const logger = createLogger();
