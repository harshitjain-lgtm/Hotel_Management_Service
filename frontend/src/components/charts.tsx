/*
 * Chart building blocks (shadcn chart = Recharts 3 underneath).
 *
 * Specs follow the dataviz method: columns <= 22px wide with 4px rounded caps, 2px lines,
 * solid hairline grids, area fills as a light wash, legends for >= 2 series, value labels on
 * column caps (amber sits below 3:1 contrast on white, so its values are always printed),
 * and a visually hidden table behind every chart so no value is hover-only.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import CountUp from "@/components/reactbits/CountUp";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---------------- palette ----------------

/** Validated categorical order. `ink` is the label colour that stays legible inside a filled block. */
export const SERIES = {
  blue: { color: "#1e88e5", track: "#dcebfb", ink: "#ffffff" },
  amber: { color: "#efa00b", track: "#fdf0d2", ink: "#1d2939" },
  green: { color: "#1a9a63", track: "#d6f1e4", ink: "#ffffff" },
  periwinkle: { color: "#737bd3", track: "#e3e5f8", ink: "#ffffff" },
  gray: { color: "#a3b1c4", track: "#e9eef5", ink: "#1d2939" },
} as const;

export type SeriesKey = keyof typeof SERIES;

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en-IN");

/** Axis ticks: in full under 10,000, compact above. */
export const axisNumber = (v: number) => (Math.abs(v) >= 10_000 ? compact.format(v) : plain.format(v));

const AXIS = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "#8a96a8" } } as const;

export interface Datum {
  label: string;
  value: number;
  /** Optional longer label for tooltips and the hidden table. */
  title?: string;
}

