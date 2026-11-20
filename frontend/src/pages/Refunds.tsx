import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDollarSign, Hourglass, UserRound, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { FolioStatus } from "@/components/badges";
import { RankedBars, StatTile } from "@/components/charts";
import { EmptyState, IconChip, LoadingBlock, PageHeader, Reveal } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import type { RefundRow } from "@/lib/types";
import { fmtDateTime, inr } from "@/lib/utils";

const STATUSES = [
  { value: "pending_approval", label: "Pending approval" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
];

export function RefundsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending_approval");
  const query = useQuery({
    queryKey: ["refunds", status],
    queryFn: () => api<{ items: RefundRow[] }>("/refunds", { query: { status } }),
    refetchInterval: 10_000,
  });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) => api(`/refunds/${id}/${approve ? "approve" : "reject"}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      toast.success(v.approve ? "Refund approved" : "Refund rejected");
      qc.invalidateQueries({ queryKey: ["refunds"] });
    },
  });

  const items = query.data?.items ?? [];
  const total = items.reduce((s, r) => s + r.amount, 0);
  const mine = items.filter((r) => r.created_by === me?.staff.id).length;
  const byProperty = Object.entries(
    items.reduce<Record<string, number>>((acc, r) => {
      acc[r.property_id] = (acc[r.property_id] ?? 0) + r.amount;
      return acc;
    }, {}),
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const label = STATUSES.find((s) => s.value === status)?.label.toLowerCase();

  return (
    <div>
      <PageHeader title="Refund approvals" subtitle="Two-person rule: refunds you requested must be approved by someone else" />

      <Tabs value={status} onValueChange={setStatus} className="mb-5">
        <TabsList variant="pill" className="rounded-xl bg-white p-1 shadow-card">
          {STATUSES.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {query.isLoading ? (
        <Card>
          <LoadingBlock rows={6} />
        </Card>
      ) : (
        <div className="space-y-5">
          <Reveal className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="grid h-full grid-cols-1 content-center gap-6 py-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
                <StatTile className="sm:pr-5" icon={<IconChip icon={Hourglass} tone="amber" />} label="Refunds" hint={label} value={items.length} />
                <StatTile className="sm:px-5" icon={<IconChip icon={CircleDollarSign} tone="blue" />} label="Total amount" value={total} format={inr} />
                <StatTile
                  className="sm:pl-5"
                  icon={<IconChip icon={UserRound} tone="violet" />}
                  label="Requested by you"
                  value={mine}
                  footer={status === "pending_approval" && mine > 0 ? "Another approver must act on these" : undefined}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Amount by property</CardTitle>
                  <CardDescription>All {label} refunds</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {byProperty.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">No refunds in this state.</p>
                ) : (
                  <RankedBars data={byProperty} name="Refund amount by property" format={inr} series="amber" />
                )}
              </CardContent>
            </Card>
          </Reveal>

          <Reveal delay={0.06}>
            <Card>
              {items.length === 0 ? (
                <EmptyState title="Nothing here" description={status === "pending_approval" ? "No refunds are waiting for approval." : undefined} />
              ) : (
                <div className="p-5">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>#</TableHead>
                        <TableHead>Reservation</TableHead>
                        <TableHead>Property</TableHead>
                        <TableHead>Refund to</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Requested by</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        {status === "pending_approval" && <TableHead className="text-right">Decision</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((r) => {
                        const own = r.created_by === me?.staff.id;
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs text-ink-3">{r.id}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Link to={`/reservations/${r.reservation_id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                                {r.reservation_id}
                              </Link>
                            </TableCell>
                            <TableCell className="font-medium text-ink">{r.property_id}</TableCell>
                            <TableCell className="text-xs">{r.description}</TableCell>
                            <TableCell className="max-w-[220px] truncate text-xs" title={r.reason ?? undefined}>
                              {r.reason}
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.created_by}
                              {own && <span className="ml-1 text-ink-3">(you)</span>}
                            </TableCell>
                            <TableCell className="text-xs text-ink-3">{fmtDateTime(r.created_at)}</TableCell>
                            <TableCell>
                              <FolioStatus status={r.status} />
                            </TableCell>
                            <TableCell className="text-right font-semibold text-ink tabular-nums">{inr(r.amount)}</TableCell>
                            {status === "pending_approval" && (
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1.5">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        <Button size="sm" variant="success" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true })}>
                                          <Check /> Approve
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    {own && <TooltipContent>You requested this refund — another approver is required</TooltipContent>}
                                  </Tooltip>
                                  <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: false })}>
                                    <X /> Reject
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </Reveal>
        </div>
      )}
    </div>
  );
}
