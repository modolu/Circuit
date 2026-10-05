# CIRCUIT_COLOSSEUM_PLAN.md

> **Audience:** AI coding agents first; human maintainer second.  
> **Status:** Current execution plan for Colosseum Crypto World's Fair 2026.  
> **Verified:** 2026-10-05.  
> **Deadline:** 2026-10-12.  
> **Rule:** This file sets current competition priorities. It does not replace `CIRCUIT_PRODUCT_BRIEF.md` or `CIRCUIT_ARCHITECTURE.md`.

## 1. Objective

Take the existing Stocklana-quality Circuit product and turn it into an accelerator-quality Colosseum submission without breaking the original product, architecture, or submission history.

Circuit remains:

> **Circuit is the policy layer for onchain capital markets.**

Current product wedge:

> **Tokenized stocks on Solana.**

Current product promise:

> The user decides. Circuit executes a bounded, deterministic rule and preserves the evidence.

The broader company thesis is positioning, not permission to build every future capability now.

## 2. Competition facts

Current official Colosseum information checked 2026-10-05:

- Crypto World's Fair runs 2026-09-14 through 2026-10-12.
- Submission is treated as a startup / accelerator application, not only a coding demo.
- Required submission materials include product name/description, chain/tools, founder/team context, location, logo/graphic, GitHub repository, 2–3 minute presentation video, separate product demo no longer than 3 minutes, go-to-market strategy, demand validation, and distribution plan.
- Private GitHub repositories are allowed only if `hackathon@colosseum.com` is granted review access.
- Pre-existing development/code is allowed, but relevant prior work must be disclosed. Only competition-period work is judged.
- Circuit is also targeting the Superteam Nigeria side track. The current Superteam listing shows a $5,000 USDG Nigeria track. Do not invent local participation requirements that are not present in the current listing.

## 3. Stocklana preservation

The exact platform-submitted Stocklana SHA could not be independently proven from repository files or available submission receipts.

The final repository state before the Stocklana deadline is verified as:

`0e0ddc60143dc75fe00c34d5cbfa7339a668ff99`

Preserved immutable references:

- tag: `stocklana-final-predeadline-2026`
- branch: `archive/stocklana-final-predeadline`

Both point to `0e0ddc60143dc75fe00c34d5cbfa7339a668ff99` and were pushed to origin on 2026-10-05.

Do not rewrite or modify that archive branch. Do not call it the exact submitted SHA unless new platform evidence proves that claim.

## 4. Frozen decisions

Preserve unless verified implementation evidence forces a change:

- Solana
- deterministic policy compiler
- user-defined investment decisions
- bounded authority
- wallet-based identity
- no private-key custody
- Pyth for public-equity reference data
- PreStocks reference support already implemented
- Jupiter Trigger V2 execution rail
- provider reconciliation
- audit/evidence model
- exact-unit arithmetic
- existing policy lifecycle
- external provider/Solana truth before Circuit state claims

Do not introduce during the Colosseum sprint:

- AI stock picking or LLM trading decisions
- new chains
- custom Solana program
- custom keeper network
- arbitrary token support
- unnecessary microservices or queues
- random sponsor integrations
- DCA/OCO/portfolio features before core proof and submission work are secure

## 5. Current verified production state

### REAL

- production app at `https://circuit-dun.vercel.app`
- Neon persistence
- wallet connection and signed Circuit login
- AAPLx identity/mint verification
- PreStocks live catalog/reference path
- deterministic policy compiler
- policy DRAFT persistence
- append-only policy audit events
- Jupiter API-key access
- Jupiter exact-mint recognition for AAPLx
- quote-only USDC → AAPLx route
- Jupiter Trigger auth-challenge permission
- current PreStocks ANTHROPIC no-funds compatibility checks

### CURRENTLY BLOCKED

**AAPLx / Pyth**

- `pnpm test:live` on 2026-10-05 returned HTTP 403 `NOT_ENTITLED` for both the BTC connectivity diagnostic and `Equity.US.AAPL/USD` feed 922.
- The same configured key temporarily passed the equity check on 2026-09-24 after Pyth granted All Access.
- AAPLx is now fail-closed in the curated config and production DB while entitlement is unavailable.
- Production AAPLx row: inactive; `pythLiveCheck = NOT_ENTITLED`.
- Do not claim AAPLx has a currently live Pyth reference until a new live probe passes.

### LIVE-PROBED, NO FUNDS

`pnpm test:jupiter-live` on 2026-10-05:

