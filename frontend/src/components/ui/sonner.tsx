import { CircleCheckIcon, InfoIcon, Loader2Icon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/** Light-only toaster (the app has no dark mode, so no next-themes). */
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="light"
    position="bottom-right"
    closeButton
    className="toaster group"
    icons={{
      success: <CircleCheckIcon className="size-[18px] text-success" />,
      info: <InfoIcon className="size-[18px] text-primary" />,
      warning: <TriangleAlertIcon className="size-[18px] text-warning" />,
      error: <ShieldAlertIcon className="size-[18px] text-danger" />,
      loading: <Loader2Icon className="size-[18px] animate-spin text-primary" />,
    }}
    toastOptions={{
      classNames: {
        toast: "!rounded-xl !border !shadow-lift !font-sans !items-start !gap-3 !p-4",
        title: "!text-[13px] !font-semibold !text-ink",
        description: "!text-[13px] !leading-snug !text-ink-2",
        success: "!border-[#c7ecd9]",
        info: "!border-[#cfe3fa]",
        warning: "!border-[#fbe2ad] !bg-[#fffaf0]",
        error: "!border-[#f8cfcf] !bg-[#fff7f7]",
        closeButton: "!bg-white !border-border !text-ink-3 hover:!text-ink",
      },
    }}
    {...props}
  />
)

export { Toaster }
