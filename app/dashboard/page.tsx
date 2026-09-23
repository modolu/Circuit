import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

const POLICY_COLUMNS = ["Asset", "Side", "Trigger", "Status", "Expires (UTC)"];

const EXECUTION_STACK = [
  {
    role: "Reference data",
    provider: "Pyth",
    body: "Independent equity reference price and freshness for each supported stock. A stale reference blocks relative triggers.",
  },
  {
    role: "Execution rail",
    provider: "Jupiter Trigger",
    body: "Holds the authorized order and executes it when the trigger condition is met, whether or not Circuit is online.",
  },
  {
    role: "Settlement",
    provider: "Solana",
    body: "Final settlement for every fill, recorded in Circuit with its transaction signature.",
  },
] as const;

function NotConnected() {
  return (
    <p className="mt-auto flex items-center gap-2 pt-6 text-sm text-muted">
      <span aria-hidden="true" className="size-2.5 rounded-full border border-muted" />
      Not connected in this build
    </p>
  );
}

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
      <h1 className="text-3xl font-medium tracking-[-0.02em]">Dashboard</h1>
      <p className="mt-3 max-w-[40rem] leading-relaxed text-muted">
        Your execution policies and their current state will appear here.
      </p>

      <section
        aria-labelledby="wallet-heading"
        className="mt-10 rounded-lg border border-rule bg-panel px-6 py-10 sm:px-10 sm:py-12"
      >
        <h2 id="wallet-heading" className="text-xl font-medium">
          Connect a Solana wallet to create a policy.
        </h2>
        <p className="mt-3 max-w-[38rem] leading-relaxed text-muted">
          Your wallet is your Circuit identity. Circuit will never ask for your seed phrase or
          private keys.
        </p>
        <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
          <button
            type="button"
            disabled
            aria-describedby="wallet-unavailable"
            className="inline-flex h-11 cursor-not-allowed items-center rounded-md border border-rule px-5 text-[0.9375rem] font-medium text-muted"
          >
            Connect wallet
          </button>
          <p id="wallet-unavailable" className="text-sm text-muted">
            Wallet connection isn&apos;t available in this build yet.
          </p>
        </div>
      </section>

      <section aria-labelledby="policies-heading" className="mt-14">
        <h2 id="policies-heading" className="text-lg font-medium">
          Policies
        </h2>
        <div className="mt-4 overflow-x-auto rounded-lg border border-rule">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-rule text-muted">
              <tr>
                {POLICY_COLUMNS.map((column) => (
                  <th key={column} scope="col" className="px-5 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={POLICY_COLUMNS.length} className="px-5 py-10 text-center text-muted">
                  No policies yet. Policies you create after connecting a wallet are listed here.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="stack-heading" className="mt-14">
        <h2 id="stack-heading" className="text-lg font-medium">
          Execution stack
        </h2>
        <p className="mt-2 max-w-[40rem] text-sm leading-relaxed text-muted">
          Each layer has one job. Circuit connects them. It doesn&apos;t replace them.
        </p>
        <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-3">
          {EXECUTION_STACK.map((layer) => (
            <article key={layer.role} className="flex flex-col bg-ink p-6">
              <p className="text-sm text-muted">{layer.role}</p>
              <h3 className="mt-1 text-lg font-medium">{layer.provider}</h3>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{layer.body}</p>
              <NotConnected />
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
