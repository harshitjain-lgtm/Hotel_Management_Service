/* App-level building blocks composed from shadcn/ui primitives and React Bits. */
import { ChevronLeft, ChevronRight, Inbox, Loader2, Search, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { type ComponentProps, type ReactNode } from "react";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------- form helpers ----------------

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-xs font-medium text-ink-2", className)} {...props} />;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const EMPTY_VALUE = "__empty__";

export interface Option {
  value: string;
  label: ReactNode;
}

/** shadcn Select that accepts "" as a value (Radix reserves the empty string), so filters can keep "Any". */
export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  className,
  size = "default",
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "default";
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select
      value={value === "" ? EMPTY_VALUE : value}
      onValueChange={(v) => onChange(v === EMPTY_VALUE ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={cn("w-full", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || EMPTY_VALUE} value={o.value === "" ? EMPTY_VALUE : o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Compact pill select used in card headers (the reference's "this week ▾"). */
export function PillSelect(props: Omit<ComponentProps<typeof SelectField>, "size">) {
  return <SelectField {...props} size="sm" className={cn("h-7! w-auto rounded-full px-3 text-xs text-ink-2", props.className)} />;
}

export function SearchInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
      <Input className="pl-10" {...props} />
    </div>
  );
}

// ---------------- modal ----------------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("gap-0 p-0", width)}>
        <DialogHeader className="border-b border-border px-6 pt-5 pb-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {children && <div className="space-y-4 px-6 py-5">{children}</div>}
        {footer && <DialogFooter className="rounded-b-2xl border-t border-border bg-[#f8fbff] px-6 py-3.5">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

// ---------------- feedback ----------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-primary", className)} />;
}

export function LoadingBlock({ label = "Loading…", rows = 0 }: { label?: string; rows?: number }) {
  if (rows > 0) {
    return (
      <div className="space-y-3 p-5" aria-busy="true" aria-label={label}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg bg-[#eef3f9]" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-muted-foreground">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title, description, icon: Icon = Inbox }: { title: string; description?: string; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center py-14 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="size-6" />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

// ---------------- layout pieces ----------------

const ORDINAL = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** "Fri // November 20th, 2026", as in the reference header. */
export function TodayLabel({ className }: { className?: string }) {
  const d = new Date();
  const weekday = d.toLocaleDateString("en-IN", { weekday: "short" });
  const month = d.toLocaleDateString("en-IN", { month: "long" });
  return (
    <p className={cn("text-sm text-ink-2", className)}>
      <span className="font-medium text-ink">{weekday}</span>
      <span className="mx-1.5 text-ink-3">//</span>
      {month} {ORDINAL(d.getDate())}, {d.getFullYear()}
    </p>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Fade-and-rise entrance for page sections (React Bits AnimatedContent, plays on mount). */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <AnimatedContent trigger="mount" distance={18} duration={0.55} delay={delay} ease="power2.out" className={className}>
      {children}
    </AnimatedContent>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
      <span>
        Showing <span className="font-medium text-ink">{from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")}</span> of{" "}
        <span className="font-medium text-ink">{total.toLocaleString("en-IN")}</span>
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="min-w-20 text-center">
          Page <span className="font-medium text-ink">{page}</span> / {pages.toLocaleString("en-IN")}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function KeyValue({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className={cn("mt-1 truncate text-sm text-ink", mono && "font-mono text-[13px]")}>{children}</dd>
    </div>
  );
}

// ---------------- visual atoms ----------------

export type ChipTone = "blue" | "violet" | "orange" | "green" | "amber" | "red" | "slate";

const CHIP: Record<ChipTone, string> = {
  blue: "bg-primary-soft text-primary",
  violet: "bg-violet-soft text-violet",
  orange: "bg-orange-soft text-orange",
  green: "bg-success-soft text-success",
  amber: "bg-gold-soft text-gold",
  red: "bg-danger-soft text-danger",
  slate: "bg-[#eef2f7] text-ink-2",
};

/** Round tinted icon (the reference's arrival / departure / booking icons). */
export function IconChip({ icon: Icon, tone = "blue", size = "md", className }: { icon: LucideIcon; tone?: ChipTone; size?: "sm" | "md" | "lg"; className?: string }) {
  const dims = size === "sm" ? "size-8 [&_svg]:size-4" : size === "lg" ? "size-12 [&_svg]:size-6" : "size-10 [&_svg]:size-5";
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-full", CHIP[tone], dims, className)}>
      <Icon />
    </div>
  );
}

const AVATAR_TONES = [
  "bg-primary-soft text-primary-strong",
  "bg-gold-soft text-[#a86a00]",
  "bg-success-soft text-success",
  "bg-violet-soft text-violet",
  "bg-orange-soft text-[#c96a10]",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function InitialsAvatar({ name, className }: { name?: string | null; className?: string }) {
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        AVATAR_TONES[hash(name ?? "") % AVATAR_TONES.length],
        className,
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

/** "+24%" / "−12%" pill. Colour reflects direction × whether up is good. */
export function DeltaPill({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = up === upIsGood;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        good ? "bg-success-soft text-success ring-[#c7ecd9]" : "bg-danger-soft text-danger ring-[#f8cfcf]",
      )}
    >
      <Icon className="size-3" />
      {up ? "+" : "−"}
      {Math.abs(Math.round(value))}%
    </span>
  );
}
