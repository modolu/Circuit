"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { WalletAuthControl } from "@/components/wallet/wallet-auth-control";
import { CircuitMark } from "./circuit-mark";
import { cn } from "./cn";

interface NavItem {
  label: string;
  href: string;
  /** Extra path prefixes that count as this item being active. */
  activePrefixes?: string[];
}

/** Home is the Circuit wordmark. Policy detail pages belong to the Dashboard section, where policies are listed. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", activePrefixes: ["/policies/"] },
  { label: "Markets", href: "/markets" },
  { label: "New policy", href: "/policies/new" },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  // /policies/new is its own item, so it never counts as a Dashboard (policy detail) page.
  return pathname !== "/policies/new" && Boolean(item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)));
}

const NAV_ITEM_BASE = "rounded-md px-3 py-[7px] text-[13px] transition-colors";

function NavLinks({ pathname, stacked = false }: { pathname: string; stacked?: boolean }) {
  return (
    <ul className={cn("flex gap-1", stacked && "flex-col")}>
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        return (
          <li key={item.label}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                NAV_ITEM_BASE,
                "block",
                active ? "bg-raised text-text" : "text-muted hover:bg-panel-2 hover:text-text",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Shows the configured target cluster only. It is not a live network-health signal. */
function ClusterPill({ cluster }: { cluster: string }) {
  return (
    <p
      className="flex items-center gap-2 rounded-full border border-line px-2.5 py-1.5 font-mono text-xs text-muted"
      title="Configured Solana cluster"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full border border-muted" />
      <span className="sr-only">Configured cluster: </span>
      Solana {cluster}
    </p>
  );
}

export function AppHeader({ cluster, sessionWallet }: { cluster: string; sessionWallet: string | null }) {
  const pathname = usePathname();
  // The menu belongs to the path it was opened on, so navigating closes it.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === pathname;
  const menuId = useId();
  // The landing page has its own sign-in panel, so the header omits the wallet control there.
  const landing = pathname === "/";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas">
      <div className="flex h-14 items-center gap-7 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-md text-[13px] font-semibold tracking-[0.14em] text-text transition-colors hover:text-accent"
          aria-label="Circuit home"
          title="Circuit home"
        >
          <CircuitMark className="size-[22px] text-accent" />
          CIRCUIT
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <NavLinks pathname={pathname} />
        </nav>

        <div className="flex-1" />

        <div className="hidden lg:flex">
          <ClusterPill cluster={cluster} />
        </div>

        <div className="flex items-center gap-2">
          {!landing && <WalletAuthControl sessionWallet={sessionWallet} />}
          <button
            type="button"
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-muted hover:text-text md:hidden"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}
          >
            Menu
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id={menuId} className="border-t border-line px-4 py-3 md:hidden">
          <nav aria-label="Primary (menu)">
            <NavLinks pathname={pathname} stacked />
          </nav>
          <div className="mt-3 flex border-t border-line pt-3">
            <ClusterPill cluster={cluster} />
          </div>
        </div>
      )}
    </header>
  );
}
