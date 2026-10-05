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
    default: "Circuit: policy-controlled execution for onchain capital markets",
    template: "%s | Circuit",
  },
  description:
    "Circuit turns user-defined investment decisions into bounded, deterministic execution policies on Solana, with external reference context, Jupiter Trigger execution, and an auditable lifecycle.",
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
            <p>Policy-controlled execution for onchain capital markets</p>
            <p>Built on Solana</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
