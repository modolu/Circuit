# CIRCUIT — Product Brief

> **Programmable execution for stocks that never sleep.**

**Hackathon:** STOCKLANA  
**Network:** Solana  
**Product type:** Policy-controlled tokenized-stock execution  
**Working name:** Circuit  
**Primary user:** Self-directed onchain investor / agent operator  
**MVP execution rail:** Jupiter Trigger V2  
**Reference market data:** Pyth Pro / Pyth equity feeds  
**Primary build target:** Main STOCKLANA track, with sponsor-track eligibility claimed only where the final implementation satisfies the sponsor rules.

---

## 1. Executive summary

Circuit is a policy-controlled execution layer for tokenized stocks on Solana.

A user should not have to sit in front of a brokerage screen waiting for a price, manually compare an onchain quote to an external market reference, or wake up because a stock token trades outside traditional exchange hours. Circuit lets the user express a constrained execution policy once, authorize it, and let the underlying Solana execution infrastructure carry it out when the configured conditions are met.

The product is deliberately **not** an AI stock picker.

Circuit does not tell a user which stock to buy. It does not invent a portfolio. It does not predict returns. It does not silently take discretionary risk.

The user decides:

```text
WHAT asset
HOW MUCH capital
WHEN execution is allowed
AT WHAT trigger condition
WITH WHAT slippage ceiling
UNTIL WHAT expiry
```

Circuit turns those instructions into a verifiable execution policy, checks the market context, compiles the policy into an autonomous order, and surfaces a complete audit trail from policy creation to onchain fill.

Example:

```text
POLICY: Buy the dip

Asset
NVDA tokenized stock

Budget
100 USDC

Trigger
Buy if USD price <= $181.00

Maximum slippage
0.50%

Expiry
24 hours

Reference data
Pyth equity feed

Execution
Jupiter Trigger order

Status
ARMED
```

The thesis is simple:

> **Tokenized stocks should behave like programmable assets, not brokerage screenshots.**

Traditional brokerages are good at manual order entry. Solana makes it possible to treat stock exposure as an asset that wallets, agents, smart order systems, and DeFi infrastructure can reason about programmatically.

Circuit turns that programmability into a consumer-facing product.

---

## 2. The problem

Tokenized stocks create a new market surface, but most user experiences still copy the old brokerage interaction model:

```text
open app
→ search ticker
→ inspect chart
→ place order
→ repeat
```

That leaves much of the value of onchain securities unused.

The underlying assets can be available around the clock, move through wallets, route through onchain liquidity, and participate in programmable workflows. Yet the user is often still expected to behave like a human market watcher.

Three problems matter most.

### 2.1 Humans cannot monitor a 24/7 market continuously

A traditional brokerage is built around defined market sessions. Tokenized stock markets can remain accessible outside those windows.

A user may want:

> Buy 100 USDC of the stock token if it reaches my price tonight.

The useful behavior is not an alert at 02:18.

The useful behavior is:

```text
condition becomes true
→ authorized order executes
→ user wakes up to the receipt
```

### 2.2 Price alone is not enough context

An onchain token price exists inside a liquidity venue.

The corresponding equity has an external market reference.

Users need to understand:

```text
reference price
onchain execution price
deviation
price freshness
slippage
liquidity
```

before authorizing an automated order.

A token printing "$180" somewhere is not enough.

Circuit uses Pyth as an independent reference-data layer so the policy interface can distinguish:

```text
TARGET PRICE
from
REFERENCE MARKET DATA
from
EXPECTED EXECUTION
```

### 2.3 Automation normally asks users to surrender too much control

"AI trading agent" often implies:

```text
give bot wallet
give bot money
let bot decide
hope
```

Circuit takes the opposite approach.

Automation must occur **inside explicit user constraints**.

The system should be able to answer:

> Why was this order allowed to execute?

with something much better than:

> The model decided.

---

## 3. Product thesis

The primitive we want is:

> **Policy → authorization → autonomous execution → evidence.**

Circuit makes stock execution programmable while keeping discretion with the user.

The core architecture is intentionally split:

```text
USER INTENT
     ↓
CIRCUIT POLICY
     ↓
MARKET REFERENCE + VALIDATION
     ↓
EXECUTION ORDER
     ↓
JUPITER / SOLANA
     ↓
ONCHAIN FILL
     ↓
AUDIT TRAIL
```

