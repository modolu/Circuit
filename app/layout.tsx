import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { getPublicEnv } from "@/src/config/env";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getPublicEnv().NEXT_PUBLIC_APP_URL),
  title: {
    default: "Circuit: programmable execution for tokenized stocks",
    template: "%s | Circuit",
  },
  description:
    "Define a bounded execution policy for a tokenized stock once. Circuit checks it against a Pyth equity reference and routes it to Jupiter Trigger on Solana.",
};

function SwitchMark() {
  // A schematic switch: the circuit closes when the policy's condition is met.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 text-trace">
      <circle cx="4" cy="16" r="2.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="20" cy="16" r="2.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.8 14.8 17.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <header className="border-b border-rule">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
            <Link href="/" className="flex items-center gap-2.5 rounded-sm text-[1.0625rem] font-medium">
              <SwitchMark />
              Circuit
            </Link>
            <nav aria-label="Primary">
              <Link
                href="/dashboard"
                className="rounded-sm text-sm text-muted transition-colors hover:text-text"
              >
                Dashboard
              </Link>
            </nav>
          </div>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="border-t border-rule">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 py-6 text-sm text-muted sm:flex-row sm:justify-between sm:px-8">
            <p>Built for STOCKLANA 2026</p>
            <p>Built on Solana</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