- API key: PASS
- AAPLx exact mint: PASS
- USDC → AAPLx quote-only route: PASS
- Trigger endpoint permission: PASS
- BUY deposit compatibility: COMPATIBLE by mint/rule checks
- SELL: RESTRICTED_UNLESS_WHITELISTED
- Trigger JWT: NOT TESTED in this probe
- vault: NOT TESTED in this probe
- deposit craft: NOT TESTED
- funded live order: NOT TESTED

`pnpm test:prestocks-live` on 2026-10-05:

- ANTHROPIC first-party catalog/mint: PASS
- Solana mint: PASS
- Jupiter recognition: PASS
- USDC → ANTHROPIC quote-only route: PASS
- BUY compatibility: PASS by rule checks
- SELL: restricted unless whitelisted
- funded live order: NOT TESTED

### IMPLEMENTED BUT NOT PRODUCTION-VERIFIED

- wallet-signed Jupiter JWT flow end to end against the current production session
- live vault registration/use in the current proof run
- live deposit craft
- wallet-signed deposit submission
- real Jupiter Trigger order creation
- provider-confirmed real `ARMED`
- browser-independent real order survival
- real live reconciliation
- real cancel/withdraw flow
- real execution/fill
- real Solana fill evidence

### FIXTURE / TEST VERIFIED

The live lifecycle implementation is covered in tests for:

- prepare
- arm
- idempotent create
- ambiguous create recovery
- reconciliation
- partial/unknown provider states
- cancellation
- withdrawal confirmation
- fill evidence requirements
- race handling

This is implementation evidence, not proof that production has completed a funded lifecycle.

## 6. Production evidence baseline

Production DB audit on 2026-10-05 found:

- 1 wallet
- 5 BUY policies
- 5 DRAFT
- 4 ANTHROPIC
- 1 historical AAPLx draft
- 0 provider-backed orders
- 0 ARMING
- 0 ARMED
- 0 EXECUTED
- 0 execution rows
- 0 mock-provider orders
- 0 Jupiter deposit preparations
- 0 Jupiter cancel preparations

Therefore the currently proven production path is:

`wallet → reference → compiler → DRAFT → audit trail`

Do not present the Jupiter money-moving lifecycle as production-proven until real evidence exists.

## 7. Build baseline

Verified 2026-10-05 using Node 22.23.2 and pnpm 11.5.1:

- typecheck: PASS
- lint: PASS
- full test suite with one worker: 40 files / 385 tests PASS
- production build: PASS
- `git diff --check`: PASS

The machine can time out PGlite-heavy integration tests under full parallelism. For reliable local verification use:

`pnpm exec vitest run --maxWorkers=1`

Do not hide real assertion failures behind this setting. The one-worker rule addresses local resource contention only.

## 8. Immediate blockers

Priority order:

1. Restore/replace Pyth entitlement if AAPLx must be shown live in the Colosseum demo.
2. Prove the current Jupiter auth → vault → deposit-craft path as far as possible without spending money.
3. Prepare one tiny funded live-order runbook, then STOP for explicit user approval before any funding, deposit, signing, or real order execution.
4. Run external user validation: 5–10 conversations and 2–5 product attempts.
5. Convert the Stocklana-facing presentation into a Colosseum company story without changing the core product.
6. Finish GTM, founder story, pitch video, technical demo, pre-existing-work disclosure, and submission fields.

## 9. Funded-proof hard rule

Never do any of the following without explicit user approval in the current conversation:

- fund a wallet
- send USDC or SOL for the proof
- sign a money-moving transaction on the user's behalf
- submit a Jupiter deposit
- create a funded Jupiter order
- execute a real trade

Before approval, produce a runbook containing:

- chosen asset
- minimum provider amount
- required USDC/SOL balances
- expected fees
- trigger configuration
- whether cancel or fill is the intended terminal proof
- evidence to capture
- abort conditions

## 10. User validation target

Before submission aim for:

- 5–10 non-leading user conversations
- 2–5 users attempting the product
- exact feedback notes
- objections and trust concerns
- failed assumptions
- repeated requests
- changes made because of repeated feedback

Target people who actually trade or hold tokenized stocks, crypto, or onchain assets.

Never invent users, usage, revenue, partnerships, interviews, or quotes.

Core interview evidence to collect:

- last real situation where the user wanted conditional execution but could not monitor continuously
- current workaround
- frequency/severity of the problem
- willingness to authorize bounded automation
- biggest trust concern
- most useful policy primitive
- what was unclear in Circuit
- whether they would reuse it
- where they discover/use tokenized assets

## 11. Business / GTM questions to answer

Before final submission, document evidence-backed answers to:

