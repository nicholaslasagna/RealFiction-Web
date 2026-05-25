import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2.5 py-1 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-primary/24 bg-primary/8 text-primary",
        secondary:
          "border-border bg-secondary/70 text-secondary-foreground",
        success:
          "border-emerald-400/22 bg-emerald-400/7 text-emerald-200",
        warning:
          "border-amber-300/22 bg-amber-300/7 text-amber-200",
        outline:
          "border-border bg-background/24 text-muted-foreground"
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
