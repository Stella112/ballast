"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  ["/app", "Account"],
  ["/app/payback", "Payback"],
  ["/app/radar", "Radar"],
  ["/app/existing", "Existing loan"],
  ["/app/invoices", "Invoices"],
  ["/app/activity", "Activity"],
  ["/app/hedge", "Hedge"],
  ["/demo", "Demo"],
] as const;

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <rect x="2" y="2" width="44" height="44" rx="10" fill="var(--accent)" />
      <path d="M14 30h20M17 30c0-8 4-13 7-13s7 5 7 13" stroke="var(--bg)" strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="14" r="2.6" fill="var(--bg)" />
    </svg>
  );
}

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-2 sm:w-auto">
      {NAV.map(([href, label]) => {
        const active = href === "/app" ? path === "/app" : path === href || path.startsWith(href + "/");
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 transition ${active ? "bg-accent-soft font-medium text-accent-strong" : "text-muted hover:bg-surface-2 hover:text-text"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
