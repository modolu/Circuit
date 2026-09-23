"use client";

import "@solana/wallet-adapter-react-ui/styles.css";
import type { Adapter } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl, type Cluster } from "@solana/web3.js";
import { useMemo, type ReactNode } from "react";

/**
 * No explicit adapters: every installed wallet is discovered through the Wallet
 * Standard (equivalent to `wallets={[]}`, hoisted so the provider does not
 * rebuild its adapter list on each render).
 */
const WALLET_STANDARD_ONLY: Adapter[] = [];

/** `cluster` comes from the server's validated public config (layout.tsx). */
export function SolanaProvider({ cluster, children }: { cluster: Cluster; children: ReactNode }) {
  const endpoint = useMemo(() => clusterApiUrl(cluster), [cluster]);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={WALLET_STANDARD_ONLY} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
