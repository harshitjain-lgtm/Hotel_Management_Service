import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ChannelBadge, ReservationStatus, TierBadge } from "@/components/badges";
import { GuestIdentityGrid, IdDocumentList } from "@/components/shared";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LoadingBlock,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui";
import { api } from "@/lib/api";
import type { GuestProfile } from "@/lib/types";
import { fmtDate, inr } from "@/lib/utils";

export function GuestDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["guest", id], queryFn: () => api<GuestProfile>(`/guests/${id}`) });

  if (query.isLoading) return <LoadingBlock />;
  if (!query.data)
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        Guest unavailable. <Link to="/guests" className="text-indigo-600 hover:underline">Back to guests</Link>
      </div>
    );
  const g = query.data;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/guests" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Guests
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{g.name}</h1>
          <span className="font-mono text-sm text-slate-500">{g.id}</span>
          {g.loyalty && (
            <Link to={`/loyalty/${g.loyalty.id}`}>
              <TierBadge tier={g.loyalty.tier} points={g.loyalty.points} />
            </Link>
          )}
          {g.masked ? <Badge color="green">PII masked</Badge> : <Badge color="red">PII unmasked</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
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
            <CardTitle>Loyalty</CardTitle>
          </CardHeader>
          <CardContent>
            {g.loyalty ? (
              <div className="space-y-2">
                <p className="text-2xl font-semibold tabular-nums text-slate-900">{g.loyalty.points.toLocaleString("en-IN")} pts</p>
                <div className="flex items-center gap-2">
                  <TierBadge tier={g.loyalty.tier} />
                  <Link to={`/loyalty/${g.loyalty.id}`} className="font-mono text-xs text-indigo-600 hover:underline">
                    {g.loyalty.id}
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Not enrolled in Aranya Rewards.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Stays ({g.stays.length})</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH>Reservation</TH>
                <TH>Property</TH>
                <TH>Stay</TH>
                <TH>Channel</TH>
                <TH>Status</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {g.stays.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <Link to={`/reservations/${s.id}`} className="font-mono text-[13px] text-indigo-600 hover:underline">
                      {s.id}
                    </Link>
                  </TD>
                  <TD>{s.property_id}</TD>
                  <TD className="whitespace-nowrap">
                    {fmtDate(s.arrival)} → {fmtDate(s.departure)}
                  </TD>
                  <TD>
                    <ChannelBadge channel={s.channel} />
                  </TD>
                  <TD>
                    <ReservationStatus status={s.status} />
                  </TD>
                  <TD className="text-right tabular-nums">{inr(s.total_amount)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>ID documents</CardTitle>
          </CardHeader>
          <CardContent>
            <IdDocumentList docs={g.id_documents} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
