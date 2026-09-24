# Circuit

**Programmable execution for tokenized public and private stocks on Solana.**

## What it does

Circuit turns a stock decision you have already made into a bounded, autonomous execution policy:

- **Programmable execution.** Define the asset, side, budget, USD trigger, slippage ceiling and expiry once. Circuit compiles it into a Jupiter Trigger order that keeps running without your browser.
- **Public and private stocks.** Tokenized public equities (e.g. AAPLx) use an independent Pyth equity reference. Tokenized private / pre-IPO exposure (e.g. ANTHROPIC from PreStocks) uses the official PreStocks mark price.
- **Deterministic, user-defined policies.** Circuit never recommends what to buy. Relative triggers ("3% below the reference") compile to an exact USD target with exact decimal maths, and every step is recorded in an audit trail.

## Why

Tokenized stocks trade 24/7; human attention does not. A useful automation should execute *your* rule when it becomes true, with a clear record of why, instead of an alert at 2 a.m. or a bot that decides for you.

## How it works

```text
Wallet → Reference provider → Circuit compiler → Jupiter Trigger → Solana evidence
```

| Role | Provider |
|---|---|
| Public-equity reference | **Pyth**: independent underlying-equity price (e.g. `Equity.US.AAPL/USD`) |
| Private-market reference | **PreStocks**: first-party mark price, token market price and premium/discount |
| Policy, compilation, state, audit | **Circuit** |
| Execution rail | **Jupiter Trigger V2**: per-wallet vault, keeper execution |
| Authorization and evidence | **Solana**: wallet signatures, onchain deposit/fill/withdrawal transactions |

The reference and the execution market are deliberately distinct. Circuit compiles the trigger from the reference (Pyth or the PreStocks mark) and sends it to Jupiter unchanged; Jupiter monitors the **token's own** USD price. The token may trade at a premium or discount to its reference, and the review screen says so.

## Current verified assets

| Asset | Reference | Status |
|---|---|---|
| **ANTHROPIC** (PreStocks) | PreStocks mark | Live reference; exact mint, Jupiter recognition and USDC route verified; BUY policies enabled |
| **AAPLx** (xStocks) | Pyth AAPL/USD | Identity, Pyth mapping and Jupiter routing verified; waiting on a Pyth key with US-equity entitlement in this environment |

## Core safety model

- **User-directed.** No AI and no recommendations; you choose every parameter.
- **Exact money maths.** Atomic token amounts as integers, USD values as exact decimals; no floating point.
- **Explicit wallet signatures.** Every money-moving transaction is reviewed and signed in your wallet. The server verifies that the signed transaction is exactly the one it prepared.
- **No private keys.** Circuit never asks for, stores or uses one.
- **Provider truth.** A policy is ARMED, EXECUTED or CANCELLED only after Jupiter or Solana confirms it; ambiguous outcomes are reconciled, never guessed.
- **Honest evidence.** Simulated (mock-mode) activity is always labelled and never shown as onchain evidence.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript 5 (strict) · Tailwind CSS 4 · Neon PostgreSQL + Drizzle ORM · Zod 4 · decimal.js · `@solana/web3.js` + Solana wallet adapter (Wallet Standard) · Vitest + PGlite · Vercel.

## Architecture

One Next.js app: server route handlers call services, which own state transitions and call the Pyth, PreStocks and Jupiter integrations. Neon stores policies, the append-only audit trail and provider preparation state. Jupiter owns execution, so an armed order keeps running if Circuit is offline.

See [`CIRCUIT_ARCHITECTURE.md`](CIRCUIT_ARCHITECTURE.md) for the full design and [`CIRCUIT_PRODUCT_BRIEF.md`](CIRCUIT_PRODUCT_BRIEF.md) for the product.

## Local development

Requires Node 22 and pnpm 11.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local   # fill in your own values; never commit them
pnpm db:migrate              # apply migrations to your DATABASE_URL
pnpm db:seed                 # insert only curated assets whose checks pass
pnpm dev
```

`CIRCUIT_JUPITER_MODE=mock` (the default) runs a clearly labelled simulated execution provider; `live` uses Jupiter Trigger V2.

## Environment

Variable names only (see `.env.example`):

- Server secrets: `DATABASE_URL`, `CIRCUIT_SESSION_SECRET`, `JUPITER_API_KEY`, `PYTH_API_KEY`
- Server config: `CIRCUIT_JUPITER_MODE`, optional `JUPITER_TRIGGER_BASE_URL`, `PYTH_BASE_URL`
- Public: `NEXT_PUBLIC_APP_URL` (the canonical HTTPS origin in production; it appears in the sign-in message), `NEXT_PUBLIC_SOLANA_CLUSTER`

## Tests

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Opt-in live probes (never part of `pnpm test`):

```bash
pnpm test:prestocks-live   # PreStocks catalog, onchain mints, Jupiter recognition, quote-only routes
pnpm test:jupiter-live     # Jupiter key, token, quote-only route, Trigger auth challenge
pnpm test:live             # Pyth symbology and key entitlement
```

The live probes move no funds: no taker, no signing, no deposit, no order. `pnpm test:live` depends on the Pyth key's entitlements and currently reports that US-equity access is not granted.

## Demo

1. **Markets**: live PreStocks marks, token market prices and premium/discount; ANTHROPIC is supported by Circuit.
2. **New policy** with ANTHROPIC: BUY 3% below the PreStocks mark; Circuit shows the compiled USD trigger and the plain-English policy.
3. Save the **DRAFT** and open it: captured mark snapshot, compiled trigger, audit trail.
4. **Jupiter lifecycle**: connect Jupiter (off-chain sign-in) and the vault, then prepare → review → explicit deposit signature → ARMED → reconcile → cancel & withdraw.

A funded live order has not been executed yet.

## Status and limitations

- Live SELL is disabled for the current assets: their Token-2022 transfer-hook/transfer-fee settings restrict them as Jupiter Trigger deposits.
- AAPLx live execution waits for a Pyth key with US-equity entitlement in this environment.
- Jupiter Trigger V2 is in beta.
- Live funded-order proof is not completed yet.

## Integrations

PreStocks · Pyth · Jupiter · Solana. Circuit uses their public APIs and networks; this does not imply a partnership or endorsement.
