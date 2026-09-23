import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppHeader } from "@/components/ui/app-header";
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
    default: "Circuit: policy-controlled execution for tokenized stocks",
    template: "%s | Circuit",
  },
  description:
    "Define a bounded execution policy for a tokenized stock once. Circuit validates it against an independent Pyth equity reference and compiles it into a Jupiter Trigger order on Solana.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col font-sans text-sm">
        <AppHeader cluster={publicEnv.NEXT_PUBLIC_SOLANA_CLUSTER} />

        <div className="flex-1">{children}</div>

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
