import * as React from "react"
import { cn } from "@/lib/utils"

/** Table styled after the reference booking list: light-blue uppercase header band, airy rows. */
function Table({ className, wrapperClassName, ...props }: React.ComponentProps<"table"> & { wrapperClassName?: string }) {
  return (
    <div data-slot="table-container" className={cn("scrollbar-thin relative w-full overflow-x-auto", wrapperClassName)}>
      <table data-slot="table" className={cn("w-full caption-bottom text-left text-[13px]", className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("bg-[#eef5fd] [&_tr]:border-0", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot data-slot="table-footer" className={cn("border-t bg-muted/60 font-medium", className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("border-b border-[#eef2f7] transition-colors hover:bg-[#f6f9fe] data-[state=selected]:bg-primary-soft", className)}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-11 px-4 text-left align-middle text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-[#3b4a5e] uppercase first:rounded-l-xl last:rounded-r-xl",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("px-4 py-3 align-middle text-ink-2", className)} {...props} />
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
