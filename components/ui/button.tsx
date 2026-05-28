import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Button now maps to the mockup's iconic `.mc-button` system:
 *   default  → green Minecraft button
 *   gold     → mc-button--gold (primary call-out)
 *   outline  → mc-button--ghost (outlined stone)
 *   discord  → mc-button--discord (brand blue)
 *
 * `ghost`, `secondary`, `destructive`, and `icon` remain Tailwind-only
 * so that mobile menu togglers, dropdown buttons, and admin actions can
 * still look distinct from the marketing CTAs.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "mc-button",
        gold: "mc-button mc-button--gold",
        outline: "mc-button mc-button--ghost",
        discord: "mc-button mc-button--discord",
        secondary:
          "minecraft-font text-xs uppercase tracking-[0.05em] text-slate-200 rounded-sm border border-amber-200/30 bg-amber-200/8 px-4 py-2 hover:bg-amber-200/15 hover:text-amber-100",
        ghost:
          "minecraft-font text-xs uppercase tracking-[0.05em] text-slate-200 rounded-sm px-3 py-2 hover:bg-amber-200/10 hover:text-amber-100",
        destructive:
          "rounded-sm border border-rose-400/30 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/25"
      },
      size: {
        default: "",
        sm: "",
        lg: "",
        icon: "h-10 w-10 rounded-sm border border-amber-200/30 bg-black/30 text-slate-200 hover:bg-amber-200/10 hover:text-amber-100"
      }
    },
    compoundVariants: [
      {
        variant: ["default", "gold", "outline", "discord"],
        size: "sm",
        className: "mc-button--sm"
      },
      {
        variant: ["default", "gold", "outline", "discord"],
        size: "lg",
        className: "mc-button--lg"
      }
    ],
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild, className, children, variant, size, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }))

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string }>

      return React.cloneElement(child, {
        className: cn(classes, child.props.className)
      })
    }

    return (
      <button
        className={classes}
        ref={ref}
        {...props}
      >
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
