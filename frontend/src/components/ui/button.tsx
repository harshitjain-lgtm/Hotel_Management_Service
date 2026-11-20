import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_6px_14px_-6px_rgb(30_136_229/0.6)] hover:bg-primary-strong",
        soft: "bg-primary-soft text-primary-strong hover:bg-[#d4e8fc]",
        "outline-primary": "border-primary bg-white text-primary hover:bg-primary-soft",
        outline: "border-input bg-white text-ink-2 shadow-xs hover:bg-muted hover:text-ink aria-expanded:bg-muted",
        secondary: "border-input bg-white text-ink-2 shadow-xs hover:bg-muted hover:text-ink aria-expanded:bg-muted",
        ghost: "text-ink-2 hover:bg-primary-soft/70 hover:text-ink aria-expanded:bg-primary-soft/70",
        destructive: "bg-danger text-white shadow-[0_6px_14px_-6px_rgb(224_72_72/0.6)] hover:bg-[#c93a3a]",
        success: "bg-success text-white shadow-[0_6px_14px_-6px_rgb(23_145_92/0.55)] hover:bg-[#127a4d]",
        warning: "bg-gold text-white shadow-[0_6px_14px_-6px_rgb(239_160_11/0.6)] hover:bg-[#d98f06]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-2 px-4",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-md",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }

function Button({ className, variant = "default", size = "default", asChild = false, loading, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      disabled={asChild ? undefined : disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" />}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants, type ButtonProps }