Circuit is the policy and product layer.

It should not rebuild:

- a DEX aggregator;
- an oracle;
- a wallet;
- a keeper network;
- a brokerage;
- an execution venue.

Those already exist.

Winning product engineering here means composing the existing Solana stack into a user experience that did not make sense in a traditional brokerage.

---

## 4. Why now

Solana now has a meaningful tokenized-equity surface. Tokenized stocks and ETFs can exist alongside stablecoins, crypto assets, lending markets, and DEX liquidity in the same wallet environment.

That changes the design space.

A stock position can now participate in software workflows:

```text
wallet balance changes
→ investment policy evaluates
→ order is created
→ execution occurs
→ receipt feeds another workflow
```

The opportunity is not merely "stocks on blockchain."

The opportunity is:

> **stocks as programmable state.**

Circuit focuses on the most immediately understandable use of that property: conditional execution.

---

## 5. Product promise

### Primary promise

> **Define the rules once. Circuit handles the execution path.**

### Supporting promise

> **Your policy is visible, bounded, explainable, and auditable.**

Circuit should feel like **automation infrastructure wrapped in a consumer-grade investing interface**, not an exchange terminal, hedge fund, robo-adviser, meme trading bot, or generic chatbot.

---

## 6. Target users

### 6.1 Self-directed tokenized-stock holders

People already comfortable with a Solana wallet who want stock exposure without manually watching markets.

### 6.2 Crypto-native investors

Users who manage stablecoins and tokenized assets in the same wallet and expect 24/7 availability, wallet ownership, programmable execution, and transparent transactions.

### 6.3 Agent operators

Developers and users building financial agents that need a bounded execution primitive.

Instead of giving an agent arbitrary wallet authority, Circuit gives it a narrow policy surface.

### 6.4 Treasury operators — post-MVP

Treasuries can later encode max allocation, rebalance bands, daily spend ceilings, and approved securities. Not required for the hackathon MVP.

---

## 7. Jobs to be done

Primary:

> When I already know what stock token I want and the conditions under which I am willing to buy or sell it, execute that instruction without requiring me to monitor the market continuously.

Secondary:

- show the independent market reference before arming;
- show whether the reference is fresh;
- show the difference between trigger and current market;
- keep maximum capital at risk explicit;
- allow cancellation;
- show exactly what happened after a fill;
- let another agent inspect policy state without broad wallet authority.

---

## 8. MVP scope

Supported policy families:

### A. Buy below

```text
Buy 100 USDC of NVDA token
when USD price <= 181
```

### B. Buy above

```text
Buy 100 USDC
when USD price >= 195
```

### C. Sell above

```text
Sell 0.25 token
when USD price >= 220
```

### D. Sell below

```text
Sell 0.25 token
when USD price <= 170
```

### E. Price-banded DCA — only if time permits

The primary four price-order flows must not be jeopardized.

Every policy has:

```text
asset
side
input amount
trigger direction
trigger USD price
maximum slippage
expiry
```

Circuit also records the Pyth reference snapshot, feed timestamp, freshness, wallet, Jupiter order identifier, and transaction/fill evidence.

### MVP assets

Start with **2–4 liquid Solana tokenized stocks** that satisfy all of:

1. verified mint;
2. routable execution path;
3. matching Pyth equity/reference feed;
4. adequate live liquidity for a small demo;
5. legal/technical availability to the builder environment.

Do not hard-code a large catalog before verifying routes.

---

## 9. Non-goals

The MVP does not build personalized recommendations, portfolio optimization, price predictions, copy trading, leverage, margin, lending, options, derivatives, cross-chain routing, fiat on-ramp, tax accounting, KYC, brokerage account opening, a custom DEX, custom oracle, custom keeper network, custom custody system, or a custom Solana program unless an integration requirement later forces it.

---

## 10. Core user experience

### 10.1 Connect wallet

```text
CIRCUIT

Automate your tokenized-stock execution.

[ Connect Solana Wallet ]
```

No email registration in the hackathon MVP. The connected wallet is the identity.

### 10.2 Explore supported stock tokens

Each asset shows ticker, issuer/product label, verified mint, Pyth feed, current reference price, freshness, and route availability.

Never infer mint addresses from ticker strings.

