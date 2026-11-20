import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { FolioStatus } from "@/components/badges";
import {
  Button,
  Card,
  EmptyState,
  LoadingBlock,
  PageHeader,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import type { RefundRow } from "@/lib/types";
import { fmtDateTime, inr } from "@/lib/utils";

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
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      api(`/refunds/${id}/${approve ? "approve" : "reject"}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      toast.success(v.approve ? "Refund approved" : "Refund rejected");
      qc.invalidateQueries({ queryKey: ["refunds"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="Refund approvals"
        subtitle="Two-person rule: refunds you requested must be approved by someone else"
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
            <option value="pending_approval">Pending approval</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </Select>
        }
      />
      <Card>
        {query.isLoading ? (
          <LoadingBlock />
        ) : !query.data || query.data.items.length === 0 ? (
          <EmptyState title="Nothing here" description={status === "pending_approval" ? "No refunds are waiting for approval." : undefined} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>#</TH>
                <TH>Reservation</TH>
                <TH>Property</TH>
                <TH>Refund to</TH>
                <TH>Reason</TH>
                <TH>Requested by</TH>
                <TH>When</TH>
                <TH>Status</TH>
                <TH className="text-right">Amount</TH>
                {status === "pending_approval" && <TH className="text-right">Decision</TH>}
              </tr>
            </THead>
            <TBody>
              {query.data.items.map((r) => {
                const own = r.created_by === me?.staff.id;
                return (
                  <TR key={r.id}>
                    <TD className="font-mono text-xs text-slate-500">{r.id}</TD>
                    <TD>
                      <Link to={`/reservations/${r.reservation_id}`} className="font-mono text-[13px] text-indigo-600 hover:underline">
                        {r.reservation_id}
                      </Link>
                    </TD>
                    <TD>{r.property_id}</TD>
                    <TD className="text-xs">{r.description}</TD>
                    <TD className="max-w-[220px] truncate text-xs">{r.reason}</TD>
                    <TD className="text-xs">{r.created_by}</TD>
                    <TD className="text-xs text-slate-500">{fmtDateTime(r.created_at)}</TD>
                    <TD>
                      <FolioStatus status={r.status} />
                    </TD>
                    <TD className="text-right font-medium tabular-nums">{inr(r.amount)}</TD>
                    {status === "pending_approval" && (
                      <TD className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="success"
                            disabled={decide.isPending}
                            title={own ? "You requested this refund — another approver is required" : undefined}
                            onClick={() => decide.mutate({ id: r.id, approve: true })}
                          >
                            <Check className="h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: false })}>
                            <X className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
