import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badge reskinned to match the mockup's small uppercase eyebrow chips:
 * rf-bold font, gold-tinted backgrounds, square corners. Used for things
 * like card tags, section eyebrows, and inline state markers.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 border px-2.5 py-1 text-[10px] font-normal uppercase tracking-[0.14em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-amber-200/30 bg-amber-200/8 text-amber-200",
        secondary: "border-white/12 bg-white/6 text-slate-100",
        success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
        warning: "border-amber-300/30 bg-amber-300/10 text-amber-200",
        outline: "border-amber-200/30 bg-transparent text-amber-200"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div
      className={cn("font-[var(--font-display)]", badgeVariants({ variant }), className)}
      style={{ fontFamily: "rf-bold, sans-serif" }}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
