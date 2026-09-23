import "server-only";
import { z } from "zod";

/**
 * The only module allowed to read `process.env` (enforced by ESLint).
 *
 * Milestone 0: every secret is optional, so the app shell and tests run without
 * credentials. Each secret becomes required in the milestone that first uses it.
 * The one cross-field rule enforced now: live Jupiter execution needs its API key.
 */

// `.env.example` ships `KEY=` lines; treat empty strings as "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const secret = z.string().min(1);

// Postgres connection string. Validation messages never echo the value.
const postgresUrl = z
  .url()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), "must be a postgres:// or postgresql:// URL");

export const JUPITER_MODES = ["mock", "live"] as const;
export type JupiterMode = (typeof JUPITER_MODES)[number];

export const SOLANA_CLUSTERS = ["mainnet-beta", "devnet", "testnet"] as const;
export type SolanaCluster = (typeof SOLANA_CLUSTERS)[number];

const serverEnvSchema = z
  .object({
    DATABASE_URL: optional(postgresUrl),
    // HMAC key for Circuit session cookies: at least 32 characters of random data.
    CIRCUIT_SESSION_SECRET: optional(z.string().min(32, "must be at least 32 characters")),
    CIRCUIT_TOKEN_ENCRYPTION_KEY: optional(secret),
    JUPITER_API_KEY: optional(secret),
    PYTH_API_KEY: optional(secret),
    CIRCUIT_JUPITER_MODE: optional(z.enum(JUPITER_MODES)).transform((mode) => mode ?? "mock"),
    JUPITER_TRIGGER_BASE_URL: optional(z.url()),
    PYTH_BASE_URL: optional(z.url()),
  })
  .superRefine((env, ctx) => {
    if (env.CIRCUIT_JUPITER_MODE === "live" && !env.JUPITER_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["JUPITER_API_KEY"],
        message: "JUPITER_API_KEY is required when CIRCUIT_JUPITER_MODE=live.",
      });
    }
  });

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SOLANA_CLUSTER: optional(z.enum(SOLANA_CLUSTERS)).transform(
    (cluster) => cluster ?? "mainnet-beta",
  ),
  NEXT_PUBLIC_APP_URL: optional(z.url()).transform((url) => url ?? "http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

type EnvSource = Record<string, string | undefined>;

/** Throws with variable names only, never values. */
function parseOrThrow<T extends z.ZodType>(schema: T, source: EnvSource, label: string): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid ${label} environment: ${problems}`);
  }
  return result.data;
}

export function parseServerEnv(source: EnvSource): ServerEnv {
  return parseOrThrow(serverEnvSchema, source, "server");
}

export function parsePublicEnv(source: EnvSource): PublicEnv {
  return parseOrThrow(publicEnvSchema, source, "public");
}

let cachedServerEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}

/** For database code only. Throws a value-free error when the URL is absent. */
export function getDatabaseUrl(): string {
  const url = getServerEnv().DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local (never commit it).");
  }
  return url;
}

/** For session signing only. Throws a value-free error when the secret is absent. */
export function getSessionSecret(): string {
  const secret = getServerEnv().CIRCUIT_SESSION_SECRET;
  if (!secret) {
    throw new Error("CIRCUIT_SESSION_SECRET is not set. Add it to .env.local (never commit it).");
  }
  return secret;
}

export function getPublicEnv(): PublicEnv {
  // Referenced by literal name so Next.js can inline them at build time.
  return parsePublicEnv({
    NEXT_PUBLIC_SOLANA_CLUSTER: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}
