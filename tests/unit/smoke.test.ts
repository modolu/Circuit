import { describe, expect, it } from "vitest";
import { parsePublicEnv, parseServerEnv } from "@/src/config/env";
import { AppError, ERROR_CODES, toAppError } from "@/src/domain/errors";
import { REDACTED, createLogger } from "@/src/observability/logger";

describe("AppError", () => {
  it("maps every stable error code to an HTTP status", () => {
    for (const code of ERROR_CODES) {
      expect(new AppError(code, "x").httpStatus).toBeGreaterThanOrEqual(400);
    }
  });

  it("never exposes an unknown error's message or cause in its client body", () => {
    const error = toAppError(new Error("connection to db-host:5432 refused"));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(error)).not.toContain("db-host");
  });
});

describe("environment", () => {
  it("boots with no secrets, defaulting to mock execution", () => {
    const env = parseServerEnv({ DATABASE_URL: "", JUPITER_API_KEY: "" });
    expect(env.CIRCUIT_JUPITER_MODE).toBe("mock");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(parsePublicEnv({}).NEXT_PUBLIC_SOLANA_CLUSTER).toBe("mainnet-beta");
  });

  it("refuses live Jupiter mode without an API key, without echoing values", () => {
    expect(() => parseServerEnv({ CIRCUIT_JUPITER_MODE: "live" })).toThrow(/JUPITER_API_KEY/);
    expect(() => parseServerEnv({ CIRCUIT_JUPITER_MODE: "production" })).toThrow(
      /CIRCUIT_JUPITER_MODE/,
    );
  });
});

describe("logger", () => {
  it("redacts secrets by key and by value shape, keeping safe fields", () => {
    const lines: string[] = [];
    const log = createLogger({}, (line) => lines.push(line));

    log.info("jupiter.request", {
      wallet: "wallet-address",
      tokenMint: "mint-address",
      headers: { Authorization: "Bearer abc", "x-api-key": "k", cookie: "circuit_session=s" },
      jupiterJwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
      nested: { upstream: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig" },
      CIRCUIT_SESSION_SECRET: "s",
      CIRCUIT_TOKEN_ENCRYPTION_KEY: "k",
    });

    const entry = JSON.parse(lines[0] ?? "{}");
    expect(entry.event).toBe("jupiter.request");
    expect(entry.wallet).toBe("wallet-address");
    expect(entry.tokenMint).toBe("mint-address");
    expect(entry.headers).toEqual({ Authorization: REDACTED, "x-api-key": REDACTED, cookie: REDACTED });
    expect(entry.jupiterJwt).toBe(REDACTED);
    expect(entry.nested.upstream).toBe(REDACTED);
    expect(entry.CIRCUIT_SESSION_SECRET).toBe(REDACTED);
    expect(entry.CIRCUIT_TOKEN_ENCRYPTION_KEY).toBe(REDACTED);
  });
});
