"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";

type ButtonProps = Omit<React.ComponentProps<typeof Button>, "onClick" | "children">;

/** Opens the Wallet Standard wallet selector. */
export function WalletConnectButton({ label = "Connect wallet", ...props }: { label?: string } & ButtonProps) {
  const { connecting } = useWallet();
  const { setVisible } = useWalletModal();
  return (
    <Button {...props} disabled={connecting || props.disabled} onClick={() => setVisible(true)}>
      {connecting ? "Connecting…" : label}
    </Button>
  );
}
