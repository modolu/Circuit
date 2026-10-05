# Circuit — Colosseum Submission Copy

> Draft status: evidence-aligned working copy.  
> Update only when corresponding product/business evidence changes.

## One-line description

Circuit is the policy layer for onchain capital markets: users define bounded investment rules, and Circuit compiles, executes, and reconciles them without taking custody or making the investment decision for them.

## Short product description

Tokenized markets trade around the clock, but users still manage execution manually. Circuit turns a user's investment decision into a deterministic, bounded policy: asset, side, capital limit, trigger, slippage ceiling, and expiry. It captures an external reference, compiles the rule into a fixed execution instruction, routes it through Jupiter Trigger on Solana, and keeps an auditable record of what was authorized and what actually happened.

The current wedge is tokenized stocks. The broader product thesis is programmable capital allocation: a reusable policy/control layer above execution venues for individuals, treasuries, agents, and institutions.

## Problem

Onchain markets are always open, while human attention is not. Existing execution tools mostly expose orders; they do not provide a neutral policy layer that separates the user's decision from bounded autonomous execution and preserves evidence of the authorization, reference context, and resulting provider/onchain state.

That becomes more important for tokenized real-world assets, where the reference market and the token's actual execution market can differ.

## Solution

Circuit separates four jobs:

1. **User intent** — the user chooses the asset, direction, capital limit, trigger, slippage, and expiry.
2. **Reference context** — Circuit captures the configured external reference (Pyth for public equities where entitled; PreStocks first-party marks for the supported private-market token).
3. **Deterministic compilation and bounded authorization** — the rule is converted into a fixed machine-readable policy before execution.
4. **Execution + evidence** — Jupiter Trigger handles execution while Circuit reconciles provider/onchain state into an auditable lifecycle.

Circuit does not recommend stocks, predict prices, or secretly change the user's policy.

## Why now

Tokenized equities and private-market representations are creating markets that can trade outside the hours and interfaces of their underlying reference assets. At the same time, wallets, agents, and treasury software increasingly need bounded execution permissions rather than unlimited custody or ad-hoc transaction signing.

Circuit's thesis is that the missing primitive is not another exchange. It is a programmable control layer between intent and execution.

## Current product

Today Circuit supports a production flow for tokenized-stock policies on Solana:

- wallet sign-in;
- curated asset/reference model;
- Pyth and PreStocks reference adapters;
- deterministic policy compiler;
- fixed capital/slippage/expiry constraints;
- Jupiter Trigger integration;
- provider reconciliation and evidence model;
- real production persistence and audit events.

The production ANTHROPIC path has been verified through real Jupiter deposit preparation without submitting funds. The full funded lifecycle is implemented and tested but has not been completed with a funded production order during the Colosseum build period.

## Technical architecture

`intent → external reference → deterministic compiler → bounded policy → Jupiter Trigger V2 → Solana → reconciliation/evidence`

Core design principles:

- no private-key custody;
- exact-unit money arithmetic;
- external/provider truth before Circuit state claims;
- explicit user authorization for money-moving actions;
- deterministic compiler rather than LLM-driven execution;
- real, simulated, fixture, blocked, and unverified evidence are never conflated.

## Why Solana

Circuit needs fast wallet interaction, low-cost transaction settlement, strong token infrastructure, and an execution venue capable of programmatic order workflows. Solana plus Jupiter gives Circuit a practical environment for tokenized-asset policy execution while preserving explicit wallet authorization.

## Business model hypothesis

Initial model to validate:

- free/basic individual tier for a limited number of policies;
- paid power-user tier for more active policies, automation, notifications, and richer controls;
- later API / policy-infrastructure pricing for wallets, treasury products, agents, and institutions.

Do not present pricing as validated yet. It is a hypothesis pending user interviews and product attempts.

## Go-to-market hypothesis

Start where the pain is easiest to observe: users already holding or trading tokenized stocks on Solana.

Initial channels:

- direct outreach to active Solana/tokenized-stock users;
- xStocks / RWA / Solana trading communities;
- founder-led demos and user interviews;
- integrations with wallets or portfolio interfaces once repeated demand is proven.

The wedge is narrow by design. Expansion follows repeated demand for policy-controlled execution, not a generic multi-chain feature race.

## Competition-period work / pre-existing disclosure

Circuit was initially developed for the Stocklana hackathon. The final repository state before the Stocklana deadline is preserved at commit `0e0ddc60143dc75fe00c34d5cbfa7339a668ff99`, tag `stocklana-final-predeadline-2026`, and branch `archive/stocklana-final-predeadline`.

During the Colosseum competition period, work has continued around production correctness, live integration verification, fail-closed provider handling, Colosseum positioning, production evidence, user validation, and submission readiness. The preserved commit is described as the final pre-deadline repository state; it is not claimed to be the exact platform-submitted SHA because that could not be independently proven.

## Honest traction / validation state

Current product evidence:

- production application deployed;
- real wallet authentication observed;
- real policies created in production;
- real reference capture and deterministic compilation observed;
- real Jupiter authentication/vault flow observed;
- real Jupiter unsigned deposit preparation observed;
- full lifecycle covered by automated tests.

External demand validation is still incomplete. Do not invent user counts, retention, revenue, waitlists, LOIs, or interviews.

## Demo narrative

1. Open Markets and explain the separation between reference market and token execution market.
2. Select ANTHROPIC and show the live PreStocks mark/token price context.
3. Create a bounded BUY-BELOW policy with capital, trigger, slippage, and expiry.
4. Show the exact compiled trigger and plain-English policy before saving.
5. Open the policy and show the captured reference snapshot + audit events.
6. Show Jupiter connection/vault state.
7. Prepare a Jupiter deposit and explicitly point out that this is a real provider-generated unsigned transaction and no funds have been submitted.
8. Show the lifecycle/evidence model and state clearly that funded production execution remains unexecuted in this submission build.

## Founder / team framing placeholder

Founder-market-fit copy must stay factual and should be finalized with the founder profile used in the Colosseum account. Emphasize hands-on product building, design, technical implementation/coordination, trading-market familiarity, and repeated hackathon shipping only where the submission form supports those claims.

## Before submission — missing evidence

- 5–10 external user conversations;
- 2–5 users attempting the product or guided prototype;
- synthesized pain/objection/willingness-to-use notes;
- final GTM wording based on those interviews;
- 2–3 minute presentation video;
- separate ≤3 minute product demo;
- final founder/team fields;
- logo/graphic and required links;
- private-repo reviewer access if the repository remains private;
- final submission verification on both Colosseum and Superteam Nigeria surfaces.
