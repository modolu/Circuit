# CLAUDE.md — Circuit

Circuit is a policy-controlled execution app for tokenized stocks on Solana. A connected wallet defines a bounded policy (asset, side, amount, USD trigger, slippage ceiling, expiry). Circuit checks it against a Pyth equity reference, compiles it deterministically into a Jupiter Trigger V2 order, and reconciles the provider's order state into an auditable record.

**The user chooses the investment. Circuit only executes bounded, user-defined policies.** Circuit never recommends, predicts, or decides anything on the user's behalf.

---

## 0. Source-of-truth documents (read these first)

| File | Owns | Editable by agents? |
|---|---|---|
| `CIRCUIT_ARCHITECTURE.md` | Technical decisions, data model, flows, directory layout, build order | **No**, unless the user asks for a deliberate architecture change (then update it in the same commit, per §30.19) |
| `CIRCUIT_PRODUCT_BRIEF.md` | Product scope, UX, positioning, definition of done | **No**, unless the user asks |
| `CLAUDE.md` (this file) | How to work in this repo: conventions, commands, guardrails | Yes, when conventions change |

Precedence when they conflict: **ARCHITECTURE > PRODUCT BRIEF > CLAUDE.md**, except where this file records a newer, user-approved constraint. Those are listed in §19 ("Deliberate deviations"). If you find a new conflict, stop and ask. Do not resolve it silently.

---

## 1. Hackathon context

- **Event:** STOCKLANA (tokenized stocks on Solana).
- **Primary track:** Main Track.
- **Sponsor target:** Pyth Network. Claim eligibility only for what the final implementation actually does. Architecture §33 open question #6 (whether the Pyth bounty requires Pro-specific usage) must be answered before submission copy is written.
- **Execution rail:** Jupiter Trigger V2. It is not a sponsor claim; it is the execution infrastructure.
- **Honesty rule:** Never overstate what Pyth or Jupiter enforce. Pyth informs and validates Circuit's policy layer. It does **not** stop Jupiter from filling at a bad price unless execution-time oracle enforcement is implemented and verified (Brief §12).

---

## 2. Stack (pinned decisions)

| Concern | Decision |
|---|---|
| Runtime | Node.js 22 LTS |
| Package manager | pnpm 11.5.1, the locally installed version (pinned via the `packageManager` field; lockfile committed). Do not change tool versions unless there is an actual compatibility problem. |
| Framework | Next.js 16, App Router only (no `pages/`) |
| UI | React 19 |
| Language | TypeScript 5.x, `strict: true` plus `noUncheckedIndexedAccess` and `noImplicitOverride` |
| Styling | Tailwind CSS 4 (CSS-first config) |
| Primitives | Radix UI, only where an accessibility primitive is needed (dialog, popover, select, tooltip) |
| Database | Neon PostgreSQL (free tier; server reports PostgreSQL 18.6) |
| ORM / migrations | `drizzle-orm` 0.45.3 + `drizzle-kit` 0.31.11, `@neondatabase/serverless` 1.1.0 (`neon-serverless` Pool driver). Tests: `@electric-sql/pglite` 0.5.8 (in-process Postgres, dev-only). |
| Validation | Zod 4 at every external boundary |
| Money | `bigint` for atomic token amounts, `decimal.js` 10.6.0 (local `Dec` clone in `src/domain/money.ts`, precision 64) for USD values. Never `number` for money. |
| Wallet | `@solana/wallet-adapter-base` 0.9.28, `@solana/wallet-adapter-react` 0.15.40, `@solana/wallet-adapter-react-ui` 0.9.40, with Wallet Standard discovery (no explicit adapters: `WALLET_STANDARD_ONLY = []` in `components/wallet/solana-provider.tsx`). **Do not add `@solana/wallet-adapter-wallets`.** |
| Solana client | `@solana/web3.js` 1.99.0, for addresses, signatures, and transactions only. Ed25519 login verification: `tweetnacl` 1.0.3 (server-side). Jupiter signature encoding (base64 → base58): `bs58` 6.0.0 (server-side). |
| Reference data | Pyth Pro REST (public equities) and the PreStocks first-party API (private-company tokens), server-side only, on demand (no Circuit-owned WebSocket) |
| Execution | Jupiter Trigger V2 REST, server-side only |
| Tests | Vitest + Testing Library (unit/service/component), Playwright (e2e critical path) |
| Hosting | Vercel (Hobby tier assumptions, see §12) |
| Observability | Structured JSON console logs + Vercel logs |

**Forbidden additions:** custom Solana/Anchor program, custom keeper, custom router or oracle, Redis, queues (Vercel Queues, Kafka, BullMQ, etc.), microservices, a separate API server, Redux, Zustand, Prisma, GraphQL, tRPC, Elasticsearch, Circuit-owned WebSocket infra, analytics SDKs, LLMs in any executable policy path. Everything must run on free tiers.

---

## 3. Folder structure

This mirrors `CIRCUIT_ARCHITECTURE.md` §6 exactly. **Do not add a new top-level directory** without editing the architecture doc first, with user approval. New files inside existing directories are fine.

```text
/
├── CIRCUIT_ARCHITECTURE.md     CIRCUIT_PRODUCT_BRIEF.md     CLAUDE.md     README.md
├── package.json  pnpm-lock.yaml  next.config.ts  tsconfig.json  drizzle.config.ts  .env.example
├── app/                         # Next.js App Router: pages + route handlers only
│   ├── layout.tsx  page.tsx
│   ├── dashboard/page.tsx  markets/page.tsx
│   ├── policies/new/page.tsx
│   ├── policies/[policyId]/page.tsx
│   └── api/
│       ├── assets/route.ts
│       ├── reference/[assetId]/route.ts
│       ├── policies/route.ts
│       ├── policies/[policyId]/route.ts
│       ├── policies/[policyId]/arm/route.ts
│       ├── policies/[policyId]/cancel/route.ts
│       ├── policies/[policyId]/reconcile/route.ts
│       ├── jupiter/auth/{challenge,verify,logout}/route.ts, jupiter/status, jupiter/vault/register
│       ├── policies/[policyId]/jupiter/deposit/route.ts   # prepare only, never signs
│       ├── policies/[policyId]/jupiter/{arm,cancel,confirm-cancel}/route.ts   # verify signed tx → Jupiter
│       └── cron/reconcile/route.ts
├── components/                  # presentation + browser interaction; no secrets
│   ├── wallet/  jupiter/  prestocks/  policy/  asset/  ui/
├── src/
│   ├── domain/                  # pure: policy.ts money.ts asset.ts reference.ts errors.ts
│   ├── services/                # use cases: create/compile/arm/cancel/reconcile-policy.ts, get-reference.ts, jupiter/{auth,vault,prepare-deposit,live-gates,arm-live,live-orders,reconcile-live,cancel-live,errors}.ts
│   ├── integrations/
│   │   ├── pyth/                # client.ts mapper.ts types.ts
│   │   ├── prestocks/           # client.ts mapper.ts types.ts (first-party catalog)
│   │   └── jupiter/             # client.ts trigger.ts schemas.ts types.ts token-compat.ts signed-transaction.ts (+ mock adapter, see §11)
│   ├── db/                      # client.ts schema.ts repositories/ migrations/
│   ├── auth/                    # wallet-message.ts verify-wallet.ts session.ts jupiter-session.ts
│   ├── validation/              # policy.ts api.ts (Zod schemas)
│   ├── config/                  # env.ts assets.ts prestocks.ts
│   └── observability/           # logger.ts
└── tests/
    ├── unit/  integration/  fixtures/  e2e/
```

Tool config files (`vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`) may live at the root. They are files, not directories. The seed script lives inside `src/db/` (e.g. `src/db/seed.ts`). There is no `scripts/` directory.

### Layer ownership (Architecture §6–7)

