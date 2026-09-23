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
| Database | Neon PostgreSQL (free tier) |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Validation | Zod 4 at every external boundary |
| Money | `bigint` for atomic token amounts, `decimal.js` for USD values. Never `number` for money. |
| Wallet | `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react`, `@solana/wallet-adapter-react-ui` with Wallet Standard discovery via `wallets={[]}`. **Do not add `@solana/wallet-adapter-wallets`.** (Installed when wallet work begins.) |
| Solana client | `@solana/web3.js`, for addresses, signatures, and transactions only |
| Reference data | Pyth Pro REST, server-side only, on demand (no Circuit-owned WebSocket) |
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
│   ├── dashboard/page.tsx
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
│       ├── jupiter/auth/...
│       └── cron/reconcile/route.ts
├── components/                  # presentation + browser interaction; no secrets
│   ├── wallet/  policy/  asset/  ui/
├── src/
│   ├── domain/                  # pure: policy.ts money.ts asset.ts errors.ts
│   ├── services/                # use cases: create/compile/arm/cancel/reconcile-policy.ts, get-reference.ts
│   ├── integrations/
│   │   ├── pyth/                # client.ts mapper.ts types.ts
│   │   └── jupiter/             # client.ts auth.ts trigger.ts types.ts (+ mock adapter, see §11)
│   ├── db/                      # client.ts schema.ts repositories/ migrations/
│   ├── auth/                    # wallet-message.ts verify-wallet.ts session.ts
│   ├── validation/              # policy.ts api.ts (Zod schemas)
│   ├── config/                  # env.ts assets.ts
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

- Tailwind CSS 4, CSS-first. Define design tokens with `@theme` in `app/globals.css`. Do not create a JS Tailwind config unless a plugin forces it.
- Brand direction (Brief §24): precision, control, infrastructure. Restrained palette, generous whitespace. No casino neon, meme art, giant candlesticks, or "AI magic" gradients. A screenshot should explain the product.
- Use `tabular-nums` for every price, amount, and percentage. Use a monospace font for addresses, mints, feed IDs, and signatures (truncated in the middle, with a copy button showing the full value).
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
- **Wallet login:** single-use nonce. The signed message includes domain, wallet, nonce, issued-at, expiry, chain, and purpose. The session is an HttpOnly, Secure, SameSite=Lax cookie.
- **Ownership check on every policy read and mutation:** `policy.wallet_id === session.walletId`. Knowing a UUID is not authorization.
- A Circuit session never grants authority to move funds. Jupiter authorization is separate and explicit.
- **Curated assets only.** Users cannot submit arbitrary mints. Never infer a mint from a ticker. **Do not invent token mints, Pyth feed IDs, Jupiter fields, or transaction signatures.** Every catalog value is sourced from an issuer, Pyth, or Jupiter page, and the source is recorded in `assets.metadata`. Seed assets ship disabled for execution until verified (Architecture §27).
- **State honesty:** never set `ARMED`, `EXECUTED`, or `CANCELLED` before the external source confirms it. If a fill races a cancel, the provider-confirmed fill wins.
- If a provider JWT must be persisted, encrypt it with `CIRCUIT_TOKEN_ENCRYPTION_KEY` and expire it aggressively.
- `/api/cron/reconcile` requires `Authorization: Bearer ${CRON_SECRET}`.
- Rate-limit nonce creation and provider-backed mutations only with a free managed option. No Redis.
- Public IDs are UUIDs. Never expose sequential IDs.
- Never request or paste secrets into chat, code, tests, fixtures, or commits.

## 11. Jupiter execution modes: mock vs live

Controlled by **`CIRCUIT_JUPITER_MODE=mock|live`**, read only through `src/config/env.ts`.

