# Colosseum No-Funds Production Evidence

> Evidence date: 2026-10-05  
> Environment: production (`https://circuit-dun.vercel.app`)  
> Rule: this file distinguishes real production evidence from tests, fixtures, simulations, and unexecuted implementation.

## 1. Evidence classification

### REAL — production evidence observed on 2026-10-05

A real signed-in user completed the production flow through Jupiter deposit preparation for an ANTHROPIC BUY policy.

Production evidence:

- Circuit wallet authentication completed.
- Jupiter authentication completed.
- Jupiter vault registration / retrieval completed.
- A fresh ANTHROPIC policy was created in production.
- The first-party PreStocks ANTHROPIC mark was captured.
- Circuit deterministically compiled the policy.
- Jupiter produced a real unsigned deposit transaction.
- Circuit persisted the deposit preparation before any wallet transaction signature.
- The preparation remains `CRAFTED`.
- No deposit transaction was signed.
- No provider order was created.
- No funds moved.

### IMPLEMENTED + TESTED — not production-funded proof

The codebase implements and tests:

- signed deposit verification;
- live order creation;
- idempotent / ambiguous-create recovery;
- provider reconciliation;
- provider fill-evidence validation;
- cancellation initiation;
- withdrawal preparation;
- withdrawal confirmation;
- terminal `CANCELLED`, `EXPIRED`, and `EXECUTED` handling.

The local baseline on 2026-10-05 passed **385/385 tests**, typecheck, lint, and the production build. This is implementation evidence, not proof that a real funded Jupiter order completed in production.

### NOT EXECUTED

The following remain unproven in funded production:

- a real submitted Jupiter deposit;
- a real Jupiter provider order ID;
- a real production `ARMED` state;
- a real production cancel/withdraw transaction;
- a real production fill.

Do not describe any of those as completed.

## 2. Real production policy

Production policy ID:

`889f5d9b-2543-402d-9d90-420a328b4afb`

Observed policy state:

- asset: `ANTHROPIC`
- reference provider: `PRESTOCKS`
- side: `BUY`
- status: `DRAFT`
- maximum input: `12.000000 USDC`
- captured PreStocks mark: `$1,062.90442184`
- compiled fixed trigger: `$531.45`
- trigger intent: 50% below the captured mark
- max slippage: 50 bps (0.50%)
- expiry: 24 hours from creation

Production audit events recorded, in order:

1. `POLICY_CREATED` — source `USER`
2. `REFERENCE_CAPTURED` — source `CIRCUIT`
3. `POLICY_COMPILED` — source `CIRCUIT`
4. `JUPITER_DEPOSIT_PREPARED` — source `JUPITER`

## 3. Real Jupiter deposit preparation

Preparation ID:

`fb164052-ff7f-480e-bf2f-d5e1a4427e8e`

Observed preparation state:

- status: `CRAFTED`
- receiver/vault: verified present and distinct from the user wallet
- input mint: canonical Solana USDC (`EPjFWdd5...TDt1v`)
- output mint: curated ANTHROPIC mint (`Pren1FvF...Lkhw`)
- input amount: `12,000,000` atomic USDC = `12.000000 USDC`
- deposit transaction signature: `NULL`
- provider order ID: `NULL`
- signed transaction: `NULL`

This proves Jupiter accepted the authenticated preparation request and returned a transaction suitable for wallet review. It does **not** prove that Jupiter accepted a submitted deposit or created an order.

## 4. Unsigned transaction verification

The persisted unsigned versioned transaction was decoded before any authorization.

Verified properties:

- user Circuit wallet is the transaction fee payer;
- transaction has no user signature;
- canonical USDC mint is present;
- exact ANTHROPIC mint is present;
- persisted receiver/vault is present;
- encoded USDC transfer amount is exactly 12 USDC;
- instruction programs are limited to expected Solana infrastructure for this preparation:
  - Compute Budget Program;
  - Associated Token Account Program;
  - System Program;
  - classic SPL Token Program;
- no unexpected custom executable program was observed in the prepared transaction.

The transaction also contains Token-2022 account preparation for the ANTHROPIC output mint, consistent with the curated token metadata.

## 5. Market-distance check

At verification time on 2026-10-05, the first-party PreStocks API reported approximately:

- ANTHROPIC mark: `$1,062.40`
- ANTHROPIC token price: `$1,065.34`

The policy trigger remained `$531.45`, roughly 50% below those values. The deliberately distant trigger was chosen to reduce immediate-fill risk if a funded proof were later authorized. It is not a guarantee against a fill.

## 6. Why funded proof stopped

The connected wallet balance check showed approximately:

- `0.000831 USDC`
- `0.00959 SOL`

The prepared transaction requires 12 USDC, so funded execution was neither feasible nor attempted.

This is a capital constraint, not an implementation failure.

## 7. Current integration status

### Jupiter

Current no-funds live checks pass for the supported path. The real deposit-craft step also succeeded in production.

### PreStocks

The live first-party catalog returned ANTHROPIC with the exact curated mint and positive mark/token prices during the proof run.

### Pyth / AAPLx

The configured Pyth key currently returns HTTP 403 `NOT_ENTITLED`, including the connectivity diagnostic. Circuit now fails closed: AAPLx is inactive and cannot be used for reference-dependent policy creation or live execution until a fresh entitlement check passes.

## 8. Submission-safe wording

Safe claim:

> Circuit has been verified in production through real wallet authentication, real reference capture, deterministic policy compilation, Jupiter authentication/vault setup, and real unsigned Jupiter deposit preparation. The full funded order lifecycle is implemented and covered by tests, but no funded Jupiter order has been submitted from production during the Colosseum build period.

Do not replace that statement with a stronger funded-execution claim unless later production evidence exists.
