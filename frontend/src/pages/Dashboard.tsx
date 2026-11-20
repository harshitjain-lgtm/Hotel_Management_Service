import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, BedDouble, CalendarCheck2, CalendarX2, Check, Eye, LogIn, ShieldCheck, ShieldOff, Users, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CHANNELS, CONTROL_LABELS, RES_STATUS, ReservationStatus } from "@/components/badges";
import { AnimatedNumber, ColumnChart, RadialGauge, SegmentedBar, StatTile, type Datum, type Part } from "@/components/charts";
import { DeltaPill, EmptyState, IconChip, InitialsAvatar, LoadingBlock, PageHeader, PillSelect, Reveal, SearchInput, TodayLabel } from "@/components/kit";
import { useProperties } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paged, ReservationRow } from "@/lib/types";
import { cn, inr, titleCase } from "@/lib/utils";

/*
 * Every number on this page comes from /reservations with page_size=1 (only `total` is used),
 * so each request returns at most one record and is audited as a normal search. Results are
 * cached for five minutes so revisiting the dashboard does not repeat them.
 */

const STALE = 5 * 60_000;

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
}

type Params = Record<string, string>;

function countQuery(property: string, params: Params) {
  return {
    queryKey: ["dash-count", property, params],
    queryFn: () => api<Paged<ReservationRow>>("/reservations", { query: { ...params, property, page: 1, page_size: 1 } }),
    staleTime: STALE,
    gcTime: 3 * STALE,
    meta: { silent: true },
    select: (d: Paged<ReservationRow>) => d.total,
  };
}

function useCounts(property: string, list: Params[]) {
  return useQueries({ queries: list.map((p) => countQuery(property, p)) });
}

const WEEKS = [
  { value: "0", label: "This week" },
  { value: "1", label: "Next week" },
  { value: "-1", label: "Last week" },
];

const STATUS_KEYS = ["booked", "checked_in", "checked_out", "cancelled"] as const;
const CHANNEL_KEYS = ["direct", "walk_in", "TRIPNEST", "STAYFINDER"] as const;

// ------------------------------------------------------------------ KPI row

function KpiCard({ thisWeek, prevWeek, booked, cancelled }: { thisWeek?: number; prevWeek?: number; booked?: number; cancelled?: number }) {
  const delta = thisWeek != null && prevWeek ? ((thisWeek - prevWeek) / prevWeek) * 100 : null;
  return (
    <Card className="h-full justify-center">
      <CardContent className="grid grid-cols-1 gap-6 py-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
        <StatTile
          className="sm:pr-5"
          icon={<IconChip icon={LogIn} tone="violet" />}
          label="Arrivals"
          hint="this week"
          value={thisWeek}
          delta={<DeltaPill value={delta} />}
          footer={
            <>
              Previous week: <span className="font-medium text-ink">{prevWeek?.toLocaleString("en-IN") ?? "—"}</span>
            </>
          }
        />
        <StatTile
          className="sm:px-5"
          icon={<IconChip icon={CalendarCheck2} tone="blue" />}
          label="Upcoming"
          hint="booked"
          value={booked}
          footer="Confirmed, not yet arrived"
        />
        <StatTile
          className="sm:pl-5"
          icon={<IconChip icon={CalendarX2} tone="orange" />}
          label="Cancellations"
          hint="all time"
          value={cancelled}
          footer="Across properties in scope"
        />
      </CardContent>
    </Card>
  );
}

function TodayCard({ arrivals, inHouse, rooms }: { arrivals?: number; inHouse?: number; rooms?: number }) {
  const occupancy = inHouse != null && rooms ? Math.min(100, Math.round((inHouse / rooms) * 100)) : null;
  const items = [
    { label: "Arriving today", value: arrivals },
    { label: "In-house guests", value: inHouse },
    { label: "Occupancy", value: occupancy, suffix: "%" },
  ];
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Today's activity</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 pt-1">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col items-center text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white shadow-[0_8px_18px_-8px_rgb(30_136_229/0.8)]">
              {it.value == null ? "—" : <AnimatedNumber value={it.value} suffix={it.suffix} compactFormat={it.value >= 10_000} />}
            </div>
            <p className="mt-2 text-xs leading-tight text-ink-2">{it.label}</p>
          </div>
        ))}
        <p className="col-span-3 mt-1 text-center text-[11px] text-ink-3">
          {rooms ? `${rooms.toLocaleString("en-IN")} rooms in scope` : "Room inventory unavailable"}
        </p>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ charts row