| Layer | May | Must not |
|---|---|---|
| `app/api/**` | parse HTTP, authenticate, validate with Zod, call **one** service, map result or error to HTTP | contain business logic, compute prices, write DB directly |
| `src/services/**` | orchestrate domain + repositories + integrations, own DB transactions and state transitions | import React or UI |
| `src/domain/**` | pure functions: policy rules, money math, state machine | import DB, network, Next.js, Pyth, or Jupiter |
| `src/integrations/**` | call external APIs, validate and normalize payloads into internal types | leak vendor DTOs outward, import UI or services |
| `src/db/repositories/**` | Drizzle reads/writes | call Pyth/Jupiter, import services |
| `components/**` | render, handle browser interaction, talk to the wallet | import server-only modules or read secrets |

Dependency direction: `UI / route handlers → services → domain`, and `services → repositories | integrations`. Never the reverse.

---

## 4. Coding conventions

- TypeScript strict. No `any`. No `@ts-ignore`. `@ts-expect-error` only with a comment explaining why. No non-null `!` on external data.
- Parse, don't cast. External data (HTTP bodies, Pyth, Jupiter, env, DB `jsonb`) goes through Zod before use. `as SomeType` on external data is forbidden.
- Server-only modules (`src/config/env.ts`, `src/db/**`, `src/integrations/**`, `src/services/**`, `src/auth/**`) must be marked server-only so a client import fails the build.
- Server Components by default. Add `"use client"` only for interactivity or wallet access, and keep client components as leaves.
- Next.js 16 specifics: route `params` and `searchParams` are async (`await params`). Request interception, if ever needed, uses `proxy.ts`, not `middleware.ts`. Verify version-specific APIs against current Next.js 16 docs before writing them.
- Route handlers stay thin, following one pattern: `requestId → auth → zod parse → service call → respond`.
- Services take explicit dependencies (repositories, provider adapters, clock, id generator) so tests can inject fakes. No hidden module-level singletons in domain or services.
- Inject time (`now: Date`) into domain functions. Never call `Date.now()` inside domain code.
- Named exports only, except where Next.js requires a default export (`page.tsx`, `layout.tsx`).
- Inside `src/`, import other `src/` modules by **relative path with a `.ts` extension** (`../db/schema.ts`), not `@/…`. Node 22 runs scripts such as `src/db/migrate.ts` natively (type stripping), and it needs explicit extensions and no path aliases. `app/`, `components/` and `tests/` may use `@/…`.
- Follow an existing pattern before creating a new abstraction. No speculative generality and no unrelated refactors inside a milestone.
- Comments explain *why*, not *what*. Link provider docs when encoding provider-specific behaviour.

## 5. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files and folders | kebab-case | `compile-policy.ts`, `policy-review-card.tsx` |
| React components | PascalCase | `PolicyReviewCard` |
| Functions and variables | camelCase, verb-first for actions | `compilePolicy`, `armPolicy` |
| Types and interfaces | PascalCase, no `I` prefix | `EquityReference`, `CompiledPolicy` |
| Zod schemas | camelCase + `Schema` | `createPolicyBodySchema` |
| Enum-like values | UPPER_SNAKE string literals matching the DB | `'ARMED'`, `'BUY'`, `'RELATIVE_PERCENT'` |
| DB tables and columns | snake_case, plural tables | `policy_events.created_at` |
| Money in code | suffix with the unit | `amountAtomic: bigint`, `triggerUsd: Decimal`, `maxSlippageBps: number` |
| Timestamps | `…At` (Date) or `…Timestamp` (provider time) | `expiresAt`, `feedUpdateTimestamp` |
| Env vars | UPPER_SNAKE, `CIRCUIT_` prefix for app-owned values | `CIRCUIT_SESSION_SECRET` |
| Log events | `category.action` | `policy.armed`, `reconcile.unknown_state` |
| Error codes | the stable list in §9 only | `REFERENCE_STALE` |
| Tests | `*.test.ts(x)` in `tests/unit` or `tests/integration`; `*.spec.ts` in `tests/e2e` | `compile-policy.test.ts` |

Vendor-specific names (Jupiter/Pyth field names) must not appear outside `src/integrations/**`.

## 6. Styling rules

- **Visual source of truth:** `design/circuit_mockup.html` (amber Circuit system) for palette, type, spacing, radii, header, cards, buttons, and status chips. `design/circuit_mockup_alt.html` is a secondary reference for mobile behaviour only. Do not blend the two palettes. The mockups' example balances, prices, policies, fills, and signatures are placeholder content and must never ship.
- Tokens live in `app/globals.css` `@theme` (`canvas, panel, panel-2, raised, line, line-strong, text, muted, dim, accent, success, warning, danger, info`). Amber `accent` is the only brand accent. Semantic colours are for state only.
- Shared primitives live in `components/ui/` (`app-header`, `button`, `card`, `section-label`, `status-chip`, `value-block`, `circuit-mark`). Extend these before creating new ones.
- `dim` is for borders, arrows, and disabled items, not for readable text. Small labels use `muted` to keep contrast.
- Tailwind CSS 4, CSS-first. Define design tokens with `@theme` in `app/globals.css`. Do not create a JS Tailwind config unless a plugin forces it.
- Brand direction (Brief §24): precision, control, infrastructure. Restrained palette, generous whitespace. No casino neon, meme art, giant candlesticks, or "AI magic" gradients. A screenshot should explain the product.
- Use `font-mono` (tabular numerals) for every price, amount, percentage, timestamp, and identifier. Addresses, mints, feed IDs, and signatures are truncated in the middle, with a copy button showing the full value.
- **Empty over fake:** render unbuilt data as honest empty states (`ValueBlock value={null}`, "Not integrated yet" chips, disabled nav items marked "soon"). Never populate UI with invented balances, prices, mints, orders, fills, addresses, or signatures.

### UX decisions for later milestones

- **Pyth reference is visually central.** The policy review shows the Pyth reference (price, freshness label, age, feed) and the compiled trigger (direction, price, distance from captured reference) as the largest figures, using `ValueBlock`.
- **Natural-language review sentence.** The review UI prominently generates one plain-English sentence from the structured policy, e.g. "Buy up to 100 USDC of AAPLx if the USD price falls to or below $181 before expiry." The structured form from the primary mockup remains the input UX, and the sentence is output only.
- **Explicit authorization.** Arming uses a clear "Authorize & arm policy" button, preceded by an explanation of what the wallet will sign. No hold-to-arm gestures.
- **No synthetic charts.** Never render a generated or interpolated price series. Only plot real Pyth data, if a chart is ever added.
- **No agent/API surface in the UI** (e.g. `get_policy()` JSON) until that interface is implemented.
- Every numeric input shows its unit (USDC, token symbol, USD, %, bps).
- Status is never conveyed by colour alone. Always pair colour with a text label and/or icon (e.g. `ARMED`, `STALE`).
- Trigger direction is written in words ("when price falls to or below $181.00"), not only as symbols.
- Accessibility: keyboard-operable forms and dialogs, visible focus rings, labelled inputs, sufficient contrast in both light and dark themes.
- Do not add shadcn/ui or other component kits without approval. Build small components in `components/ui/` using Radix only where needed.
- Mobile-first responsive layout, with no horizontal scroll at 360px width.

## 7. State-management rules

- Durable truth lives in the DB (user intent, audit trail) and with Jupiter/Solana (order lifecycle, settlement). **Never in browser state.**
- Read server state in Server Components or route handlers. After mutations, use `router.refresh()` or revalidation instead of a client cache store.
- Use React local state (`useState`, `useReducer`, `useActionState`) for forms and transient UI only.
- Wallet connection state stays inside the wallet provider context. Do not mirror it elsewhere.
- No Redux, Zustand, Jotai, or global stores. A client data-fetching library needs explicit approval (§15).
- Circuit auth is an HttpOnly cookie. Never store auth tokens, provider JWTs, or secrets in `localStorage` or `sessionStorage`.

