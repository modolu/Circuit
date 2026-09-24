"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * Fallback for unexpected server/render errors (e.g. a transient database failure).
 * Shows no stack trace or provider detail; the digest lets the server log be found.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
      <Card as="section" aria-labelledby="error-heading" className="px-5 py-10 sm:px-8">
        <SectionLabel>Something went wrong</SectionLabel>
        <h1 id="error-heading" className="mt-3 text-lg font-semibold">
          Circuit could not load this page right now.
        </h1>
        <p className="mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted">
          This is usually temporary. Your policies and any Jupiter orders are unaffected: orders keep running at Jupiter
          even when Circuit is unavailable.
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <Button variant="primary" onClick={() => retry()}>
            Try again
          </Button>
          <ButtonLink href="/dashboard">Go to dashboard</ButtonLink>
        </div>
        {error.digest && <p className="mt-4 font-mono text-[11px] text-muted">Reference: {error.digest}</p>}
      </Card>
    </main>
  );
}
