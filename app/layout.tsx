import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppHeader } from "@/components/ui/app-header";
import { SolanaProvider } from "@/components/wallet/solana-provider";
import { getSession } from "@/src/auth/session";
import { getPublicEnv } from "@/src/config/env";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const publicEnv = getPublicEnv();

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
  title: {
    default: "Circuit: programmable execution for tokenized public and private stocks",
    template: "%s | Circuit",
  },
  description:
    "Define a bounded execution policy for a tokenized stock once. Circuit checks it against a reference (Pyth for public equities, the PreStocks mark for private-company tokens) and compiles it into a Jupiter Trigger order on Solana.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col font-sans text-sm">
        <SolanaProvider cluster={publicEnv.NEXT_PUBLIC_SOLANA_CLUSTER}>
          <AppHeader cluster={publicEnv.NEXT_PUBLIC_SOLANA_CLUSTER} sessionWallet={session?.walletAddress ?? null} />

          <div className="flex-1">{children}</div>
        </SolanaProvider>

        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-1 px-4 py-5 font-mono text-[11px] text-muted sm:flex-row sm:justify-between sm:px-6">
            <p>Built for STOCKLANA 2026</p>
            <p>Built on Solana</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