### 10.3 Create policy

Example:

```text
Asset:            NVDA
Action:           Buy
Budget:           100 USDC
Condition:        Price falls to
Trigger:          $181.00
Max slippage:     0.50%
Expiry:           24 hours
```

Review card:

```text
CURRENT REFERENCE
$184.20

TARGET
$181.00
-1.74%

MAXIMUM CAPITAL
100 USDC

MAX SLIPPAGE
0.50%

EXPIRES
Tomorrow 14:30

EXECUTION RAIL
Jupiter Trigger
```

### 10.4 Explain before authorization

> Circuit will authorize an order to buy up to 100 USDC of NVDA token if the configured USD trigger condition is reached before expiry. Execution is routed by Jupiter and may fill at a different price within the configured execution constraints.

### 10.5 Arm policy

Circuit persists:

```text
DRAFT
→ ARMING
→ ARMED
```

Once armed, the page does not need to remain open for the underlying Jupiter trigger order to remain active.

### 10.6 Observe

Show trigger, Pyth reference, distance to trigger, expiry, and cancel action.

### 10.7 Fill

After execution show input, output, average execution, reference snapshot, transaction signature, and execution source.

---

## 11. Policy state machine

```text
DRAFT
  ↓
ARMING
  ↓
ARMED
  ├──→ EXECUTED
  ├──→ CANCELLED
  ├──→ EXPIRED
  └──→ FAILED
```

`FAILED` is not `CANCELLED`.

Jupiter remains the external source of truth for order lifecycle. Circuit never marks `EXECUTED` solely because a client request succeeded.

---

## 12. The role of Pyth

Pyth is not decorative market data.

Circuit uses it as an independent reference layer for:

- reference price;
- freshness;
- relative-trigger compilation;
- sanity checking.

Example:

```text
Pyth reference: $200
User rule: -3%
Compiled trigger: $194
```

Store source expression, compiled trigger, reference used, and timestamp.

A stale or unavailable feed blocks relative-policy compilation.

Unless execution-time oracle enforcement is implemented and verified, Circuit must **not** claim that Pyth prevents Jupiter from executing at a bad price. Pyth informs and validates Circuit's policy layer; Jupiter owns trigger execution.

---

## 13. The role of Jupiter

Jupiter Trigger V2 is the execution engine.

It already provides autonomous trigger orders, USD price triggers, buy/sell above/below, OCO/OTOCO, DCA, vault-based execution, routing, partial fills, slippage controls, and order lifecycle management.

Circuit should not rebuild these systems.

The differentiation is:

```text
trigger infrastructure
+
equity-aware reference data
+
policy language
+
stock-specific UX
+
auditability
+
agent-friendly state
```

---

## 14. Policy compiler

Circuit's compiler is deterministic.

Example:

```text
User:
Buy $100 NVDA if it drops 3% from here.

Pyth NVDA:
$200

Compiler:
trigger = $194
```

Compiler output maps to the provider's price-order contract.

No LLM is required for executable fields.

If natural-language entry is later added, an LLM can only produce a draft. The user must review the structured policy before authorization.

---

## 15. Agent-native interface

Future typed tool surface:

```text
list_supported_equities()
get_equity_reference()
create_policy_draft()
get_policy()
cancel_policy()
list_policy_events()
```

For the hackathon, the web product is primary.

---

## 16. Safety model

Circuit safety is based on bounded authority, not intelligence.

A policy specifies one wallet, one input asset, one target asset, one side, one amount, one trigger, one slippage ceiling, and one expiry.

Circuit may not silently increase spend, change the asset, extend expiry, remove the trigger, reverse the side, or create unrelated orders.

---

## 17. Product positioning

Circuit is an execution interface, not an adviser.

Avoid language like "best stock", "recommended", "safe investment", "guaranteed", "risk-free", "AI predicts", or "will outperform".

Use "reference price", "configured trigger", "user-defined policy", "execution condition", "estimated", and "historical event".

---

## 18. Differentiation

Versus a brokerage limit order: Circuit is a wallet-native policy layer built around programmable tokenized assets.

Versus a DEX UI: Circuit exposes intent rather than raw swap mechanics.

Versus an AI trading bot: Circuit does not decide the investment thesis.