- Who is the first customer?
- What problem happens often enough to matter?
- What do they use today?
- Why is Circuit better than using Jupiter directly?
- Who pays?
- What is the initial pricing hypothesis?
- How do we acquire the first 100 users?
- What is defensible?
- Why Solana?
- Why tokenized stocks first?
- Why now?

Do not use inflated TAM numbers without methodology. Prefer bottom-up reasoning.

Working differentiation:

- Jupiter = execution infrastructure.
- Circuit = intent, constraints, reference validation, deterministic compilation, bounded authorization, reconciliation, evidence, and eventually an API/control layer above execution providers.

## 12. Company positioning

### Today

- tokenized stocks
- price-triggered execution policies
- Pyth/PreStocks references
- Jupiter Trigger execution rail

### Next, only after the wedge is proven

- recurring/DCA policies
- take-profit / stop-loss
- OCO-style policies
- portfolio rules

### Later company roadmap

- treasury policies
- agent spending constraints
- cross-asset allocation
- institutional execution controls

### Vision

Programmable capital allocation with explicit, bounded authority.

Do not present roadmap capabilities as current product capabilities.

## 13. Pre-existing-work disclosure

Do not claim Circuit started from zero for Colosseum.

Working factual disclosure:

> Circuit was initially developed for the Stocklana hackathon. During the Crypto World's Fair competition period, development continued around production reliability, live execution readiness, user validation, UX, distribution, and the broader programmable-capital thesis. The final pre-Stocklana-deadline repository state is preserved at `0e0ddc6` via `stocklana-final-predeadline-2026` and `archive/stocklana-final-predeadline`.

Before final submission, tailor this wording to the exact work completed after 2026-09-24. Do not imply the preserved SHA is the exact platform-submitted SHA unless that is later proven.

## 14. Timeline: 2026-10-05 → 2026-10-12

### Oct 5 — truth and preservation

- preserve Stocklana final pre-deadline state — DONE
- restore local checkout — DONE
- restore disk/testability — DONE
- full checks — DONE
- live no-funds probes — DONE
- fail closed on expired Pyth entitlement — DONE
- production reseed/deploy — DONE
- create this Colosseum execution plan — CURRENT

### Oct 6 — no-funds live-path proof

- verify current Circuit wallet session
- verify Jupiter signed auth in the real UI
- verify/register vault if this moves no funds
- attempt deposit craft only if it is non-money-moving and can be safely abandoned before signing/submission
- document exact blocker if provider requires a funded/signing step earlier
- prepare funded-proof runbook
- begin user outreach

### Oct 7 — funded proof only if approved

- request explicit user approval after runbook is complete
- if approved, execute one minimum-value BUY lifecycle
- capture provider IDs, signatures, screenshots, and reconciliation evidence
- if not approved, preserve the honest no-funds boundary and continue submission work

### Oct 7–9 — validation sprint

- 5–10 interviews
- 2–5 product attempts
- fix only repeated, high-impact issues
- record evidence

### Oct 8–9 — company / GTM

- first customer
- problem/workaround
- differentiation
- first 100 users
- pricing hypothesis
- bottom-up market case
- founder-market fit
- why Solana / why now

### Oct 9–10 — submission copy and presentation

- final description
- founder story
- technical explanation
- GTM
- validation
- distribution
- pre-existing-work disclosure
- screenshots
- 2–3 minute founder/product presentation

### Oct 10–11 — technical demo and rehearsal

- separate ≤3 minute technical demo
- show only real evidence as real
- clearly label historical/fixture/simulated evidence
- test production URL, mobile, repo access, videos, and transaction links
- have an unfamiliar person explain Circuit back in one sentence

### Oct 12 — submit

- no new features
- final regression checks
- confirm `hackathon@colosseum.com` repo access if private
- submit Colosseum several hours early
- complete Superteam Nigeria side-track submission
- verify links after submission

## 15. Cut list if time becomes tight

Cut first:

1. DCA/recurring implementation
2. OCO / extra policy primitives
3. new assets
4. new sponsor integrations
5. agent/MCP productization
6. notifications
7. analytics SDK/platform
8. landing-page animation/polish beyond clarity
9. extra execution providers
10. new chains or custom Solana program

Never cut:

- Stocklana preservation
- truthful product state
- test/build health
- no-funds provider proof
- one funded proof if explicitly approved and feasible
- real user validation
- pitch/demo/submission completeness

## 16. Agent completion rule

For every task, report:

- files changed
- checks run
- REAL vs SIMULATED vs FIXTURE-BASED vs IMPLEMENTED-BUT-UNVERIFIED changes
- production effect
- remaining blocker
- commit SHA
- git status

Never use passing mocks or fixtures as evidence that production behavior occurred.
