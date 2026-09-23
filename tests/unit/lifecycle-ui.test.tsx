import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
const { PolicyActions } = await import("@/components/policy/policy-actions");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ID = "00000000-0000-4000-8000-000000000001";

describe("PolicyActions", () => {
  it("labels mock-mode arming as simulated and explains no funds move", () => {
    const html = renderToStaticMarkup(<PolicyActions policyId={ID} status="DRAFT" mode="mock" simulated={false} />);
    const t = text(html);
    expect(t).toContain("SIMULATED");
    expect(t).toContain("Arm simulated order");
    expect(t).toContain("No transaction will be sent and no funds will move.");
    expect(t).not.toMatch(/Authorize/);
  });

  it("offers no enabled arm action in live mode", () => {
    const html = renderToStaticMarkup(<PolicyActions policyId={ID} status="DRAFT" mode="live" simulated={false} />);
    expect(text(html)).toContain("Live Jupiter execution is not configured yet.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Arm policy<\/button>/);
    expect(text(html)).not.toContain("simulated");
  });

  it("shows the demo controls only for simulated ARMED policies, without any explorer link", () => {
    const html = renderToStaticMarkup(<PolicyActions policyId={ID} status="ARMED" mode="mock" simulated />);
    const t = text(html);
    for (const label of ["Refresh status", "Cancel simulated order", "Simulate provider fill", "MOCK PROVIDER", "Demo control"]) {
      expect(t).toContain(label);
    }
    expect(html).not.toMatch(/solscan|explorer/i);
  });
});
