# Colosseum Live Proof Runbook

> Status: PREPARED, NOT AUTHORIZED FOR FUNDED EXECUTION  
> Verified: 2026-10-05  
> Candidate: ANTHROPIC (PreStocks) BUY  
> Hard stop: do not click/sign **Authorize deposit & arm** without explicit user approval.

## Goal

Produce one minimal real Jupiter Trigger lifecycle that proves Circuit can move from a real DRAFT to provider-confirmed state and reconcile evidence, while minimizing the chance of an unintended fill.

## Why ANTHROPIC

AAPLx is currently blocked because the configured Pyth key returns HTTP 403 `NOT_ENTITLED`. ANTHROPIC's current no-funds checks pass for its first-party PreStocks reference, Solana mint, Jupiter recognition and USDC route. BUY deposits USDC; SELL remains restricted.

## Safe no-funds stage — allowed before funded approval

1. Open `https://circuit-dun.vercel.app`.
2. Connect the intended Solana wallet and sign in to Circuit. Circuit login is an off-chain message signature.
3. Open **Markets** → **ANTHROPIC** → **Create policy**.
4. Create a fresh DRAFT using:
   - policy: BUY BELOW
   - budget: **12 USDC**
   - trigger mode: **% from PreStocks mark**
   - trigger: **50% below mark**
   - max slippage: **0.50% / 50 bps**
   - expiry: **24 hours**
5. Open Dashboard and connect Jupiter. This is an off-chain Jupiter auth message signature; it does not move funds.
6. Register/get the Jupiter vault. The current Circuit route explicitly treats this as a no-funds action.
7. Return to the fresh policy.
8. Click **Prepare Jupiter deposit**.
   - This calls Jupiter deposit craft.
   - It returns an unsigned transaction for review.
   - Circuit persists the preparation before returning it.
   - Preparing does **not** ask the wallet to sign and does **not** move funds.
9. Record the preparation result, vault address, policy review, and any provider error.
10. STOP.

## Funded stage — requires explicit approval

The first money-moving step is the button:

**Authorize deposit & arm**

That action re-fetches a fresh deposit transaction, asks the wallet to sign it, then submits the signed deposit to Jupiter to create the order.

Do not perform this step unless the user explicitly approves the funded proof in the current conversation.

## Minimum capital estimate

Circuit/Jupiter enforces a **$10 minimum order value**. Use a **12 USDC** budget to leave margin above that threshold.

Before funded execution, confirm the wallet has:

- at least **12 USDC** available for the test;
- a small SOL balance for transaction/network fees.

Recommended operational cushion: **0.01 SOL**, not because Circuit expects to spend all of it, but to avoid a proof failing for ordinary transaction/priority/rent-related costs. The exact fee must be reviewed from the prepared transaction/provider response before approval.

## Why 50% below

The product permits a relative trigger below 100%. A trigger 50% below the current PreStocks mark is intentionally far from the current market so the funded order is unlikely to fill during the proof window. The preferred terminal proof is **ARMED → cancel → withdraw**, not a fill.

This reduces market risk but does not guarantee the order cannot fill. Check the actual compiled trigger and current token market price immediately before funded approval.

## Evidence to capture if funded proof is approved

- Circuit policy ID
- captured PreStocks mark
- compiled fixed USD trigger
- Jupiter vault address
- deposit preparation ID
- deposit transaction signature
- Jupiter provider order ID
- provider-confirmed `ARMED` state
- proof that a browser refresh/closure does not destroy the order
- cancel preparation/cancel request ID
- withdrawal transaction signature
- final Circuit `CANCELLED` state
- policy event audit trail
- relevant Solscan links

## Abort conditions

Do not proceed with funded execution if any of these is true:

- ANTHROPIC reference is unavailable or malformed;
- exact mint no longer matches the curated asset;
- Jupiter token recognition/route check regresses;
- compiled trigger is already met or unexpectedly close to market;
- deposit receiver is not the authenticated wallet's Jupiter vault;
- transaction fee payer is not the authenticated wallet;
- requested deposit exceeds 12 USDC;
- transaction contains unexpected instructions or mints;
- Jupiter/Circuit auth wallets do not match;
- the wallet does not have a comfortable SOL fee cushion;
- Circuit cannot clearly distinguish preparation from submission;
- any provider result is ambiguous before signing.

## Current proof boundary

As of 2026-10-05, production has not recorded a real Jupiter provider order, deposit preparation, ARMED policy or execution. Passing fixtures/tests are not production proof.
