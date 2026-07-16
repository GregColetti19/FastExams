import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Cadence button. Meaning-bearing variants (color = state) live here, not in className strings.
 * - primary: coral fill — THE one action per screen (rationed)
 * - confirm: teal fill — "Got it", positive resolution
 * - ghost:   hairline border — secondary
 * - subtle:  no border — tertiary / inline
 */
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-control text-sm transition-colors duration-tempo disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
  {
    variants: {
      variant: {
        primary: "font-display bg-coral text-white hover:bg-coral-deep focus-visible:ring-coral",
        confirm: "font-display bg-teal-800 text-white hover:bg-teal-600 focus-visible:ring-teal-700",
        ghost: "border border-border-hair text-ink-secondary hover:border-border-strong hover:text-ink focus-visible:ring-border-strong",
        subtle: "text-ink-muted hover:text-ink focus-visible:ring-border-strong",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-[15px]",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
