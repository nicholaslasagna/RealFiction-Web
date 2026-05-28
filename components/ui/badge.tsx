import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary/10 text-primary",
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        success:
          "border-[color:rgba(74,138,71,0.30)] bg-[color:rgba(74,138,71,0.10)] text-[color:#3a6f37]",
        warning:
          "border-[color:rgba(210,154,46,0.32)] bg-[color:rgba(210,154,46,0.10)] text-[color:#8a6320]",
        outline:
          "border-border bg-card text-muted-foreground"
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
