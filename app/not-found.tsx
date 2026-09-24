import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

/** Unknown routes and policies that don't exist or belong to another wallet (never distinguished). */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-24 sm:px-6">
      <Card as="section" aria-labelledby="not-found-heading" className="px-5 py-10 sm:px-8">
        <SectionLabel>Not found</SectionLabel>
        <h1 id="not-found-heading" className="mt-3 text-lg font-semibold">
          This page or policy doesn&apos;t exist for the signed-in wallet.
        </h1>
        <p className="mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted">
          Policies are visible only to the wallet that created them. Check that you are signed in with the right wallet.
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <ButtonLink href="/dashboard" variant="primary">
            Go to dashboard
          </ButtonLink>
          <ButtonLink href="/markets">Browse markets</ButtonLink>
        </div>
      </Card>
    </main>
  );
}
