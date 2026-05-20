import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary/14 text-primary",
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        success:
          "border-emerald-400/25 bg-emerald-400/12 text-emerald-200",
        warning:
          "border-amber-300/25 bg-amber-300/12 text-amber-200",
        outline:
          "border-border bg-background/40 text-muted-foreground"
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
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
