"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/** Re-renders the page on the server, which fetches a new Pyth reference. No polling. */
export function RefreshReferenceButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button size="md" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? "Refreshing…" : "Refresh reference"}
    </Button>
  );
}