## 8. Money-handling rules (highest-risk code)

- **Token amounts** are integer atomic units: `bigint` in code, decimal digit **strings** in JSON, `numeric(78,0)` in Postgres. Convert display ↔ atomic only in `src/domain/money.ts`, using the asset's verified `decimals`.
- **USD values** (reference, trigger, effective price) use `decimal.js`. Use a local instance (`Decimal.clone({...})`) defined in `src/domain/money.ts` and never mutate the global Decimal config. Serialize as strings, store as Postgres `numeric`.
- **Never** use `number`, `parseFloat`, `Number()`, `Math.*`, or `toFixed` for money-critical values. `200 * 0.97` is forbidden. Build Pyth values exactly from their integer price + exponent (string/bigint), never via floats.
- **Slippage** is integer basis points (`50` = 0.50%), range-checked against a configured min/max.
- **Rounding** is always explicit. Every conversion names its rounding mode, and the compiler's rounding per side and direction is unit-tested. Provider precision (tick size and decimal places Jupiter accepts) must come from current docs, not memory.
- Relative triggers: `compiled = reference × (1 ± pct/100)`, computed in Decimal. Store the source expression, compiled trigger, reference value, and feed timestamp together.
- Reject zero, negative, non-integer atomic, and over-precision inputs at the Zod boundary *and* in the domain.
- Required unit tests: display↔atomic across decimals, boundaries, invalid inputs, BUY/SELL × ABOVE/BELOW, absolute and relative, slippage bounds, expiry.
- **Implemented rules** (`src/domain/money.ts`, `src/domain/policy.ts`, `src/services/compile-policy.ts`):
  - Token amounts are never rounded. More decimal places than the token supports is a `VALIDATION_ERROR`.
  - Inputs must be plain positive decimals, with no signs, exponents, separators or leading zeros.
  - Absolute trigger prices allow at most 2 decimals.
  - Relative percentages allow at most 2 decimals, with 0 < pct < 100.
  - Compiled triggers are cents (`TRIGGER_USD_SCALE = 2`), rounded in the stricter direction (BELOW → down, ABOVE → up). Jupiter's accepted precision is re-checked in the Jupiter milestone.
  - Display percentages round half-even.
  - Form choices: slippage **25 / 50 / 100 bps** (`SLIPPAGE_BPS_OPTIONS`) and expiry **24 / 72 / 168 h**. `expiresAt = createdAt + hours`, exact UTC. The database's 0–10,000 bps check is only a structural bound.
  - **Reference freshness for drafts:** STALE blocks all drafts (`REFERENCE_STALE`). CARRIED blocks relative triggers (`REFERENCE_STALE`) but allows absolute ones, whose snapshot is stored as CARRIED. UNAVAILABLE blocks all drafts (`REFERENCE_UNAVAILABLE`).
  - The compiler output uses Circuit-internal `orderFamily`/`triggerCondition`. Jupiter field names are mapped only in the Jupiter integration.
  - USDC is verified config (`src/config/tokens.ts`: Circle docs plus a mainnet mint check, 6 decimals).
  - SELL amounts are raw token units. AAPLx's `scaledUiAmountConfig` means wallets may display a scaled amount, so revisit the UI multiplier before live SELL.
  - **ScaledUiAmount is display-only (Task 9).** UI amount = raw × multiplier; raw balances never change and transactions use raw amounts. The multiplier is NEVER applied to a USD price or trigger: Circuit never computes `trigger = Pyth × multiplier`.
  - The review sentence comes from `describePolicy` (structured fields only).

## 9. Error-handling conventions

- One error type: `AppError` in `src/domain/errors.ts` with `{ code, message, retryable, cause? }`, plus `httpStatus` from `HTTP_STATUS_BY_CODE` and `toAppError()` for unknown throws.
- **Stable codes only** (Architecture §16): `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, ASSET_DISABLED, REFERENCE_UNAVAILABLE, REFERENCE_STALE, PROVIDER_AUTH_REQUIRED, PROVIDER_REJECTED, PROVIDER_UNAVAILABLE, POLICY_STATE_CONFLICT, POLICY_EXPIRED, ORDER_NOT_FOUND, CANCELLATION_FAILED, INTERNAL_ERROR`. Adding a code means editing the architecture doc.
- Response envelopes: success `{ data, requestId }`, error `{ error: { code, message, retryable }, requestId }`.
- Integrations catch transport and schema errors and rethrow them as `PROVIDER_*` or `REFERENCE_*` codes. Raw provider messages, stack traces, and secrets never reach the client.
- Unknown errors become `INTERNAL_ERROR`, get logged with `requestId`, and return a generic message.
- A policy owned by another wallet returns `NOT_FOUND`, so its existence is not revealed.
- An unknown provider state is logged as `reconcile.unknown_state`. The current status is kept, a diagnostic is shown, and nothing is guessed.
- Messages shown to users are plain English and say what to do next.

## 10. Security rules

- **No private keys, ever.** Circuit never asks for, receives, or stores seed phrases, private keys, or exported secret keys.
- **Secrets are server-only.** Pyth and Jupiter API keys, the Jupiter JWT, the session secret, the encryption key, and `DATABASE_URL` are never exposed via `NEXT_PUBLIC_*`, never imported into client components, and never logged.
- **Wallet login** (`src/auth/`, routes `app/api/auth/{nonce,verify,logout}`):
  - `POST /api/auth/nonce` issues a 5-minute challenge. The server stores only `sha256(nonce)` in `auth_nonces` along with the wallet, origin, cluster and times, and returns the canonical Sign-In With Solana message (`src/auth/wallet-message.ts`).
  - `POST /api/auth/verify` takes `{ walletAddress, nonce, signature(base64) }`, rebuilds the exact message from the stored challenge, and verifies the Ed25519 signature. Only then does it consume the nonce, with one conditional update in the same transaction as the wallet upsert. Client-supplied message text is never trusted.
  - Every failure returns the same generic `UNAUTHENTICATED` message. The specific reason is logged, never returned.
  - Sign-in runs only from an explicit click, never on wallet connect. Wallets without `signMessage` get a clear error; there is no fallback to transaction signing.
- **Session:** stateless `circuit_session` cookie, `v1.<payload>.<HMAC-SHA-256>` signed with `CIRCUIT_SESSION_SECRET` (at least 32 characters) and checked with a constant-time comparison. The payload holds only the wallet, issued-at and expiry. Lifetime is 8 hours. The cookie is HttpOnly, SameSite=Lax, Path=/, and Secure except when `NEXT_PUBLIC_APP_URL` is plain-HTTP localhost. There is no sessions table: logout clears the cookie, and a copied token stays valid until it expires.
- **Auth vs wallet:** "Log out" ends the Circuit session and "Disconnect" ends the wallet-adapter connection. They are separate actions.
- **Server helpers:** `getSession`/`requireSession` (`src/auth/session.ts`) and `getAuthenticatedWallet`/`requireAuthenticatedWallet` (`src/auth/current-wallet.ts`). Later routes must scope every resource to that wallet's id and return NOT_FOUND for foreign resources.
- **Public config reaches client components as props from a Server Component** (e.g. `cluster` into `SolanaProvider`). Client code never imports `src/config/env.ts`.
- **Ownership check on every policy read and mutation:** `policy.wallet_id === session.walletId`. Knowing a UUID is not authorization.
- A Circuit session never grants authority to move funds. Jupiter authorization is separate and explicit.
- **Curated assets only.** Users cannot submit arbitrary mints. Never infer a mint from a ticker. **Do not invent token mints, Pyth feed IDs, Jupiter fields, or transaction signatures.** Every catalog value is sourced from an issuer, Pyth, or Jupiter page, and the source is recorded in `assets.metadata`. Seed assets ship disabled for execution until verified (Architecture §27).
- **State honesty:** never set `ARMED`, `EXECUTED`, or `CANCELLED` before the external source confirms it. If a fill races a cancel, the provider-confirmed fill wins.
- If a provider JWT must be persisted, encrypt it with `CIRCUIT_TOKEN_ENCRYPTION_KEY` and expire it aggressively. (Task 8 does not persist it: see §12, Jupiter auth.)
- `/api/cron/reconcile` requires `Authorization: Bearer ${CRON_SECRET}`.
- Rate-limit nonce creation and provider-backed mutations only with a free managed option. No Redis.
- Public IDs are UUIDs. Never expose sequential IDs.
- Never request or paste secrets into chat, code, tests, fixtures, or commits.

