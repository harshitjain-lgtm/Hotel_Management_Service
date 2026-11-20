import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

/** Pill badges modelled on the reference ("+24%", "paid"): tinted background, coloured text, hairline ring. */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full px-2.5 py-0.5 text-[11px] leading-[18px] font-medium whitespace-nowrap ring-1 ring-inset transition-colors [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      tone: {
        slate: "bg-[#f1f4f8] text-ink-2 ring-[#e1e7ef]",
        blue: "bg-primary-soft text-primary-strong ring-[#cfe3fa]",
        green: "bg-success-soft text-success ring-[#c7ecd9]",
        amber: "bg-warning-soft text-warning ring-[#fbe2ad]",
        red: "bg-danger-soft text-danger ring-[#f8cfcf]",
        violet: "bg-violet-soft text-violet ring-[#d9dbf6]",
        orange: "bg-orange-soft text-[#c96a10] ring-[#fddcb8]",
        teal: "bg-[#e0f5f4] text-[#0f8a84] ring-[#bfe9e6]",
        solid: "bg-primary text-white ring-primary",
      },
    },
    defaultVariants: { tone: "slate" },
  }
)

type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>

function Badge({
  className,
  tone = "slate",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"
  return <Comp data-slot="badge" data-tone={tone} className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants, type BadgeTone }
