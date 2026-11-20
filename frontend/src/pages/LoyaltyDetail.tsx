import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Gift, SlidersHorizontal, Snowflake } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TierBadge } from "@/components/badges";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  KeyValue,
  LoadingBlock,
  Modal,
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
import type { LoyaltyAccountDetail } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

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

  if (query.isLoading) return <LoadingBlock />;
  if (!query.data)
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        Account unavailable. <Link to="/loyalty" className="text-indigo-600 hover:underline">Back</Link>
      </div>
    );
  const a = query.data;
  const valid = modal === "adjust" ? Number(points) !== 0 && text.trim().length >= 3 : Number(points) > 0;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/loyalty" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Loyalty
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-xl font-semibold text-slate-900">{a.id}</h1>
            <TierBadge tier={a.tier} />
            {a.frozen && (
              <Badge color="red">
                <Snowflake className="h-3 w-3" /> Frozen
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {can("loyalty.adjust") && (
              <Button variant="secondary" onClick={() => open("adjust")}>
                <SlidersHorizontal className="h-4 w-4" /> Adjust points
              </Button>
            )}
            {can("loyalty.redeem") && (
              <Button onClick={() => open("redeem")}>
                <Gift className="h-4 w-4" /> Redeem
              </Button>
            )}
          </div>
        </div>
      </div>

      {a.frozen && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Account frozen by security.</strong> {a.frozen_reason}
        </div>
      )}

      <Card>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
            <KeyValue label="Member">
              <Link to={`/guests/${a.guest_id}`} className="text-indigo-600 hover:underline">
                {a.guest_name}
              </Link>
            </KeyValue>
            <KeyValue label="Balance">
              <span className="text-lg font-semibold tabular-nums">{a.points.toLocaleString("en-IN")}</span> pts
            </KeyValue>
            <KeyValue label="Portal email">{a.portal_email}</KeyValue>
            <KeyValue label="Contact changed">{fmtDateTime(a.contact_changed_at)}</KeyValue>
            <KeyValue label="Guest ID" mono>
              {a.guest_id}
            </KeyValue>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Type</TH>
              <TH>Description</TH>
              <TH>Performed by</TH>
              <TH className="text-right">Points</TH>
            </tr>
          </THead>
          <TBody>
            {a.transactions.map((t) => (
              <TR key={t.id}>
                <TD className="text-xs text-slate-500">{fmtDateTime(t.created_at)}</TD>
                <TD className="capitalize">{t.kind.replace("_", " ")}</TD>
                <TD>{t.description}</TD>
                <TD className="text-xs">
                  {t.performed_by_type}
                  {t.performed_by ? ` · ${t.performed_by}` : ""}
                </TD>
                <TD className={`text-right font-medium tabular-nums ${t.points < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {t.points > 0 ? "+" : ""}
                  {t.points.toLocaleString("en-IN")}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === "adjust" ? "Adjust points" : "Redeem points"}
        description={modal === "adjust" ? "Use a negative number to deduct points. Manual adjustments are monitored." : `Available: ${a.points.toLocaleString("en-IN")} pts`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
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