## 11. Jupiter execution modes: mock vs live

Controlled by **`CIRCUIT_JUPITER_MODE=mock|live`**, read only through `src/config/env.ts`.

- **Both modes implement one internal provider interface** (`getAuthChallenge, exchangeSignedChallenge, resolveVault, prepareDeposit, createPriceOrder, getOrder, cancelOrder`). Services depend on the interface, never on a mode check. **Deviation (Task 9, §19):** the live flow needs the user's JWT, a wallet-signed deposit and a two-step withdrawal, so live policies use the Jupiter services in `src/services/jupiter/`; the mock keeps `ExecutionProvider`. Routes dispatch by `policies.provider`.
- **Mock adapter** lives in `src/integrations/jupiter/` and is backed by `tests/fixtures/`. It is used by default for local dev, unit/service tests, and Playwright e2e. Mock data must be **unmistakably fake**: IDs and signatures carry a visible `mock_` prefix and are not valid base58 signatures. Policies record the mode that armed them, and the UI shows a persistent **"SIMULATED — no onchain order"** badge. Mock evidence is never presented as onchain evidence in the demo, README, or screenshots.
- **Live adapter** calls Jupiter Trigger V2 server-side with `JUPITER_API_KEY`. Implement it from **current official Trigger V2 docs only**. Record observed real responses as fixtures (with secrets and JWTs stripped) and derive types from them. Never type provider fields from memory.
- Selecting `live` without the required keys fails fast at startup via env validation. `mock` does not require `JUPITER_API_KEY`.
- Local, preview, and test environments default to `mock`.
- **A deployed hackathon build MAY run `mock`** if mainnet funding is unavailable. **Live mode is preferred for final proof** when it can be completed safely and honestly.
- In mock mode, every execution surface is visibly labelled **SIMULATED / Demo execution**. Mock order IDs, fills, and evidence are **never** presented as real Solana or Jupiter evidence, whether in the UI, README, screenshots, pitch, or submission.
- Mode switching never migrates records: a mock-armed policy is never reconciled against live Jupiter, and the reverse is also true.

**Implemented (Task 6):**
- **Provider contract** is `ExecutionProvider` (`src/integrations/jupiter/types.ts`): `createOrder`/`getOrder`/`cancelOrder` with Circuit-owned DTOs and no Jupiter wire fields. `getExecutionProvider(db)` chooses by mode. **`live` never falls back to `mock`:** until the adapter exists it refuses (`PROVIDER_UNAVAILABLE`) before any state change, and mock-only routes return NOT_FOUND.
- **Mock provider** (`mock.ts`) keeps durable state in `mock_provider_orders` (Arch §5.8, demo infrastructure only).
  - Order ids are `mock_<32 hex>`, enforced by a CHECK.
  - Open orders expire on read once past `expires_at`.
- **Provenance:**
  - Simulated policies store `provider = jupiter_trigger_v2_mock`.
  - Simulated provider events use the `MOCK_PROVIDER` event source, never `JUPITER`.
  - Simulated fills create an `executions` row with `evidence_source = SIMULATED` and NULL `transaction_signature`/`output_amount_atomic`, enforced by a CHECK. Never fabricate a signature, output quantity or explorer link.
- **Lifecycle services:** `arm-policy`, `reconcile-policy`, `cancel-policy`, and `simulate-provider-fill` (mock only). All use the owned-policy lookup, and all go through `policy-lifecycle.ts`, the single place that applies a terminal provider state: a compare-and-set from ARMED, events, and a simulated execution.
- **Arm:**
  - The idempotency key is `circuit_arm_<policyId>`, and the row is locked during DRAFT → ARMING.
  - ARMED is set only after `createOrder` returns.
  - A definitive rejection → FAILED. An ambiguous failure stays ARMING, and a retry resumes with the same key.
- **Cancel:** records CANCELLED only on provider confirmation. If the provider already FILLED/EXPIRED/FAILED, that state wins (outcome `ALREADY_FILLED`, etc.).
- **Demo control:** `POST /api/policies/[id]/mock/simulate-fill` changes *mock provider* state only. Circuit becomes EXECUTED only through reconciliation (the Reconcile button, or page load).
- **UI:** DRAFT in mock mode shows "Arm simulated order" with a SIMULATED badge and the no-funds explanation. In live mode the arm button is disabled with "Live Jupiter execution is not configured yet." Stable `data-testid`s (`policy-status`, `arm-simulated`, `simulate-fill`, `reconcile`, `cancel-simulated`, `provider-order-id`, `simulated-evidence`) are ready for the Playwright flow.

## 12. Provider integration boundaries

