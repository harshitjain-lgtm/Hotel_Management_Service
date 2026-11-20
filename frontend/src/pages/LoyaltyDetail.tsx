import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Gift, Mail, SlidersHorizontal, Snowflake } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TierBadge } from "@/components/badges";
import { AnimatedNumber, AreaTrend, StatTile } from "@/components/charts";
import { EmptyState, Field, IconChip, KeyValue, LoadingBlock, Modal, Reveal } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { balanceSeries, earnedRedeemed } from "@/lib/loyalty";
import { toast } from "@/lib/toast";
import type { LoyaltyAccountDetail } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const TIER_CARD: Record<string, string> = {
  Platinum: "bg-[linear-gradient(135deg,#5c63c7,#8b5cf6_60%,#b794f6)]",
  Gold: "bg-[linear-gradient(135deg,#d98f06,#efa00b_55%,#f6c453)]",
  Silver: "bg-[linear-gradient(135deg,#64748b,#8a96a8_60%,#b8c2d0)]",
};

export function LoyaltyDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | "adjust" | "redeem">(null);
  const [points, setPoints] = useState("");
  const [text, setText] = useState("");

  const query = useQuery({ queryKey: ["loyalty-account", id], queryFn: () => api<LoyaltyAccountDetail>(`/loyalty/accounts/${id}`) });

  const mutation = useMutation({
    mutationFn: () =>
      modal === "adjust"
        ? api(`/loyalty/accounts/${id}/adjust`, { method: "POST", body: { points: Number(points), reason: text } })
        : api(`/loyalty/accounts/${id}/redeem`, { method: "POST", body: { points: Number(points), description: text || "Reward redemption" } }),
    onSuccess: () => {
      toast.success(modal === "adjust" ? "Points adjusted" : "Points redeemed");
      qc.invalidateQueries({ queryKey: ["loyalty-account", id] });
      setModal(null);
    },
  });

  const open = (m: "adjust" | "redeem") => {
    setPoints("");
    setText("");
    setModal(m);
  };

  if (query.isLoading) return <LoadingBlock label="Loading account…" />;
  if (!query.data) return <EmptyState title="Account unavailable" description="This loyalty account could not be loaded." />;
  const a = query.data;
  const valid = modal === "adjust" ? Number(points) !== 0 && text.trim().length >= 3 : Number(points) > 0;
  const series = balanceSeries(a.points, a.transactions);
  const { earned, spent } = earnedRedeemed(a.transactions);

  return (
    <div className="space-y-5">
      <div>
        <Link to="/loyalty" className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-primary">
          <ArrowLeft className="size-4" /> Loyalty
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-ink">{a.id}</h1>
            <TierBadge tier={a.tier} />
            {a.frozen && (
              <Badge tone="red">
                <Snowflake /> Frozen
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {can("loyalty.adjust") && (
              <Button variant="outline-primary" onClick={() => open("adjust")}>
                <SlidersHorizontal /> Adjust points
              </Button>
            )}
            {can("loyalty.redeem") && (
              <Button onClick={() => open("redeem")}>
                <Gift /> Redeem
              </Button>
            )}
          </div>
        </div>
      </div>

      {a.frozen && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f8cfcf] bg-danger-soft px-4 py-3 text-sm text-[#a33131]">
          <Snowflake className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Account frozen by security.</strong> {a.frozen_reason}
          </span>
        </div>
      )}

      <Reveal className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className={cn("relative overflow-hidden rounded-2xl p-6 text-white shadow-lift", TIER_CARD[a.tier] ?? TIER_CARD.Silver)}>
          <div className="absolute -top-10 -right-10 size-40 rounded-full bg-white/15" />
          <div className="absolute -bottom-16 -left-8 size-44 rounded-full bg-white/10" />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-xs tracking-[0.18em] text-white/80 uppercase">Aranya Rewards</p>
              <p className="mt-0.5 text-lg font-semibold">{a.tier} member</p>
            </div>
            <Gift className="size-6 text-white/80" />
          </div>
          <p className="relative mt-8 text-xs text-white/80">Points balance</p>
          <p className="relative text-4xl font-semibold">
            <AnimatedNumber value={a.points} />
          </p>
          <div className="relative mt-6 flex items-end justify-between gap-3 text-sm">
            <Link to={`/guests/${a.guest_id}`} className="font-medium hover:underline">
              {a.guest_name}
            </Link>
            <span className="font-mono text-xs text-white/80">{a.id}</span>
          </div>
        </div>

        <Card className="xl:col-span-2">
          <CardContent className="grid h-full grid-cols-1 content-center gap-6 py-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
            <StatTile className="sm:pr-5" icon={<IconChip icon={ArrowUpRight} tone="green" />} label="Earned" hint="recent" value={earned} />
            <StatTile className="sm:px-5" icon={<IconChip icon={ArrowDownRight} tone="orange" />} label="Redeemed" hint="recent" value={spent} />
            <StatTile
              className="sm:pl-5"
              icon={<IconChip icon={Mail} tone="blue" />}
              label="Transactions"
              hint="shown"
              value={a.transactions.length}
              footer={<>Contact changed {fmtDateTime(a.contact_changed_at)}</>}
            />
          </CardContent>
        </Card>
      </Reveal>

      {a.transactions.length >= 2 && (
        <Reveal delay={0.06}>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Points balance</CardTitle>
                <CardDescription>
                  Balance after each of the last {a.transactions.length} transaction{a.transactions.length === 1 ? "" : "s"}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <AreaTrend data={series} name="Points balance" series="blue" curve="stepAfter" height={250} />
            </CardContent>
          </Card>
        </Reveal>
      )}

      <Reveal delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
              <KeyValue label="Member">
                <Link to={`/guests/${a.guest_id}`} className="text-primary hover:underline">
                  {a.guest_name}
                </Link>
              </KeyValue>
              <KeyValue label="Guest ID" mono>
                {a.guest_id}
              </KeyValue>
              <KeyValue label="Portal email">{a.portal_email}</KeyValue>
              <KeyValue label="Status">{a.frozen ? "Frozen" : "Active"}</KeyValue>
            </dl>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Performed by</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs text-ink-3">{fmtDateTime(t.created_at)}</TableCell>
                    <TableCell>
                      <Badge tone={t.points < 0 ? "orange" : "green"} className="capitalize">
                        {t.kind.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-ink">{t.description}</TableCell>
                    <TableCell className="text-xs">
                      {t.performed_by_type}
                      {t.performed_by ? ` · ${t.performed_by}` : ""}
                    </TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", t.points < 0 ? "text-danger" : "text-success")}>
                      {t.points > 0 ? "+" : ""}
                      {t.points.toLocaleString("en-IN")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Reveal>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === "adjust" ? "Adjust points" : "Redeem points"}
        description={modal === "adjust" ? "Use a negative number to deduct points. Manual adjustments are monitored." : `Available: ${a.points.toLocaleString("en-IN")} pts`}
        footer={
          <>
            <Button variant="outline" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!valid}>
              Confirm
            </Button>
          </>
        }
      >
        <Field label="Points">
          <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
        </Field>
        <Field label={modal === "adjust" ? "Reason" : "Reward / description"}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={modal === "adjust" ? "Service recovery…" : "Free night voucher"} />
        </Field>
      </Modal>
    </div>
  );
}
