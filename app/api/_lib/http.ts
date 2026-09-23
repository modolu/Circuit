import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError, toAppError } from "@/src/domain/errors";
import type { Logger } from "@/src/observability/logger";

/*
 * Shared HTTP mapping for route handlers (CIRCUIT_ARCHITECTURE.md §16):
 * success `{ data, requestId }`, error `{ error: { code, message, retryable }, requestId }`.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export function newRequestId(): string {
  return `req_${randomUUID().replaceAll("-", "")}`;
}

export function jsonOk<T>(data: T, requestId: string, status = 200): NextResponse {
  return NextResponse.json({ data, requestId }, { status, headers: NO_STORE });
}

export function jsonError(error: unknown, requestId: string, log: Logger, event: string): NextResponse {
  const appError = toAppError(error);
  const cause = appError.cause;
  const fields = {
    requestId,
    code: appError.code,
    // Internal reasons are short codes; unexpected errors are logged by name/message (redacted).
    reason: typeof cause === "string" ? cause : undefined,
    error: cause instanceof Error ? cause : undefined,
  };
  if (appError.code === "INTERNAL_ERROR") log.error(event, fields);
  else log.warn(event, fields);
  return NextResponse.json({ error: appError.toJSON(), requestId }, { status: appError.httpStatus, headers: NO_STORE });
}

/**
 * Parses a JSON body against `schema`. Requiring `application/json` also means
 * cross-site HTML forms cannot reach these endpoints without a CORS preflight.
 */
export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_ERROR", "Send the request body as application/json.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "The request body is not valid JSON.");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "body"))];
    throw new AppError("VALIDATION_ERROR", `Invalid request: check ${fields.join(", ")}.`);
  }
  return result.data;
}