**Pyth (`src/integrations/pyth/`, `src/services/get-reference.ts`)**
- **Transport:** `POST {PYTH_BASE_URL}/v1/latest_price` (default `https://pyth-lazer.dourolabs.app`) with `Authorization: Bearer PYTH_API_KEY`, `formats: []`, `parsed: true`. Plain `fetch` + Zod, with no Pyth SDK, WebSocket or stream. The key is server-only (`getServerEnv`), never logged or returned. There is no browser-side Pyth call.
- **Requested properties:** price, exponent, confidence, publisherCount, marketSession, feedUpdateTimestamp, bestBidPrice, bestAskPrice. Bid/ask are experimental in Pyth: display only, never used for safety.
- **Exactness:** `parsePythJson` keeps int64/u64 JSON numbers (e.g. `confidence`, `feedUpdateTimestamp`) as their exact source digits via Node 22 JSON source-text access. `mantissaToDecimal` applies `× 10^exponent` with string math. There are no floats anywhere.
- **Primary reference = underlying equity feed** (`Equity.US.<TICKER>/USD`, `role: "underlying_equity"`). The tokenized stock's own feed (e.g. `Crypto.AAPLX/USD`) may be stored as `comparisonFeeds` (`role: "token_market_comparison"`) and is never the reference. Feeds come only from `src/config/assets.ts` via the asset row, never from a request or a runtime ticker lookup.
- **Freshness** (`src/config/reference.ts`, `mapLatestPrice`):
  - `CARRIED` if `feedUpdateTimestamp < timestampUs` (Pyth's documented carried-forward signal), at any age.
  - Otherwise `STALE` if received more than **`MAX_REFERENCE_AGE_MS` = 3000 ms** after generation, else `FRESH`.
  - `UNAVAILABLE` if the feed is absent, there's no price, the exponent or timestamp is missing, the price is non-positive, or a timestamp is more than 1 s in the future.
  - Rationale: the channel is **`fixed_rate@200ms`**. AAPL's `min_channel` is `fixed_rate@50ms`, and a slower-or-equal cadence is allowed. A new price is at most ~200 ms old at the router, and 3 s covers the REST round trip plus small clock skew while still flagging a stalled feed quickly.
  - `marketSession` (`regular | preMarket | postMarket | overNight | closed`) is context only.
- **Errors:** transport, entitlement, schema or unusable payload → `REFERENCE_UNAVAILABLE` (the reason goes on `cause` for logs). Nothing is cached, and no previous value is ever shown as current.
- **`GET /api/reference/[assetId]`** requires a Circuit session (so it can't be used as an anonymous proxy for our Pyth quota). `GET /api/assets` is public and returns `PublicAsset` fields only.
- **E2E:** there is no fake-Pyth mode. Browser tests may point `PYTH_BASE_URL` at a local fixture server.

**Verified asset: AAPLx (`src/config/assets.ts`)**
- Apple xStock, issuer label "xStocks by Backed". Backed asset id `9e43a778-fdc8-44f1-87de-f2e7420bb7f7`, ISIN CH1436219187, underlying AAPL (ISIN US0378331005, Nasdaq).
- **Solana mint `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`**, Token-2022, **8 decimals**. Sources:
  - `api.backed.fi/api/v2/public/assets` and `/api/v1/token` (Solana deployment);
  - mainnet `getParsedAccountInfo` for decimals;
  - onchain token metadata (name, symbol, `xstocks-metadata.backed.fi` URI).
- **Mint caveats:** `scaledUiAmountConfig` means wallet UI amounts can differ from raw ÷ 10^decimals, so money math must use raw atomic units. The mint also has permanent delegate, pausable and freeze authority.
- **Reference:** `Equity.US.AAPL/USD`, Pyth Pro feed **922** (equity/spot, exponent −5, `min_channel` `fixed_rate@50ms`, stable). Comparison only: `Crypto.AAPLX/USD` feed 1792.
- **Policy UX while blocked:** with no asset that has a live reference, `/policies/new` shows an honest blocked state (verification checklist, no create action). The form, compiler and `POST /api/policies` are fully built and tested with injected fixtures, and go live unchanged once AAPLx passes the live check and is seeded.
- **Status:** execution `PENDING_JUPITER_VERIFICATION`. `verification.pythLiveCheck` = **`NOT_ENTITLED`**: the current key gets 403 for equity feeds and only reads crypto feeds. `pnpm db:seed` therefore skips AAPLx, and Neon has no assets until an equity-entitled key passes `pnpm test:live` and the config is updated to `PASSED`.

**Jupiter (`src/integrations/jupiter/`)**
- Server-side only. Provider DTOs never become DB or domain types. The mapping from provider state to Circuit status exists in **one** place.
- Jupiter owns keeper execution and order lifecycle. Circuit owns intent, reference context, and audit state.

**Jupiter Trigger V2 (verified 2026-09-23, Task 7; `src/integrations/jupiter/`)**
- **Sources:** docs `developers.jup.ag/docs/llms-full.txt` (trigger/*) and OpenAPI `trigger/v2/trigger.yaml` v2.0.0. Trigger V2 is **beta**, so schemas are non-strict (unknown fields ignored).
- **Changelog:** May 2026 made `orderType`/`orderSubType` mandatory on craft-deposit; April 2026 removed `/auth/verify-token`. V1 is not used.
- **Base and auth:** `https://api.jup.ag/trigger/v2`, header `x-api-key`. Auth is `POST /auth/challenge` (message|transaction, 5 min TTL), then the wallet signs, then `POST /auth/verify` (base58 signature) returns a **JWT valid 24h with no refresh endpoint**. It's the same JWT for every call. Never store it in localStorage (Task 8 decision below: HttpOnly cookie only).
- **Flow:** `GET /vault` (404 means none; `GET /vault/register` creates a Privy custodial vault, so do not call it casually) → `POST /deposit/craft` `{inputMint, outputMint, userAddress, amount, orderType:"price", orderSubType:"single"}` returns an **unsigned** tx plus a single-use `requestId` → wallet signs → `POST /orders/price` `{orderType:"single", depositRequestId, depositSignedTx, userPubkey, inputMint, inputAmount, outputMint, triggerMint, triggerCondition, triggerPriceUsd, slippageBps, expiresAt}` returns `{id, txSignature (deposit), depositConfirmed}`.
- **Monitoring and cancel:** `GET /orders/history` (no get-by-id). Cancel is `POST /orders/price/cancel/{id}` (stops fills; unsigned withdrawal) → sign → `POST /orders/price/confirm-cancel/{id}` `{signedTransaction, cancelRequestId}`. Expired orders need the same withdrawal.
- **Mapping** (`toJupiterSinglePriceOrderIntent`, pure; unit-tested for all four directions):
  - `triggerMint` = the stock token (the **output on BUY**, the **input on SELL**).
  - `triggerCondition` = `above|below` from the direction.
  - `inputAmount` = the atomic string.
  - `slippageBps` is always sent (25/50/100 are within 0–10000; this avoids the RTSE/2000 bps defaults).
  - `expiresAt` = UTC `Date.getTime()` in **milliseconds**.
  - Values known at compile time are separate from `depositRequestId`, `depositSignedTx` and `userPubkey` (`toCreatePriceOrderRequest`).
- **Numeric boundary:** `triggerPriceUsd` is a JSON number. `toProviderPriceNumber` converts Circuit's exact decimal string only at this boundary, and refuses anything over 15 significant digits or that doesn't round-trip exactly. The database and domain stay exact strings.
- **Provider minimum:** `JUPITER_TRIGGER_MIN_ORDER_USD = "10"` per order (deposit value at market price). Drafts may be smaller. Live arming must check `meetsProviderMinimum` with a current price **before** asking for a wallet signature.
- **States:** `normalizeJupiterOrderState` maps Jupiter's documented `orderState` to `LIVE_PROVIDER_STATES` (PENDING, OPEN, EXECUTING, FILLED, PENDING_WITHDRAW, CANCELLED, EXPIRED, FAILED). `rawState` values are never mapped. Anything else → UNKNOWN (never guessed). The Circuit mapping is in Task 9 below.
- **Idempotency:** Trigger has no client request id. The deposit `requestId` is the provider idempotency key; persist it before the wallet signs.
- **Token-2022** (`token-compat.ts`): deposit (input) mints with `transferFeeConfig` or `transferHook` are rejected unless whitelisted.
- **AAPLx findings (Task 7):**
  - Tokens V2 exact-mint match: decimals 8, Token-2022, `isVerified`, tags `xstocks`/`stocks`.
  - Quote-only route 10.5 USDC → AAPLx exists. The reverse also quotes.
  - Onchain: **no transferFeeConfig; transferHook present with programId null**. Also permanentDelegate, defaultAccountState, scaledUiAmountConfig, pausable (not paused), confidentialTransferMint, and a freeze authority.
  - **BUY (deposit USDC): compatible per docs. SELL (deposit AAPLx): RESTRICTED unless whitelisted.**
  - The **ScaledUiAmount multiplier is ≈1.00327** (new multiplier active). It is display-only; see the reference basis in Task 9.
- **Proven vs not** (`assets.ts` `jupiter.levels`):
  - PASSED: identity, token recognition, spot route.
  - RESTRICTED: extensions (SELL).
  - PASSED (Task 8 re-probe, 2026-09-23): Trigger API access with our `JUPITER_API_KEY` (challenge 200, no gateway 403).
  - NOT_TESTED: JWT, vault, deposit craft, live order (need the user's wallet signature).
  - Execution stays disabled.
- **Probe:** `pnpm test:jupiter-live` runs the opt-in, no-funds checks and prints a summary. It never signs, never sends a `taker`, and never registers a vault.

**Jupiter auth, vault and deposit preparation (Task 8; Arch §5.9, §8, §11)**
- **Three separate credentials:** CIRCUIT SIGN-IN (`circuit_session`), JUPITER AUTH (`circuit_jupiter_session`), JUPITER VAULT (provider-side Privy vault). The UI names them separately.
- **Auth flow (server-side, session wallet only):** `POST /api/jupiter/auth/challenge` returns Jupiter's `type:"message"` challenge **unchanged** → UI shows it → explicit "Sign Jupiter login" click → `wallet.signMessage` → `POST /api/jupiter/auth/verify {signature: base64}` → server converts to base58 (`bs58`) → Jupiter `/auth/verify` → JWT.
- **JWT storage:** only in the HttpOnly cookie `circuit_jupiter_session` (`<wallet>~<jwt>`, honored only for the matching session wallet), SameSite=Lax, Path=/, Secure except on HTTP localhost, Max-Age 86400. **Never** in the DB, API JSON, logs, `localStorage`/`sessionStorage`, React state, or the Circuit session token. Logger redacts `circuit_jupiter_session`, JWT shapes, challenges and transactions.
- Jupiter 401 → `PROVIDER_AUTH_REQUIRED`, cookie cleared, UI shows expired/reconnect. `POST /api/jupiter/auth/logout` clears only the Jupiter cookie. Circuit logout and a new Circuit sign-in also clear it.
- **Wallet consistency:** UI blocks Jupiter actions when the connected wallet ≠ Circuit session wallet, and explains when the wallet lacks `signMessage`.
- **Vault:** `GET /api/jupiter/status` looks up the vault (404 → NOT_REGISTERED) and never returns the JWT. `POST /api/jupiter/vault/register` is an **explicit click only** (never on page load). 409 is success (existing vault).
- **Live-only UI:** the Jupiter panel renders on the dashboard only in live mode. Mock mode is unchanged; the Jupiter routes refuse with `PROVIDER_UNAVAILABLE` and never call Jupiter.
- **BUY-only live.** SELL is rejected before any craft: "Live AAPLx sell orders are not enabled because the token's transfer-hook deposit path has not been verified with Jupiter Trigger."
- **Deposit preparation** (`POST /api/policies/[id]/jupiter/deposit`): the gates are live mode, JWT, owned unexpired DRAFT, BUY, active asset, `liveBuyDepositGate` (Pyth PASSED + BUY not restricted + reference basis RESOLVED; malformed evidence fails closed), USDC → stock mints, ≥ 10 USD, the wallet's own vault (`GET /vault`), crafted `receiverAddress` = that vault, and fee payer = the wallet. Reservation `PREPARING` row → `/deposit/craft` outside any DB transaction → CAS to `CRAFTED` with the requestId **committed before** the unsigned tx is returned. One active preparation per policy. A failed craft or a stale (>60 s) reservation becomes `INVALIDATED`; an unsubmitted CRAFTED older than 30 s is re-crafted (blockhash freshness). **Production is blocked** (Pyth NOT_ENTITLED).

**Live Jupiter order lifecycle (Task 9; Arch §5.3, §5.5, §5.9, §5.10, §11, §24)**
- **Sequence:** DRAFT → Step 1 "Prepare Jupiter deposit" → Step 2 review → Step 3 explicit **"Authorize deposit & arm"** (`wallet.signTransaction` on the exact prepared `VersionedTransaction`) → `POST /api/policies/[id]/jupiter/arm` → server verifies → one DB tx commits `deposit_tx_signature` (+ transient signed tx) and DRAFT → ARMING → `POST /orders/price` → ARMED only on 200 with `depositConfirmed` and a matching `txSignature` (else ARMING with the order id until history shows it open).
- **BUY-only live.** SELL stays in the domain, compiler and mock, but live SELL fails before craft, signing or create.
- **Reference basis** (`assets.metadata.referenceBasis`, replaces `executionPriceCalibration`): Pyth `Equity.US.AAPL/USD` is the independent policy reference; the compiled USD target goes to Jupiter **unchanged** (`triggerMapping: IDENTITY`, no multiplier, no invented basis adjustment); Jupiter monitors **AAPLx/USD**, a secondary-market price that can trade at a premium or discount to AAPL. The live review must say so. Never claim Pyth controls Jupiter's trigger. Evidence: Jupiter Price V3 `usdPrice` is the scaled per-displayed-token price (`usdPricePrescaled` is separate).
- **Signing boundaries:** wallets sign only on two explicit clicks: "Authorize deposit & arm" and "Confirm withdrawal". Never on page load, refresh, reconcile or in an effect. No private keys, no server-side signing, no `sendTransaction`: Circuit forwards verified signed transactions to Jupiter, which lands them. A boundary test enforces this.
- **Signed-tx integrity** (`signed-transaction.ts`): identical message bytes to the persisted unsigned tx, the wallet's Ed25519 signature verifies, no other signature slot changed, canonical bytes. Reject modified, wrong-signer, unsigned, malformed or another preparation's transactions. Never log transaction bodies.
- **Recovery/idempotency:** timeout/network/5xx/malformed/duplicate-deposit on create = AMBIGUOUS → stay ARMING, never a new deposit or signature. Reconcile finds the order by the persisted deposit signature + wallet + mints + amount (one → recover; zero → pending; several → `PROVIDER_ORDER_AMBIGUOUS`). Only documented pre-landing rejections (400 non-duplicate, 403) → FAILED. 401 → clear the Jupiter cookie; after re-auth, "Resubmit signed deposit" resends the stored signed tx (≥ 60 s after the last attempt, history checked first). First submission is a CAS, so concurrent arms create one order.
- **Provider state** (`policies.provider_state`): pending → ARMING; open/executing/pending_withdraw → ARMED (the UI shows EXECUTING / cancellation pending); filled → EXECUTED; cancelled → CANCELLED; expired → EXPIRED; failed → FAILED. Partial fills stay ARMED + EXECUTING with provider-reported progress only. Terminal states never move.
- **Evidence:** ONCHAIN execution only with Jupiter's `inputUsed`, `outputAmount` and a genuine fill signature; `transaction_signature` = latest successful fill (never the deposit); `fill_json.fills` keeps every fill. Solscan links only for real 64-byte signatures.
- **Cancellation:** "Cancel & withdraw" → history check (a fill wins) → `POST /orders/price/cancel/{id}` (fills stop; unsigned withdrawal persisted in `jupiter_cancel_preparations`) → explicit "Confirm withdrawal" → verified → `confirm-cancel` → CANCELLED. Timeouts/401 keep it retryable with the same signed withdrawal; a 400 requires re-initiating. Expired orders use the same flow but stay EXPIRED (`FUNDS_WITHDRAWN`). Never EXECUTED → CANCELLED.
- **Pyth entitlement blocker:** AAPLx `pythLiveCheck` stays `NOT_ENTITLED` until `pnpm test:live` passes with an equity-entitled key, so production cannot seed AAPLx, create AAPLx policies, or arm live. Do not weaken this gate for testing; tests use fixture assets. This blocker does not apply to PreStocks assets.

**PreStocks (Task 10; Arch §10, §10.1, §27). The FINAL feature expansion: after it, feature freeze.**
- **Endpoint:** `GET https://prestocks.com/api/prestocks` (first-party, public, no key; never invent a `PRESTOCKS_API_KEY`). Fields: name, symbol, description, image, external_url, contract_address, markPrice, markValuation, tokenPrice, impliedValuation, supply. No timestamps. Items are validated one by one; exact JSON digits preserved.
- **Semantics:** "PreStocks mark" (Mark Price) = benchmark/reference; "Token market price" (Token Price) = onchain token price. Premium/discount to mark = (token − mark)/mark × 100 with decimal.js, 2 dp. Neutral wording only ("premium", "discount"; never undervalued/opportunity). The mark is not an oracle and not a redemption guarantee. Disclose: economic exposure only (no ownership/voting rights), risky, token may differ from mark, not available to U.S. persons.
- **Reference-provider abstraction:** `assets.reference_provider` (PYTH | PRESTOCKS) decides; `getAssetReference` switches; `defaultReferenceClients()` supplies both clients to every production caller; no fallback between providers. Policies store `reference_provider`, `reference_usd`, `reference_timestamp`, `reference_snapshot_json` (the `pyth_*` policy columns are gone). PreStocks freshness = `CURRENT_RESPONSE` (received time, not a source time).
- **Selected technical candidate: ANTHROPIC**, mint `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw`, Token-2022, 9 decimals. Chosen on technical quality only (deepest Jupiter liquidity of the six products passing every no-funds check on 2026-09-24). Jupiter exact-mint PASS, USDC route PASS, BUY deposit rule PASS (live craft NOT TESTED). **SELL restricted** (transferFeeConfig 100 bps + transferHook on the deposit mint): live SELL disabled. The token carries a 1% Token-2022 transfer fee (disclosed in the live review).
- **Excluded:** SPACEX (first-party lifecycle notice: gone public, must be swapped before 12 March 2027); OPENAI (not returned by Jupiter exact-mint search; pending ScaledUiAmount multiplier change). Other current products are ROUTE_VERIFIED on /markets but not enabled.
- **Seed:** ANTHROPIC seeds on its own gates (PreStocks check + Jupiter recognition + route + BUY rule + live catalog still lists the exact mint). AAPLx still skips while Pyth is NOT_ENTITLED. Never seed the whole catalog; no Tessera or non-PreStocks tokens.
- **Live money:** ANTHROPIC BUY reuses the Task 9 lifecycle unchanged (triggerMint = ANTHROPIC, target = mark-relative compiled USD, no conversion formula). In live mode the prepare/authorize path is reachable for it, always behind Jupiter auth and an explicit wallet signature. No funded PreStocks order has been placed.

**Reconciliation (Vercel Hobby constraint)**
- Reconciliation runs on **policy page load**, **manual "Refresh status"**, and **after cancel completion**. This is the primary path for the hackathon.
- `app/api/cron/reconcile/route.ts` still exists (CRON_SECRET-protected) and can be invoked manually. Do not rely on minute-level Vercel Cron, because Hobby does not guarantee it. If a schedule is configured, it runs at most daily and serves only as a backstop.
- Reconciliation is idempotent: conditional update from `ARMED`, `executions.policy_id` is unique, and unchanged provider state means no write.
- The UI states that Jupiter keeps executing while Circuit is offline, and that Circuit's view updates on the next refresh.

**Pyth in browser/E2E tests**
- There is **no fake-Pyth production mode**. Browser/E2E tests point the existing `PYTH_BASE_URL` at a local, deterministic fixture HTTP server. The server code path is identical in every environment.

**Database (Neon)**
- Use `@neondatabase/serverless` with Drizzle's **`neon-serverless`** driver (Pool/WebSocket) for flows that need interactive transactions and row locks: policy creation, arming, and reconciliation (`SELECT … FOR UPDATE` / compare-and-set).
- **Do not use `neon-http`** for transaction-sensitive flows.
- Verified in Task 2: Node 22's global `WebSocket` works with the Neon `Pool`, so `ws` is **not** installed.
- `src/db/client.ts` connects lazily on first `getDb()` call, so importing it never contacts Neon and `next build`/unit tests stay offline.
- Repositories take a `DbExecutor` (database or open transaction) as their first argument. Services own transaction scope: `getDb().transaction(tx => …)`.
- `policy_events` is append-only, enforced by database triggers that reject UPDATE, DELETE and TRUNCATE. Record corrections as new events.
- Expect Neon free-tier cold starts, and do not treat the first slow query as an outage.

## 13. Commands

Scripts marked ✅ exist and work. The others are added in the milestone that introduces their tooling. Do not add placeholder scripts that don't work.

| Purpose | Command |
|---|---|
| ✅ Install | `pnpm install --frozen-lockfile` |
| ✅ Dev server | `pnpm dev` |
| ✅ Lint | `pnpm lint` (ESLint CLI with `--max-warnings=0`; Next.js 16 no longer ships `next lint`) |
| ✅ Typecheck | `pnpm typecheck` (`next typegen && tsc --noEmit`; typegen creates the route types `tsc` needs) |
| ✅ Unit + service tests | `pnpm test` (Vitest run) / `pnpm test:watch` |
| ✅ Live provider checks (opt-in) | `pnpm test:live` (Pyth: symbology match, key entitlement, live mapping), `pnpm test:jupiter-live` (Jupiter: key, exact-mint token, onchain extensions, quote-only route, auth challenge) and `pnpm test:prestocks-live` (PreStocks catalog, lifecycle notices, onchain mints, Jupiter exact-mint + quote-only route, BUY/SELL deposit rules, curated candidate). All NO FUNDS: no taker, no signing, no craft, no order. They load `.env.local`. Never part of `pnpm test` or CI. |
| ✅ Repository tests (isolated in-process Postgres) | included in `pnpm test`; `tests/integration/` runs the committed migrations on PGlite, never Neon |
| E2E | `pnpm test:e2e` (Playwright, mock wallet + mock Jupiter) |
| ✅ Build | `pnpm build` |
| ✅ Generate migration | `pnpm db:generate` (drizzle-kit generate from `src/db/schema.ts` into `src/db/migrations/`; `--custom --name x` for hand-written SQL such as triggers) |
| ✅ Apply migrations | `pnpm db:migrate` (`src/db/migrate.ts`: Drizzle migrator over the Neon WebSocket driver; prints database name and tables, never the URL) |
| ✅ Seed catalog | `pnpm db:seed` (`src/db/seed.ts`: upserts only entries in `src/config/assets.ts`, which is empty until assets are verified) |
| Pre-commit gate | `pnpm typecheck && pnpm lint && pnpm test && pnpm build && git diff --check` |

Never run `db:migrate` against production without the user's explicit go-ahead. Never use `drizzle-kit push` against shared databases.

## 14. Git rules

- Default branch `main`. Do not commit or push unless the user asks.
- Commits are **milestone-scoped** (Architecture §32), e.g. `m1: drizzle schema + wallet session`. No unrelated refactors in the same commit.
- Before any commit: run the full gate in §13, including `git diff --check`.
- Schema changes are committed together with their generated Drizzle migration. No ad-hoc production schema edits.
- Architecture changes are committed together with the matching edit to `CIRCUIT_ARCHITECTURE.md`.
- Never commit `.env*` files except `.env.example`. Never commit secrets, JWTs, cookies, or unredacted provider responses.
- No force-push to `main`, no history rewrites of pushed commits, no `--no-verify`.
- End commit messages with the attribution line the session provides.

## 15. Dependency rules

- **No new dependency without a one-line justification** of why the current stack can't meet the requirement (Architecture §30.2). Ask the user before adding anything outside the §2 stack.
- Pin **exact** versions (`save-exact`), commit `pnpm-lock.yaml`, and install with `--frozen-lockfile` in CI and Vercel.
- Never silently upgrade Next.js, React, wallet, Solana, Jupiter, or Pyth packages mid-build.
- Prefer platform APIs (Web Crypto, `fetch`, `crypto.randomUUID`) over packages.
- No custom Solana program, and none of the forbidden items in §2.
- Install packages only in the milestone that uses them. Planned later additions: `decimal.js` (policy compiler), `drizzle-orm` + `drizzle-kit` + `@neondatabase/serverless` (database), `@solana/web3.js` + `@solana/wallet-adapter-{base,react,react-ui}` (wallet), `@playwright/test` (e2e), Testing Library (first component test). Never add `@solana/wallet-adapter-wallets`.

## 16. Environment-variable rules

- All access goes through `src/config/env.ts`, a Zod schema that validates at startup and fails fast. Never read `process.env` anywhere else.
- Separate the server schema from the client schema. Only `NEXT_PUBLIC_*` values may reach the browser, and **no secret is ever `NEXT_PUBLIC_`**.
- `.env.example` lists every variable with placeholder values only and is committed. Real values live in `.env.local` (git-ignored) and Vercel project env.

| Variable | Scope | Notes |
|---|---|---|
| `DATABASE_URL` | server | Neon connection string |
| `CIRCUIT_SESSION_SECRET` | server | cookie signing |
| `CIRCUIT_TOKEN_ENCRYPTION_KEY` | server | encrypts persisted provider JWTs |
| `JUPITER_API_KEY` | server | required when `CIRCUIT_JUPITER_MODE=live` |
| `PYTH_API_KEY` | server | Pyth Pro |
| `CRON_SECRET` | server | protects `/api/cron/reconcile` |
| `CIRCUIT_JUPITER_MODE` | server | `mock` \| `live` (see §11 and §19) |
| `JUPITER_TRIGGER_BASE_URL` | server, optional | only if the client needs an explicit base |
| `PYTH_BASE_URL` | server, optional | only if the client needs an explicit base |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | public | e.g. `mainnet-beta` |
| `NEXT_PUBLIC_APP_URL` | public | used in the wallet login message domain |

Never ask the user to paste secrets into chat. Point them to `.env.local` or `vercel env`.

## 17. Testing rules

- The highest-risk code is anything that can compile the wrong price, spend the wrong amount, reverse buy/sell, mis-map provider state, or claim a fill that didn't happen. That code gets the most tests.
- Every policy behaviour change comes with unit tests. The domain has no mocks because it is pure.
- Service tests use injected fakes for repositories and providers, and cover the Architecture §23 list (stale reference blocks relative compile, ownership enforced, never ARMED before provider success, idempotent arm, reconcile terminalizes once, cancel only after confirmation).
- Integration tests use an isolated Postgres (PGlite in-process, or a Neon branch if ever needed), never the production database. Test fixtures use unmistakably fictional values (`TEST_MINT_NOT_REAL_…`) and live only under `tests/`.
- External APIs use fixtures by default. One opt-in live provider test may run manually and never runs in CI.
- Playwright covers the critical path with mock wallet + mock provider: create draft → review → arm → ARMED → mocked fill → reconcile → EXECUTED.

## 18. Definition of demo-ready

Demo-ready means **all** of the following hold on the deployed Vercel URL. `live` mode is preferred. If mainnet funding is unavailable, `mock` mode is acceptable only with the §11 labelling.

1. Wallet connects. Login is by signed message and uses an HttpOnly session.
2. The catalog shows 2–4 **verified** tokenized stocks, each with a sourced mint, decimals, and Pyth feed ID, with USDC configured as the input asset.
3. The Pyth reference renders server-side with feed timestamp and freshness label, and CARRIED/STALE are visibly distinct.
4. A relative policy compiles to a fixed USD trigger using exact decimal math, and all four directions (BUY/SELL × ABOVE/BELOW) can be created.
5. The review screen states the policy in one plain-English sentence. Every wallet signature is explained before it is requested.
6. The Jupiter auth/deposit/order flow completes (live, or clearly labelled SIMULATED in mock), and `ARMED` is shown only after the provider adapter returns an order ID, which is then persisted.
7. Closing or reloading the browser does not affect the order. Status reconciles on page load and on manual refresh.
8. Cancellation works and shows `CANCELLED` only after provider confirmation.
9. Preferred: at least one **tiny live execution**, or an equally verifiable live order, with a real transaction signature linked to an explorer. If this isn't achieved, the demo and submission say so plainly and show only SIMULATED evidence.
10. The audit timeline shows every material transition with its source (USER/CIRCUIT/JUPITER/SOLANA/SYSTEM).
11. No private key, API key, or JWT is present in client bundles, logs, or the repo.
12. Typecheck, lint, unit/service tests, e2e, build, and `git diff --check` all pass.
13. README, pitch, and submission copy accurately state what Pyth and Jupiter each enforce, and every sponsor claim matches the implementation.
14. Mock-mode artifacts are always labelled SIMULATED / Demo execution and never appear in materials presented as real Solana/Jupiter evidence.

## 19. Deliberate deviations from the source docs (user-approved)

| Topic | Source doc says | This repo does | Why |
|---|---|---|---|
| Background sync | Vercel Cron once per minute (Arch §2, §25) | Reconcile on page load, manual refresh, and after cancel. Cron route kept for manual/daily backstop only. | Vercel Hobby cannot be assumed to support minute-level cron. Free-tier constraint. |
| Jupiter mode switch | Not specified | `CIRCUIT_JUPITER_MODE=mock\|live` env var plus a mock adapter. A deployed build may run mock if clearly labelled SIMULATED (§11). | Enables e2e, local dev, and an honest demo without mainnet funds. Needs a matching update to Arch §19 when implemented. |
| `JUPITER_API_KEY` | Listed as required | Required only in `live` mode | Mock mode must run without provider credentials. |
| Simulated execution | Not specified | `mock_provider_orders` table; `MOCK_PROVIDER` event source; `executions.evidence_source` with nullable signature/output for SIMULATED rows | Durable demo lifecycle without conflating mock state with Circuit state or fabricating Solana evidence. Documented in Arch §5.4, §5.5, §5.8 and §11. |
| `policy_events` columns | id, policy_id, event_type, source, payload, created_at | Adds `sequence_number` (bigint identity). `created_at` defaults to `clock_timestamp()`. Events are ordered by (created_at, sequence_number). | Several events written in one transaction can share a timestamp, so the audit trail needs a database-assigned tie-breaker to keep insertion order. |
| Live provider interface | One provider interface for both modes (§11) | Live policies use `src/services/jupiter/*` (JWT + wallet-signed deposit + two-step withdrawal); the mock keeps `ExecutionProvider` | The live flow cannot be expressed as `createOrder/getOrder/cancelOrder` without a user signature and JWT. Documented in Arch §11. |
| Signed deposit persistence | Arch §5.9 (Task 8): never stored | Stored only while submission is unresolved, cleared on CONSUMED/INVALIDATED | Allows the documented idempotent create retry after a 401 or ambiguous failure without a second wallet signature. Documented in Arch §5.9. |
| Policy checks | Constraints listed in Arch §5.3 | Also: `max_slippage_bps` between 0 and 10000 (structural bound only), non-negative execution amounts, `decimals` 0–255 | Cheap structural guards. The product's allowed slippage range is still decided in Milestone 3. |

These should be recorded in `CIRCUIT_ARCHITECTURE.md` when the user authorizes editing it.

## 20. Resolved decisions

- **Wallet:** `@solana/web3.js` + `@solana/wallet-adapter-{base,react,react-ui}`, with Wallet Standard discovery via `wallets={[]}`. No `@solana/wallet-adapter-wallets`. Installed in Task 3; versions are in §2.
- **Auth nonces:** persisted in `auth_nonces` (hash only), not a stateless cookie, so single use holds on serverless (Arch §5.7). `wallet_auth_sessions` stays reserved for provider auth.
- **Pyth in E2E:** a local fixture HTTP server set as `PYTH_BASE_URL`. No fake-Pyth app mode.
- **Neon:** `@neondatabase/serverless` + Drizzle `neon-serverless` for transactional flows. No `neon-http` there. `ws` only if Node 22's WebSocket proves insufficient.
- **Tooling:** pnpm 11.5.1 as installed.
- **Mock in deployment:** allowed with SIMULATED labelling, and live is preferred for final proof (§11).
- **Jupiter JWT (Task 8):** HttpOnly `circuit_jupiter_session` cookie only; not persisted, so there is no `wallet_auth_sessions` table. The deposit requestId is persisted in `jupiter_deposit_preparations` before signing.

## 21. Open questions (resolve before the milestone that needs them)

1. **Compiler rounding:** rounding mode and decimal places per side/direction, bounded by Jupiter's accepted trigger precision (from docs). Needed by Milestone 3.
2. **Slippage bounds:** configured min/max bps. Needed by Milestone 3.
3. Architecture §33 verification items: which stock mints Jupiter Trigger V2 supports, matching Pyth feeds, JWT lifetime and persistence, partial-fill and terminal semantics, and Pyth sponsor requirements.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
