"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { shortAddress } from "./short-address";
import { useCircuitAuth } from "./use-circuit-auth";
import { WalletSignInPanel } from "./wallet-sign-in-panel";

const PILL = "flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs transition-colors";

/** Compact header control: Connect wallet → Sign in → signed-in address with a menu. */
export function WalletAuthControl({ sessionWallet }: { sessionWallet: string | null }) {
  const { connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { logout } = useCircuitAuth();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (!sessionWallet && !connected) {
    return (
      <button
        type="button"
        disabled={connecting}
        onClick={() => setVisible(true)}
        className={cn(PILL, "border-line text-muted hover:border-line-strong hover:text-text")}
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          PILL,
          sessionWallet
            ? "border-line text-text hover:border-line-strong"
            : "border-accent/50 bg-accent/12 text-accent hover:border-accent",
        )}
      >
        {sessionWallet ? (
          <>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
            <span className="sr-only">Signed in as </span>
            {shortAddress(sessionWallet)}
          </>
        ) : (
          "Sign in"
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-30 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-[10px] border border-line-strong bg-panel p-4 shadow-2xl shadow-black/40"
        >
          {sessionWallet ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[11px] font-medium tracking-[0.1em] text-muted uppercase">Signed in to Circuit</p>
                <p className="mt-1.5 font-mono text-xs break-all text-text">{sessionWallet}</p>
              </div>
              <div className="flex flex-col gap-1 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => void logout().then(() => setOpen(false))}
                  className="rounded-md px-2 py-1.5 text-left text-[13px] text-text hover:bg-panel-2"
                >
                  Log out of Circuit
                </button>
                {connected && (
                  <button
                    type="button"
                    onClick={() => void disconnect()}
                    className="rounded-md px-2 py-1.5 text-left text-[13px] text-muted hover:bg-panel-2 hover:text-text"
                  >
                    Disconnect wallet
                  </button>
                )}
              </div>
            </div>
          ) : (
            <WalletSignInPanel sessionWallet={null} size="md" />
          )}
        </div>
      )}
    </div>
  );
}
