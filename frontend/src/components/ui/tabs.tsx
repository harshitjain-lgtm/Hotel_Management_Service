import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-4", className)} {...props} />
}

/** Two looks from the reference: "pill" (Stays / Packages) and "line" (Arrivals / Departure). */
const tabsListVariants = cva("group/tabs-list inline-flex w-fit items-center", {
  variants: {
    variant: {
      pill: "gap-1.5 rounded-xl",
      line: "w-full gap-6 border-b border-border",
    },
  },
  defaultVariants: { variant: "pill" },
})

function TabsList({ className, variant = "pill", ...props }: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn(tabsListVariants({ variant }), className)} {...props} />
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center gap-2 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // pill
        "group-data-[variant=pill]/tabs-list:h-9 group-data-[variant=pill]/tabs-list:rounded-lg group-data-[variant=pill]/tabs-list:px-4 group-data-[variant=pill]/tabs-list:data-[state=active]:bg-primary-soft group-data-[variant=pill]/tabs-list:data-[state=active]:text-primary",
        // line
        "group-data-[variant=line]/tabs-list:-mb-px group-data-[variant=line]/tabs-list:border-b-2 group-data-[variant=line]/tabs-list:border-transparent group-data-[variant=line]/tabs-list:px-1 group-data-[variant=line]/tabs-list:pb-2.5 group-data-[variant=line]/tabs-list:data-[state=active]:border-primary group-data-[variant=line]/tabs-list:data-[state=active]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