Versus a generic Jupiter Trigger frontend: Circuit is specialized for tokenized equities with verified stock-token catalog, issuer identity, Pyth equity reference, freshness/session awareness, relative trigger compilation, stock-specific explanations, and an agent-readable audit trail.

---

## 19. Hackathon narrative

> **Traditional stocks are becoming Solana assets, but their interfaces still behave like brokerages. Circuit makes stock ownership programmable. A user defines a bounded execution policy once; Circuit anchors the instruction to independent equity reference data, compiles it into an autonomous Solana order, and lets the network execute while the user is offline.**

---

## 20. Demo script

1. Show the problem: tokenized stocks can remain accessible while the user is offline.
2. Create a tiny policy on a verified stock token.
3. Show Pyth reference, feed timestamp/freshness, and compiled trigger.
4. Wallet authorizes the Jupiter Trigger flow.
5. Show `DRAFT → ARMED`; reload/close to prove the browser is not the keeper.
6. Show a live or previously completed onchain execution with transaction evidence.
7. End with: **"The user chooses the investment. Circuit handles the execution path."**

---

## 21. Success criteria

The MVP is complete when:

- wallet connects;
- supported stocks are verified by mint;
- Pyth references display correctly;
- stale/carried data is distinguished;
- a user can create a deterministic policy;
- the policy compiles into Jupiter Trigger;
- authorization/deposit works;
- an armed order survives browser closure;
- provider state reconciles;
- real execution evidence is shown;
- cancellation works;
- no private key or provider API key reaches the client.

---

## 22. Business model

Potential post-hackathon models:

- free basic price policies;
- paid advanced conditions and more active policies;
- usage-based API/agent tier;
- embedded integrations for wallets/issuers.

Do not add fees to the hackathon MVP unless supported transparently by the execution provider.

---

## 23. Post-hackathon roadmap

**Phase 1:** price policies, 2–4 stocks, Pyth, Jupiter, audit trail.  
**Phase 2:** OCO, OTOCO, price-banded DCA, templates, notifications.  
**Phase 3:** allocation and rebalance policies.  
**Phase 4:** agent identities, spend ceilings, approved-asset scopes, MCP/API.  
**Phase 5:** additional execution venues only when there is a measurable reason.

---

## 24. Brand direction

Circuit should feel like precision, control, automation, markets, and infrastructure.

Use a restrained technical visual language. Avoid casino neon, meme graphics, giant candlesticks, and generic "AI magic" gradients.

The interface should be understandable in one screenshot.

---

## 25. Product principles

1. **The user decides; Circuit executes.**
2. **Authorization is bounded.**
3. **Reference data and execution data are different concepts.**
4. **Every material state transition leaves evidence.**
5. **Never hide stale market data.**
6. **Never infer a mint from a ticker.**
7. **Never claim an order filled until the execution provider/onchain evidence says it did.**
8. **One excellent policy flow beats ten half-built strategies.**
9. **Do not rebuild infrastructure Solana already provides.**
10. **A judge should understand the product before the first minute of the demo ends.**

---

## 26. Definition of done

```text
✓ wallet connects
✓ verified token catalog exists
✓ USDC input asset configured
✓ Pyth equity reference works server-side
✓ feed freshness displayed
✓ relative policy compiles to fixed trigger
✓ all four price-order directions represented
✓ token amounts use integer units
✓ slippage uses basis points
✓ expiry is explicit UTC
✓ Jupiter auth/deposit/order flow works
✓ ARMED only after provider confirms order
✓ provider order ID persisted
✓ provider state reconciles
✓ cancellation works
✓ fill records transaction evidence
✓ browser closure does not kill the order
✓ Circuit stores no private keys
✓ Pyth/Jupiter secrets never reach browser code
✓ errors are understandable
✓ core flows have automated tests
✓ a tiny live execution or equally verifiable live order is demonstrated
✓ submission copy accurately describes what Pyth and Jupiter each enforce
```

---

## 27. One-sentence pitch

> **Circuit lets users turn tokenized-stock decisions into bounded autonomous execution policies on Solana, using Pyth for equity reference data and Jupiter for 24/7 trigger execution.**

---

## 28. Closing thesis

Putting a stock onchain should change more than where the balance is stored.

It should change what software can do with ownership.

> **Stocks are onchain. Their execution should be programmable too.**