function SrTable({ caption, data, format }: { caption: string; data: Datum[]; format: (n: number) => string }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {data.map((d, i) => (
          <tr key={i}>
            <th scope="row">{d.title ?? d.label}</th>
            <td>{format(d.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------- column chart (single series) ----------------

export function ColumnChart({
  data,
  series = "amber",
  name,
  height = 230,
  format = (n: number) => plain.format(n),
  highlight,
  showValues = true,
}: {
  data: Datum[];
  series?: SeriesKey;
  /** What the values are, e.g. "Arrivals". Used in the tooltip and hidden table. */
  name: string;
  height?: number;
  format?: (n: number) => string;
  /** Index of the column whose axis label is emphasised (e.g. today). */
  highlight?: number;
  showValues?: boolean;
}) {
  const config = { value: { label: name, color: SERIES[series].color } } satisfies ChartConfig;
  return (
    <>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} aria-hidden="true">
        <BarChart data={data} margin={{ top: 22, right: 4, left: -8, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label"
            {...AXIS}
            tickMargin={10}
            interval={0}
            tick={(props) => (
              <text
                x={Number(props.x)}
                y={Number(props.y) + 10}
                textAnchor="middle"
                fontSize={11}
                fontWeight={props.index === highlight ? 600 : 400}
                fill={props.index === highlight ? "#1570c4" : "#8a96a8"}
              >
                {String(props.payload?.value ?? "")}
              </text>
            )}
          />
          <YAxis {...AXIS} width={44} allowDecimals={false} tickFormatter={axisNumber} />
          <ChartTooltip
            cursor={{ fill: "#eef5fd" }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => (payload?.[0]?.payload as Datum | undefined)?.title ?? (payload?.[0]?.payload as Datum | undefined)?.label}
                formatter={(value) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <span className="size-2 rounded-[2px]" style={{ background: SERIES[series].color }} />
                      {name}
                    </span>
                    <span className="font-semibold text-ink tabular-nums">{format(Number(value))}</span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={900}>
            {showValues && (
              <LabelList
                dataKey="value"
                position="top"
                offset={8}
                fontSize={11}
                fontWeight={500}
                fill="#475467"
                formatter={(v: unknown) => (Number(v) > 0 ? axisNumber(Number(v)) : "")}
              />
            )}
          </Bar>
        </BarChart>
      </ChartContainer>
      <SrTable caption={name} data={data} format={format} />
    </>
  );
}

// ---------------- area / trend (single series) ----------------

export function AreaTrend({
  data,
  series = "blue",
  name,
  height = 230,
  format = (n: number) => plain.format(n),
  curve = "monotone",
}: {
  data: Datum[];
  series?: SeriesKey;
  name: string;
  height?: number;
  format?: (n: number) => string;
  curve?: "monotone" | "stepAfter" | "linear";
}) {
  const gid = `area-${useId().replace(/[^\w-]/g, "")}`;
  const color = SERIES[series].color;
  const config = { value: { label: name, color } } satisfies ChartConfig;
  const dots = data.length <= 14;
  return (
    <>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} aria-hidden="true">
        <AreaChart data={data} margin={{ top: 12, right: 12, left: -8, bottom: 0 }} accessibilityLayer>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} tickMargin={10} minTickGap={18} />
          <YAxis {...AXIS} width={48} tickFormatter={axisNumber} />
          <ChartTooltip
            cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.5 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => (payload?.[0]?.payload as Datum | undefined)?.title ?? (payload?.[0]?.payload as Datum | undefined)?.label}
                formatter={(value) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
                      {name}
                    </span>
                    <span className="font-semibold text-ink tabular-nums">{format(Number(value))}</span>
                  </div>
                )}
              />
            }
          />
          <Area
            type={curve}
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gid})`}
            dot={dots ? { r: 4, fill: color, stroke: "#ffffff", strokeWidth: 2 } : false}
            activeDot={{ r: 6, fill: color, stroke: "#ffffff", strokeWidth: 2 }}
            animationDuration={1000}
          />
        </AreaChart>
      </ChartContainer>
      <SrTable caption={name} data={data} format={format} />
    </>
  );
}

// ---------------- tall segmented bar (part of a whole) ----------------

export interface Part {
  key: string;
  label: string;
  value: number;
  series: SeriesKey;
}

export function SegmentedBar({ parts, format = (n: number) => plain.format(n), label }: { parts: Part[]; format?: (n: number) => string; label: string }) {
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  const pct = (v: number) => (sum ? Math.round((v / sum) * 100) : 0);
  return (
    <div>
      <div className="flex h-7 w-full gap-[2px]" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${format(p.value)} (${pct(p.value)}%)`).join(", ")}`}>
        {sum === 0 && <div className="h-full w-full rounded-[4px] bg-[#eef2f7]" />}
        {visible.map((p) => {
          const share = p.value / sum;
          return (
            <Tooltip key={p.key}>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  className="flex h-full min-w-[4px] cursor-default items-center overflow-hidden rounded-[4px] px-2 text-[11px] font-semibold transition-[filter] outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-primary/40"
                  style={{ flexGrow: p.value, flexBasis: 0, background: SERIES[p.series].color, color: SERIES[p.series].ink }}
                >
                  {share >= 0.09 ? `${Math.round(share * 100)}%` : null}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {p.label}: {format(p.value)} · {pct(p.value)}%
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {parts.map((p) => (
          <li key={p.key} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: SERIES[p.series].color }} />
            <span className="truncate text-ink-2">{p.label}</span>
            <span className="ml-auto font-medium text-ink tabular-nums">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- semicircle gauge (the reference's "Overall rating") ----------------

export type Severity = "good" | "warning" | "critical";

const SEVERITY: Record<Severity, { color: string; track: string }> = {
  good: { color: "#1e88e5", track: "#dcebfb" },
  warning: { color: "#efa00b", track: "#fdf0d2" },
  critical: { color: "#e04848", track: "#fbdcdc" },
};

export function RadialGauge({
  value,
  max,
  severity = "good",
  caption,
  center,
  footer,
}: {
  value: number;
  max: number;
  severity?: Severity;
  caption: string;
  center: ReactNode;
  footer?: ReactNode;
}) {
  const r = 84;
  const cx = 110;
  const cy = 104;
  const len = Math.PI * r;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setShown(ratio);
    const t = requestAnimationFrame(() => setShown(ratio));
    return () => cancelAnimationFrame(t);
  }, [ratio]);
  const { color, track } = SEVERITY[severity];
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[240px]">
        <svg viewBox="0 0 220 116" className="w-full" role="img" aria-label={`${caption}: ${value} of ${max}`}>
          <path d={d} fill="none" stroke={track} strokeWidth={26} />
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={26}
            strokeDasharray={len}
            strokeDashoffset={len * (1 - shown)}
            style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)" }}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="text-xs text-muted-foreground">{caption}</span>
          <div className="mt-0.5 flex items-center gap-2">{center}</div>
        </div>
      </div>
      {footer && <div className="mt-4 w-full">{footer}</div>}
    </div>
  );
}

// ---------------- meters & ranked bars ----------------

/** Label + value over a thin meter, as in the reference's rating breakdown. */
export function MeterRow({
  label,
  value,
  max,
  display,
  series = "blue",
  severity,
}: {
  label: ReactNode;
  value: number;
  max: number;
  display?: ReactNode;
  series?: SeriesKey;
  severity?: Severity;
}) {
  const palette = severity ? SEVERITY[severity] : SERIES[series];
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-ink-2">{label}</span>
        <span className="shrink-0 font-medium text-ink tabular-nums">{display ?? value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: palette.track }}>
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: palette.color }} />
      </div>
    </div>
  );
}

/** Ranked horizontal bars for one measure across categories (single colour: identity is the row label). */
export function RankedBars({
  data,
  series = "blue",
  format = (n: number) => plain.format(n),
  name,
}: {
  data: Datum[];
  series?: SeriesKey;
  format?: (n: number) => string;
  name: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-3" aria-label={name}>
      {data.map((d) => (
        <li key={d.label}>
          <MeterRow label={d.title ?? d.label} value={d.value} max={max} display={format(d.value)} series={series} />
        </li>
      ))}
    </ul>
  );
}

// ---------------- stat tile ----------------

export function AnimatedNumber({ value, prefix, suffix, compactFormat, className }: { value: number; prefix?: string; suffix?: string; compactFormat?: boolean; className?: string }) {
  return (
    <CountUp
      to={value}
      duration={1.2}
      separator=","
      grouping="indian"
      prefix={prefix}
      suffix={suffix}
      format={compactFormat ? "compact" : "standard"}
      trigger="load"
      className={className}
    />
  );
}

export function StatTile({
  icon,
  label,
  hint,
  value,
  prefix,
  suffix,
  delta,
  footer,
  className,
  format,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  value: number | null | undefined;
  prefix?: string;
  suffix?: string;
  /** Static formatter (e.g. INR with lakh grouping); skips the count-up animation. */
  format?: (n: number) => string;
  delta?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3.5", className)}>
      {icon}
      <div className="min-w-0">
        <p className="text-sm text-ink-2">
          {label} {hint && <span className="text-[11px] text-ink-3">({hint})</span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-[26px] leading-none font-semibold text-ink">
            {value == null ? "—" : format ? format(value) : <AnimatedNumber value={value} prefix={prefix} suffix={suffix} compactFormat={Math.abs(value) >= 10_000_000} />}
          </span>
          {delta}
        </div>
        {footer && <div className="mt-2.5 text-xs text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}
