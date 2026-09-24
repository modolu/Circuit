import "server-only";
import { AppError, isAppError } from "../../domain/errors.ts";
import { JupiterRequestError } from "../../integrations/jupiter/client.ts";

/** Stable Circuit errors for Jupiter failures. The cause carries the provider reason for logs only. */
export function toJupiterAppError(error: unknown, context: "auth" | "vault" | "deposit" | "order" | "history" | "cancel"): AppError {
  if (isAppError(error)) return error;
  if (!(error instanceof JupiterRequestError)) {
    return new AppError("PROVIDER_UNAVAILABLE", "Jupiter could not be reached. Try again.", { cause: "jupiter_unexpected", retryable: true });
  }
  const cause = `jupiter_${error.reason}`;
  switch (error.reason) {
    case "unauthorized":
      return context === "auth"
        ? new AppError("PROVIDER_AUTH_REQUIRED", "Jupiter could not verify the signature. Request a new Jupiter challenge.", { cause })
        : new AppError("PROVIDER_AUTH_REQUIRED", "Your Jupiter session has expired. Reconnect Jupiter.", { cause });
    case "gateway_forbidden":
      return new AppError("PROVIDER_UNAVAILABLE", "This deployment's Jupiter API access does not allow that request.", { cause });
    case "forbidden":
      if (context === "cancel" || context === "history") {
        return new AppError("PROVIDER_REJECTED", "Jupiter says this order belongs to a different wallet.", { cause });
      }
      return context === "deposit" || context === "order"
        ? new AppError("PROVIDER_REJECTED", "Jupiter refused the deposit: the wallet must match your Jupiter session and have a vault.", { cause })
        : new AppError("PROVIDER_REJECTED", "Jupiter refused the request for this wallet.", { cause });
    case "bad_request":
      if (context === "cancel") {
        return new AppError(
          "CANCELLATION_FAILED",
          error.providerMessage ? `Jupiter could not process the cancellation: ${error.providerMessage}` : "Jupiter could not process the cancellation yet. Try again shortly.",
          { cause, retryable: true },
        );
      }
      return new AppError("PROVIDER_REJECTED", error.providerMessage ? `Jupiter rejected the request: ${error.providerMessage}` : "Jupiter rejected the request.", { cause });
    case "not_found":
      return context === "cancel" || context === "history"
        ? new AppError("ORDER_NOT_FOUND", "Jupiter has no record of this order for your wallet.", { cause })
        : new AppError("PROVIDER_REJECTED", "Jupiter could not find the requested resource.", { cause });
    default:
      return new AppError("PROVIDER_UNAVAILABLE", "Jupiter is unavailable right now. Try again.", { cause, retryable: true });
  }
}

export function requireLiveMode(mode: "mock" | "live"): void {
  if (mode !== "live") {
    throw new AppError("PROVIDER_UNAVAILABLE", "Live Jupiter is disabled: Circuit is running in simulated (mock) mode.", { cause: "mock_mode" });
  }
}

export function requireJupiterJwt(jwt: string | null): string {
  if (!jwt) throw new AppError("PROVIDER_AUTH_REQUIRED", "Connect Jupiter first.", { cause: "jupiter_no_session" });
  return jwt;
}
