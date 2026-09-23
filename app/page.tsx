import type { CSSProperties } from "react";
import Link from "next/link";

const PIPELINE = [
  {
    title: "User policy",
    owner: "Set by you, signed by your wallet",
    body: "One asset, one side, one amount, a USD trigger, a slippage ceiling and an expiry. Nothing outside those bounds.",
  },
  {
    title: "Pyth reference",
    owner: "Pyth Network equity feed",
    body: "An independent reference price with its freshness. Relative triggers compile from it, and stale data blocks them.",
  },
  {
    title: "Jupiter execution",
    owner: "Jupiter Trigger order",
    body: "The policy becomes a trigger order that executes when the condition is met, without Circuit or your browser staying open.",
  },
  {
    title: "Solana evidence",
    owner: "Settled onchain",
    body: "Fills settle on Solana. Circuit records the transaction signature and every state change in an audit trail.",
  },
] as const;

const USER_DECIDES = [
  ["Asset", "A tokenized stock from a verified catalog"],
  ["Amount", "USDC to spend, or tokens to sell"],
  ["Trigger", "A USD price, fixed or relative to the Pyth reference"],
  ["Slippage ceiling", "The worst price impact you accept, in basis points"],
  ["Expiry", "An explicit time after which the order stops"],
] as const;

const CIRCUIT_NEVER = [
  "Picks an investment or suggests what to buy",
  "Asks for or stores your seed phrase or private keys",
  "Raises your spend, changes the asset or extends the expiry",
  "Reports a fill before the execution provider and Solana confirm it",
];

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto w-full max-w-6xl px-5 pt-16 pb-20 sm:px-8 sm:pt-20 sm:pb-24">
        <p className="text-lg font-medium text-trace">Circuit</p>
        <h1 className="mt-4 max-w-[17ch] text-[2.5rem] leading-[1.08] font-medium tracking-[-0.025em] text-balance sm:text-[4rem]">
          Programmable execution for stocks that never sleep.
        </h1>
        <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-muted sm:text-xl">
          The user chooses the investment. Circuit handles the execution path.
        </p>
        <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center rounded-md bg-trace px-5 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-text"
          >
            Open dashboard
          </Link>
          <p className="max-w-[28rem] text-sm leading-relaxed text-muted">
            Hackathon build in progress. Wallet, Pyth and Jupiter connections are being added
            one milestone at a time.
          </p>
        </div>
      </section>

      <section aria-labelledby="pipeline-heading" className="border-t border-rule bg-panel">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
          <h2 id="pipeline-heading" className="text-2xl font-medium tracking-[-0.01em]">
            How a policy runs
          </h2>
          <p className="mt-3 max-w-[36rem] leading-relaxed text-muted">
            Circuit is the policy layer. Market data, execution and settlement stay with the
            infrastructure built for them.
          </p>

          <ol className="mt-12 grid gap-0 md:grid-cols-4">
            {PIPELINE.map((step, index) => (
              <li
                key={step.title}
                className="relative pb-12 pl-9 md:pr-8 md:pb-0 md:pl-0 md:pt-10"
                style={{ "--i": index } as CSSProperties}
              >
                <span aria-hidden="true" className="trace-node" />
                {index < PIPELINE.length - 1 && (
                  <span aria-hidden="true" className="trace-segment" />
                )}
                <p className="font-mono text-xs text-muted">Step {index + 1}</p>
                <h3 className="mt-2 text-lg font-medium">{step.title}</h3>
                <p className="mt-1 text-sm text-trace">{step.owner}</p>
                <p className="mt-4 max-w-[30ch] text-[0.9375rem] leading-relaxed text-muted">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        aria-label="Bounded authority"
        className="mx-auto grid w-full max-w-6xl gap-16 px-5 py-20 sm:px-8 md:grid-cols-[1.25fr_1fr] md:gap-20"
      >
        <div>
          <h2 className="text-2xl font-medium tracking-[-0.01em]">You set every bound</h2>
          <dl className="mt-8 border-t border-rule">
            {USER_DECIDES.map(([term, detail]) => (
              <div
                key={term}
                className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[10rem_1fr] sm:gap-6"
              >
                <dt className="text-[0.9375rem] font-medium">{term}</dt>
                <dd className="text-[0.9375rem] leading-relaxed text-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h2 className="text-2xl font-medium tracking-[-0.01em]">Circuit never</h2>
          <ul className="mt-8 space-y-4">
            {CIRCUIT_NEVER.map((item) => (
              <li key={item} className="flex gap-4 text-[0.9375rem] leading-relaxed text-muted">
                <span aria-hidden="true" className="mt-[0.7rem] h-px w-4 shrink-0 bg-muted" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
