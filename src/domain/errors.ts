/**
 * Stable error codes from CIRCUIT_ARCHITECTURE.md §16.
 * Adding a code requires updating the architecture document.
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "ASSET_DISABLED",
  "REFERENCE_UNAVAILABLE",
  "REFERENCE_STALE",
  "PROVIDER_AUTH_REQUIRED",
  "PROVIDER_REJECTED",
  "PROVIDER_UNAVAILABLE",
  "POLICY_STATE_CONFLICT",
  "POLICY_EXPIRED",
  "ORDER_NOT_FOUND",
  "CANCELLATION_FAILED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  ASSET_DISABLED: 409,
  REFERENCE_UNAVAILABLE: 503,
  REFERENCE_STALE: 409,
  PROVIDER_AUTH_REQUIRED: 409,
  PROVIDER_REJECTED: 422,
  PROVIDER_UNAVAILABLE: 503,
  POLICY_STATE_CONFLICT: 409,
  POLICY_EXPIRED: 409,
  ORDER_NOT_FOUND: 404,
  CANCELLATION_FAILED: 502,
  INTERNAL_ERROR: 500,
};

const RETRYABLE_BY_DEFAULT: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "REFERENCE_UNAVAILABLE",
  "REFERENCE_STALE",
  "PROVIDER_UNAVAILABLE",
  "CANCELLATION_FAILED",
]);

export interface AppErrorOptions {
  retryable?: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  override readonly name = "AppError";
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(code);
  }

  get httpStatus(): number {
    return HTTP_STATUS_BY_CODE[this.code];
  }

  /** The client-safe error body. Never includes `cause` or stack. */
  toJSON(): { code: ErrorCode; message: string; retryable: boolean } {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Normalizes any thrown value. Unknown errors never leak their message to clients. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  return new AppError("INTERNAL_ERROR", "Something went wrong on our side. Try again shortly.", {
    cause: value,
  });
}