- **Both modes implement one internal provider interface** (`getAuthChallenge, exchangeSignedChallenge, resolveVault, prepareDeposit, createPriceOrder, getOrder, cancelOrder`). Services depend on the interface, never on a mode check.
- **Mock adapter** lives in `src/integrations/jupiter/` and is backed by `tests/fixtures/`. It is used by default for local dev, unit/service tests, and Playwright e2e. Mock data must be **unmistakably fake**: IDs and signatures carry a visible `mock_` prefix and are not valid base58 signatures. Policies record the mode that armed them, and the UI shows a persistent **"SIMULATED — no onchain order"** badge. Mock evidence is never presented as onchain evidence in the demo, README, or screenshots.
- **Live adapter** calls Jupiter Trigger V2 server-side with `JUPITER_API_KEY`. Implement it from **current official Trigger V2 docs only**. Record observed real responses as fixtures (with secrets and JWTs stripped) and derive types from them. Never type provider fields from memory.
- Selecting `live` without the required keys fails fast at startup via env validation. `mock` does not require `JUPITER_API_KEY`.
- Local, preview, and test environments default to `mock`.
- **A deployed hackathon build MAY run `mock`** if mainnet funding is unavailable. **Live mode is preferred for final proof** when it can be completed safely and honestly.
- In mock mode, every execution surface is visibly labelled **SIMULATED / Demo execution**. Mock order IDs, fills, and evidence are **never** presented as real Solana or Jupiter evidence, whether in the UI, README, screenshots, pitch, or submission.
- Mode switching never migrates records: a mock-armed policy is never reconciled against live Jupiter, and the reverse is also true.

## 12. Provider integration boundaries

**Pyth (`src/integrations/pyth/`)**
- Pyth Pro REST, called on demand server-side with `PYTH_API_KEY`. No browser calls and no Circuit-owned stream.
- `mapper.ts` converts payloads to the internal `EquityReference` (`feedId, priceUsd, confidenceUsd?, bestBidUsd?, bestAskUsd?, feedUpdateTimestamp, receivedTimestamp, isCarriedForward, session?`) and a freshness label `FRESH | CARRIED | STALE | UNAVAILABLE`.
- STALE or UNAVAILABLE blocks relative-policy compilation. CARRIED data is never labelled live.
- Feed IDs come only from the verified catalog. Endpoint paths, field names, and freshness semantics come from current Pyth Pro docs.

**Jupiter (`src/integrations/jupiter/`)**
- Server-side only. Provider DTOs never become DB or domain types. The mapping from provider state to Circuit status exists in **one** place.
- Jupiter owns keeper execution and order lifecycle. Circuit owns intent, reference context, and audit state.

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
- Do not install `ws` pre-emptively. Node 22 ships a global `WebSocket`, so verify it works with the Neon driver first and add `ws` only if it doesn't.
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
| Integration tests (isolated Postgres) | `pnpm test:integration` |
| E2E | `pnpm test:e2e` (Playwright, mock wallet + mock Jupiter) |
| ✅ Build | `pnpm build` |
| Generate migration | `pnpm db:generate` (drizzle-kit generate) |
| Apply migrations | `pnpm db:migrate` (drizzle-kit migrate) |
| Seed catalog | `pnpm db:seed` (runs `src/db/seed.ts`; verified assets only, execution disabled until verified) |
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
- Integration tests use an isolated Postgres (a Neon branch or local container), never the production database.
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

These should be recorded in `CIRCUIT_ARCHITECTURE.md` when the user authorizes editing it.

## 20. Resolved decisions

- **Wallet:** `@solana/web3.js` + `@solana/wallet-adapter-{base,react,react-ui}`, with Wallet Standard discovery via `wallets={[]}`. No `@solana/wallet-adapter-wallets`.
- **Pyth in E2E:** a local fixture HTTP server set as `PYTH_BASE_URL`. No fake-Pyth app mode.
- **Neon:** `@neondatabase/serverless` + Drizzle `neon-serverless` for transactional flows. No `neon-http` there. `ws` only if Node 22's WebSocket proves insufficient.
- **Tooling:** pnpm 11.5.1 as installed.
- **Mock in deployment:** allowed with SIMULATED labelling, and live is preferred for final proof (§11).

## 21. Open questions (resolve before the milestone that needs them)

1. **Compiler rounding:** rounding mode and decimal places per side/direction, bounded by Jupiter's accepted trigger precision (from docs). Needed by Milestone 3.
2. **Slippage bounds:** configured min/max bps. Needed by Milestone 3.
3. Architecture §33 verification items: which stock mints Jupiter Trigger V2 supports, matching Pyth feeds, JWT lifetime and persistence, partial-fill and terminal semantics, and Pyth sponsor requirements.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
