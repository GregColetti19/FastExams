import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Clickable card shell. Whole card is the target (§2.7 — no "Open" buttons).
 * Hover: border brightens + 1px lift, 150ms. As a Link when `href` given, else a div.
 */
const base =
  "block rounded-card border border-border-hair bg-surface p-4 transition-all duration-150 " +
  "motion-safe:hover:-translate-y-px hover:border-border-strong";

export function ClickableCard({
  href,
  className,
  children,
  ...props
}: { href?: string } & React.HTMLAttributes<HTMLDivElement>) {
  if (href) {
    return (
      <Link href={href} className={cn(base, className)}>
        {children}
      </Link>
    );
  }
  return (
    <div className={cn(base, className)} {...props}>
      {children}
    </div>
  );
}

/** Static (non-clickable) card — same skin, no hover lift. */
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-card border border-border-hair bg-surface p-4", className)} {...props}>
      {children}
    </div>
  );
}
