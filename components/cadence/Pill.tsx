import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { IconTrophy, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * Status pill. Color = state (§3.2):
 * - due:      coral-tinted — "8 due today" (attention)
 * - neutral:  muted — "cool · early", "just added" (structural)
 * - mastered: gold + trophy — exactly 100%
 * - active:   teal-tinted + check — Active-exam toggle on
 */
const pill = cva(
  "inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs whitespace-nowrap",
  {
    variants: {
      variant: {
        due: "bg-coral/15 text-coral-soft",
        neutral: "bg-surface-inset text-ink-muted",
        mastered: "bg-gold/15 text-gold-pill",
        active: "bg-teal-800/20 text-teal-100",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pill> {}

export function Pill({ className, variant, children, ...props }: PillProps) {
  return (
    <span className={cn(pill({ variant }), className)} {...props}>
      {variant === "mastered" && <IconTrophy size={12} stroke={2} />}
      {variant === "active" && <IconCheck size={12} stroke={2.5} />}
      {children}
    </span>
  );
}