function WeekArrivals({ property }: { property: string }) {
  const [offset, setOffset] = useState("0");
  const start = addDays(mondayOf(new Date()), Number(offset) * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const counts = useCounts(
    property,
    days.map((d) => ({ arrival_from: ymd(d), arrival_to: ymd(d) })),
  );
  const loading = counts.some((c) => c.isLoading);
  const failed = counts.some((c) => c.isError);
  const today = ymd(new Date());
  const data: Datum[] = days.map((d, i) => ({
    label: d.toLocaleDateString("en-IN", { weekday: "short" }),
    title: d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" }),
    value: counts[i].data ?? 0,
  }));
  const todayIndex = days.findIndex((d) => ymd(d) === today);
  const range = `${days[0].toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle>Arrivals</CardTitle>
          <CardDescription>{range}</CardDescription>
        </div>
        <PillSelect value={offset} onChange={setOffset} options={WEEKS} aria-label="Week" />
      </CardHeader>
      <CardContent className="pb-4">
        {loading ? (
          <LoadingBlock rows={4} />
        ) : failed ? (
          <EmptyState title="Couldn't load arrivals" description="The reservations API refused or failed one of the requests." />
        ) : (
          <ColumnChart data={data} name="Arrivals" series="amber" highlight={todayIndex >= 0 ? todayIndex : undefined} />
        )}
      </CardContent>
    </Card>
  );
}

function MixCard({ status, channel }: { status: (number | undefined)[]; channel: (number | undefined)[] }) {
  const ready = status.every((v) => v != null) && channel.every((v) => v != null);
  const statusParts: Part[] = STATUS_KEYS.map((k, i) => ({ key: k, label: RES_STATUS[k].label, value: status[i] ?? 0, series: RES_STATUS[k].series }));
  const channelParts: Part[] = CHANNEL_KEYS.map((k, i) => ({ key: k, label: CHANNELS[k].label, value: channel[i] ?? 0, series: CHANNELS[k].series }));
  const total = statusParts.reduce((s, p) => s + p.value, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle>Reservation mix</CardTitle>
          <CardDescription>{ready ? `${total.toLocaleString("en-IN")} reservations in scope` : "Loading…"}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!ready ? (
          <LoadingBlock rows={3} />
        ) : (
          <>
            <div>
              <p className="mb-2.5 text-xs font-medium tracking-wide text-ink-3 uppercase">By status</p>
              <SegmentedBar parts={statusParts} label="Reservations by status" />
            </div>
            <div>
              <p className="mb-2.5 text-xs font-medium tracking-wide text-ink-3 uppercase">By booking channel</p>
              <SegmentedBar parts={channelParts} label="Reservations by channel" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PostureCard() {
  const { me, can } = useAuth();
  const entries = Object.keys(CONTROL_LABELS)
    .filter((k) => me?.policies[k] !== undefined)
    .map((k) => [k, !!me?.policies[k]] as const);
  const on = entries.filter(([, v]) => v).length;
  const total = entries.length;
  const ratio = total ? on / total : 0;
  const severity = ratio === 1 ? "good" : ratio >= 0.75 ? "warning" : "critical";
  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle>Security posture</CardTitle>
          <CardDescription>Policy Center controls</CardDescription>
        </div>
        {can("admin.manage") && (
          <Button asChild variant="ghost" size="sm" className="text-primary">
            <Link to="/admin">
              Manage <ArrowRight />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <RadialGauge
          value={on}
          max={total}
          severity={severity}
          caption="Controls enforced"
          center={
            <>
              <span className="text-[28px] leading-none font-semibold text-ink">
                {on}/{total}
              </span>
              <Badge tone={severity === "good" ? "green" : severity === "warning" ? "amber" : "red"}>
                {severity === "good" ? <ShieldCheck /> : <ShieldOff />}
                {Math.round(ratio * 100)}%
              </Badge>
            </>
          }
          footer={
            <ul className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {entries.map(([k, enabled]) => (
                <li key={k} className="flex min-w-0 items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full",
                      enabled ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
                    )}
                  >
                    {enabled ? <Check className="size-2.5" strokeWidth={3} /> : <X className="size-2.5" strokeWidth={3} />}
                  </span>
                  <span className={cn("truncate", enabled ? "text-ink-2" : "font-medium text-ink")}>{CONTROL_LABELS[k]}</span>
                </li>
              ))}
            </ul>
          }
        />
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ today's list

function TodayTable({ property }: { property: string }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"arrivals" | "inhouse">("arrivals");
  const [q, setQ] = useState("");
  const today = ymd(new Date());
  const params: Params =
    tab === "arrivals" ? { arrival_from: today, arrival_to: today, sort: "arrival_asc" } : { status: "checked_in", sort: "arrival_desc" };
  const list = useQuery({
    queryKey: ["dash-list", property, params],
    queryFn: () => api<Paged<ReservationRow>>("/reservations", { query: { ...params, property, page: 1, page_size: 8 } }),
    staleTime: STALE,
  });
  const search = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/reservations?q=${encodeURIComponent(q.trim())}`);
  };
  const seeAll = tab === "arrivals" ? `/reservations?arrival_from=${today}&arrival_to=${today}` : `/reservations?status=checked_in`;
  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-baseline gap-2">
          <CardTitle className="text-base">Today's front desk</CardTitle>
          {list.data && (
            <span className="text-sm text-muted-foreground">
              ({list.data.total.toLocaleString("en-IN")} {tab === "arrivals" ? "arriving today" : "in-house"})
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList variant="line">
            <TabsTrigger value="arrivals">
              <LogIn /> Arrivals
            </TabsTrigger>
            <TabsTrigger value="inhouse">
              <BedDouble /> In-house
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row">
          <SearchInput
            className="flex-1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search guest by name, phone or reservation ID"
            aria-label="Search reservations"
          />
          <Button type="button" variant="outline-primary" className="h-10" asChild>
            <Link to={seeAll}>
              <Users /> See all {tab === "arrivals" ? "arrivals" : "in-house"}
            </Link>
          </Button>
        </form>
        {list.isLoading ? (
          <LoadingBlock rows={5} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState title={tab === "arrivals" ? "No arrivals today" : "No in-house guests"} description="Nothing matches in the properties you can see." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Reservation</TableHead>
                <TableHead className="text-center">Nights</TableHead>
                <TableHead>Room type</TableHead>
                <TableHead>Guests</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <InitialsAvatar name={r.guest.name} />
                      <div className="min-w-0 leading-tight">
                        <Link to={`/guests/${r.guest.id}`} className="block truncate font-medium text-ink hover:text-primary">
                          {r.guest.name}
                        </Link>
                        <span className="text-xs text-ink-3">{r.guest.phone}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{r.id}</TableCell>
                  <TableCell className="text-center tabular-nums">{r.nights}</TableCell>
                  <TableCell>
                    {titleCase(r.room_type)}
                    {r.room_no && <span className="ml-1 text-xs text-ink-3">#{r.room_no}</span>}
                  </TableCell>
                  <TableCell>
                    {r.adults + r.children} guest{r.adults + r.children > 1 ? "s" : ""}
                  </TableCell>
                  <TableCell>
                    <ReservationStatus status={r.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium text-ink tabular-nums">{inr(r.total_amount)}</TableCell>
                  <TableCell className="text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button asChild variant="outline-primary" size="icon-sm" className="rounded-full">
                          <Link to={`/reservations/${r.id}`} aria-label={`Open ${r.id}`}>
                            <Eye />
                          </Link>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Open reservation</TooltipContent>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {list.data && list.data.total > list.data.items.length && (
          <div className="flex justify-end">
            <Link to={seeAll} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              See other bookings <ArrowRight className="size-4" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ page

export function DashboardPage() {
  const { me } = useAuth();
  const { data: properties } = useProperties();
  const [property, setProperty] = useState("");
  const scope = me?.staff.property_scope ?? [];

  const today = ymd(new Date());
  // The seven daily counts share query keys with the arrivals chart (react-query dedupes them),
  // so the weekly total and "arriving today" cost no extra requests.
  const base = useMemo<Params[]>(() => {
    const monday = mondayOf(new Date()); // recomputed when `today` rolls over
    return [
      ...Array.from({ length: 7 }, (_, i) => ({ arrival_from: ymd(addDays(monday, i)), arrival_to: ymd(addDays(monday, i)) })),
      { arrival_from: ymd(addDays(monday, -7)), arrival_to: ymd(addDays(monday, -1)) },
      ...STATUS_KEYS.map((s) => ({ status: s })),
      ...CHANNEL_KEYS.map((c) => ({ channel: c })),
    ];
  }, [today]);
  const counts = useCounts(property, base).map((q) => q.data);
  const days = counts.slice(0, 7);
  const thisWeek = days.every((v) => v != null) ? days.reduce<number>((s, v) => s + (v ?? 0), 0) : undefined;
  const arrivalsToday = days[(new Date().getDay() + 6) % 7];
  const prevWeek = counts[7];
  const status = counts.slice(8, 12);
  const channel = counts.slice(12, 16);

  const rooms = properties?.filter((p) => (property ? p.id === property : scope.includes(p.id))).reduce((s, p) => s + p.rooms, 0);
  const propertyOptions = [
    { value: "", label: "All properties" },
    ...scope.map((id) => {
      const p = properties?.find((x) => x.id === id);
      return { value: id, label: p ? `${p.name}` : id };
    }),
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome back, ${me?.staff.name.split(" ")[0] ?? ""}. Here's what's happening ${
          scope.length > 1 ? "across your properties" : `at ${properties?.find((p) => p.id === scope[0])?.name ?? "your property"}`
        }.`}
        actions={
          <div className="flex flex-col items-end gap-2">
            <TodayLabel />
            {scope.length > 1 && <PillSelect value={property} onChange={setProperty} options={propertyOptions} aria-label="Property" />}
          </div>
        }
      />

      <div className="space-y-5">
        <Reveal className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <KpiCard thisWeek={thisWeek} prevWeek={prevWeek} booked={status[0]} cancelled={status[3]} />
          </div>
          <div className="xl:col-span-4">
            <TodayCard arrivals={arrivalsToday} inHouse={status[1]} rooms={rooms} />
          </div>
        </Reveal>

        <Reveal delay={0.08} className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <WeekArrivals property={property} />
          <MixCard status={status} channel={channel} />
          <div className="lg:col-span-2 xl:col-span-1">
            <PostureCard />
          </div>
        </Reveal>

        <Reveal delay={0.16}>
          <TodayTable property={property} />
        </Reveal>
      </div>
    </div>
  );
}
