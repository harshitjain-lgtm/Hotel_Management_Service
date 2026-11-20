import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BedDouble, CalendarClock, Crown, IndianRupee, Moon } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { CHANNELS, ChannelBadge, ReservationStatus, TierBadge } from "@/components/badges";
import { ColumnChart, SegmentedBar, StatTile, type Datum, type Part } from "@/components/charts";
import { EmptyState, IconChip, InitialsAvatar, LoadingBlock, Reveal } from "@/components/kit";
import { GuestIdentityGrid, IdDocumentList, PiiBadge } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { GuestProfile } from "@/lib/types";
import { fmtDate, inr } from "@/lib/utils";

const lakh = (n: number) => (n >= 100_000 ? `₹${(n / 100_000).toFixed(1)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}K` : `₹${n}`);

export function GuestDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["guest", id], queryFn: () => api<GuestProfile>(`/guests/${id}`) });

  if (query.isLoading) return <LoadingBlock label="Loading guest…" />;
  if (!query.data) return <EmptyState title="Guest unavailable" description="This profile may be outside your property scope." />;
  const g = query.data;

  const live = g.stays.filter((s) => s.status !== "cancelled");
  const spend = live.reduce((s, r) => s + r.total_amount, 0);
  const nights = live.reduce((s, r) => s + r.nights, 0);
  const sorted = [...g.stays].sort((a, b) => a.arrival.localeCompare(b.arrival));
  const recent = sorted.filter((s) => s.status !== "cancelled").slice(-12);
  const spendData: Datum[] = recent.map((s) => ({
    label: new Date(s.arrival).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    title: `${s.id} · ${fmtDate(s.arrival)} (${s.property_id})`,
    value: s.total_amount,
  }));
  const channelParts: Part[] = Object.entries(CHANNELS).map(([k, c]) => ({
    key: k,
    label: c.label,
    value: g.stays.filter((s) => s.channel === k).length,
    series: c.series,
  }));
  const last = sorted[sorted.length - 1];

  return (
    <div className="space-y-5">
      <div>
        <Link to="/guests" className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-primary">
          <ArrowLeft className="size-4" /> Guests
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <InitialsAvatar name={g.name} className="size-14 text-base" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{g.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-ink-3">{g.id}</span>
              {g.loyalty && (
                <Link to={`/loyalty/${g.loyalty.id}`}>
                  <TierBadge tier={g.loyalty.tier} points={g.loyalty.points} />
                </Link>
              )}
              <PiiBadge masked={g.masked} />
            </div>
          </div>
        </div>
      </div>

      <Reveal>
        <Card>
          <CardContent className="grid grid-cols-1 gap-6 py-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-border">
            <StatTile className="lg:pr-5" icon={<IconChip icon={BedDouble} tone="violet" />} label="Stays" value={g.stays.length} footer={`${g.stays.length - live.length} cancelled`} />
            <StatTile className="lg:px-5" icon={<IconChip icon={IndianRupee} tone="blue" />} label="Lifetime spend" value={spend} format={inr} footer="Excludes cancelled stays" />
            <StatTile className="lg:px-5" icon={<IconChip icon={Moon} tone="orange" />} label="Nights stayed" value={nights} footer={live.length ? `${(nights / live.length).toFixed(1)} per stay on average` : undefined} />
            <StatTile
              className="lg:pl-5"
              icon={<IconChip icon={g.loyalty ? Crown : CalendarClock} tone="amber" />}
              label="Reward points"
              value={g.loyalty ? g.loyalty.points : null}
              footer={`${g.loyalty ? "" : "Not enrolled · "}${last ? `last arrival ${fmtDate(last.arrival)}` : "no stays yet"}`}
            />
          </CardContent>
        </Card>
      </Reveal>

      <Reveal delay={0.05} className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Spend per stay</CardTitle>
              <CardDescription>{recent.length < live.length ? `Last ${recent.length} stays` : "All stays, oldest first"} · cancelled stays excluded</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {spendData.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No completed or upcoming stays.</p>
            ) : (
              <ColumnChart data={spendData} name="Stay value" series="blue" format={inr} showValues={spendData.length <= 8} height={240} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>How they book</CardTitle>
              <CardDescription>Stays by booking channel</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <SegmentedBar parts={channelParts} label="Stays by channel" />
            <div className="rounded-xl bg-[#f6f9fe] p-3.5 text-xs text-ink-2">
              Average stay value <span className="float-right font-semibold text-ink">{live.length ? lakh(Math.round(spend / live.length)) : "—"}</span>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      <Reveal delay={0.1} className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Identity &amp; contact</CardTitle>
          </CardHeader>
          <CardContent>
            <GuestIdentityGrid guest={g} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>ID documents</CardTitle>
          </CardHeader>
          <CardContent>
            <IdDocumentList docs={g.id_documents} />
          </CardContent>
        </Card>
      </Reveal>

      <Reveal delay={0.14}>
        <Card>
          <CardHeader>
            <CardTitle>Stays ({g.stays.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Reservation</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Stay</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...sorted].reverse().map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link to={`/reservations/${s.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                        {s.id}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium text-ink">{s.property_id}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {fmtDate(s.arrival)} → {fmtDate(s.departure)}
                    </TableCell>
                    <TableCell>
                      <ChannelBadge channel={s.channel} />
                    </TableCell>
                    <TableCell>
                      <ReservationStatus status={s.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium text-ink tabular-nums">{inr(s.total_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}
