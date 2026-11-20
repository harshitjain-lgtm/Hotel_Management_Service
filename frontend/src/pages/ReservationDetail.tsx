import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, LogIn, LogOut, Plus, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChannelBadge, FolioStatus, ReservationStatus, TierBadge } from "@/components/badges";
import { GuestIdentityGrid, IdDocumentList } from "@/components/shared";
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
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import type { Folio, ReservationDetail } from "@/lib/types";
import { fmtDate, fmtDateTime, inr, titleCase } from "@/lib/utils";

type FolioModal = null | "charge" | "payment" | "refund";

function CardPicker({
  cards,
  token,
  setToken,
  number,
  setNumber,
}: {
  cards: Folio["cards_on_file"];
  token: string;
  setToken: (v: string) => void;
  number: string;
  setNumber: (v: string) => void;
}) {
  return (
    <>
      <Field label="Card">
        <Select value={token} onChange={(e) => setToken(e.target.value)}>
          {cards.map((c) => (
            <option key={c.token} value={c.token}>
              {c.brand.toUpperCase()} •••• {c.last4} (on file)
            </option>
          ))}
          <option value="__new">New card…</option>
        </Select>
      </Field>
      {token === "__new" && (
        <Field label="Card number" hint="Tokenised by the payment gateway immediately — never stored by StayDesk.">
          <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="4111 1111 1111 1111" className="font-mono" />
        </Field>
      )}
    </>
  );
}

function FolioActions({ rid, folio, modal, setModal }: { rid: string; folio: Folio; modal: FolioModal; setModal: (m: FolioModal) => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [token, setToken] = useState("");
  const [number, setNumber] = useState("");

  useEffect(() => {
    setAmount(modal === "payment" ? String(Math.max(folio.totals.balance, 0) || "") : "");
    setDescription("");
    setReason("");
    setNumber("");
    setToken(folio.cards_on_file[0]?.token ?? "__new");
  }, [modal, folio]);

  const card = token === "__new" ? { card_number: number } : { card_token: token };
  const mutation = useMutation({
    mutationFn: () => {
      if (modal === "charge") return api(`/reservations/${rid}/charges`, { method: "POST", body: { amount: Number(amount), description } });
      if (modal === "payment") return api(`/reservations/${rid}/payments`, { method: "POST", body: { amount: Number(amount), ...card } });
      return api<{ status: string }>(`/reservations/${rid}/refunds`, { method: "POST", body: { amount: Number(amount), reason, ...card } });
    },
    onSuccess: (res) => {
      const status = (res as { status?: string } | undefined)?.status;
      if (modal === "refund" && status === "pending_approval") {
        toast.warning("Refund submitted for approval", "A second finance/manager user must approve it.");
      } else {
        toast.success(modal === "charge" ? "Charge added" : modal === "payment" ? "Payment captured" : "Refund completed");
      }
      qc.invalidateQueries({ queryKey: ["folio", rid] });
      qc.invalidateQueries({ queryKey: ["reservation", rid] });
      setModal(null);
    },
  });

  const valid =
    Number(amount) > 0 &&
    (modal !== "charge" || description.trim().length > 0) &&
    (modal !== "refund" || reason.trim().length >= 3) &&
    (modal === "charge" || token !== "__new" || number.replace(/\D/g, "").length >= 13);

  const titles: Record<string, string> = { charge: "Add charge", payment: "Take payment", refund: "Request refund" };
  return (
    <Modal
      open={modal !== null}
      onClose={() => setModal(null)}
      title={modal ? titles[modal] : ""}
      description={
        modal === "refund"
          ? `Refundable: ${inr(folio.totals.paid - folio.totals.refunded - folio.totals.pending_refunds)}`
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => setModal(null)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!valid}>
            {modal ? titles[modal] : ""}
          </Button>
        </>
      }
    >
      <Field label="Amount (INR)">
        <Input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {modal === "charge" && (
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Minibar, spa, laundry…" />
        </Field>
      )}
      {(modal === "payment" || modal === "refund") && (
        <CardPicker cards={folio.cards_on_file} token={token} setToken={setToken} number={number} setNumber={setNumber} />
      )}
      {modal === "refund" && (
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill gesture, overcharge…" />
        </Field>
      )}
    </Modal>
  );
}

function CheckInDialog({ rid, open, onClose }: { rid: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [room, setRoom] = useState("");
  const [docType, setDocType] = useState("passport");
  const [file, setFile] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("room_no", room);
      form.append("doc_type", docType);
      if (file) form.append("id_document", file);
      return api(`/reservations/${rid}/check-in`, { method: "POST", form });
    },
    onSuccess: () => {
      toast.success("Guest checked in", file ? "ID document stored encrypted with a retention date." : undefined);
      qc.invalidateQueries({ queryKey: ["reservation", rid] });
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Check in guest"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!room.trim()}>
            <LogIn className="h-4 w-4" /> Check in
          </Button>
        </>
      }
    >
      <Field label="Room number">
        <Input autoFocus value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 412" />
      </Field>
      <Field label="ID document type">
        <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="passport">Passport</option>
          <option value="aadhaar">Aadhaar (masked copy)</option>
          <option value="driving_licence">Driving licence</option>
        </Select>
      </Field>
      <Field label="ID document scan (optional)" hint="Required for foreign nationals (Form C reporting).">
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
        />
      </Field>
    </Modal>
  );
}

function SpecialRequests({ r }: { r: ReservationDetail }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [text, setText] = useState(r.special_requests ?? "");
  useEffect(() => setText(r.special_requests ?? ""), [r.special_requests]);
  const mutation = useMutation({
    mutationFn: () =>
      api<{ special_requests: string; card_numbers_removed?: number; card_number_stored_in_free_text?: boolean }>(
        `/reservations/${r.id}/notes`,
        { method: "PATCH", body: { special_requests: text } },
      ),
    onSuccess: (res) => {
      if (res.card_numbers_removed) {
        toast.warning("Card number removed", `${res.card_numbers_removed} card number(s) were scrubbed from the note (PCI DSS).`);
      } else if (res.card_number_stored_in_free_text) {
        toast.error("Card number stored in plain text", "Card-number scrubbing is OFF — this note now holds card data.");
      } else {
        toast.success("Special requests saved");
      }
      setText(res.special_requests ?? "");
      qc.invalidateQueries({ queryKey: ["reservation", r.id] });
    },
  });
  const editable = can("reservations.write");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Special requests &amp; notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!editable} placeholder="No special requests" />
        {editable && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={text === (r.special_requests ?? "")}>
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReservationDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [checkIn, setCheckIn] = useState(false);
  const [folioModal, setFolioModal] = useState<FolioModal>(null);

  const res = useQuery({ queryKey: ["reservation", id], queryFn: () => api<ReservationDetail>(`/reservations/${id}`) });
  const folio = useQuery({
    queryKey: ["folio", id],
    queryFn: () => api<Folio>(`/reservations/${id}/folio`),
    enabled: can("folio.read") && res.isSuccess,
  });
  const checkOut = useMutation({
    mutationFn: () => api(`/reservations/${id}/check-out`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Guest checked out");
      qc.invalidateQueries({ queryKey: ["reservation", id] });
    },
  });

  if (res.isLoading) return <LoadingBlock />;
  if (!res.data)
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        Reservation unavailable. <Link to="/reservations" className="text-indigo-600 hover:underline">Back to reservations</Link>
      </div>
    );
  const r = res.data;
  const g = r.guest;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/reservations" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Reservations
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-semibold text-slate-900">{r.id}</h1>
            <ReservationStatus status={r.status} />
            <ChannelBadge channel={r.channel} />
            <Badge color="indigo">{r.property_id}</Badge>
          </div>
          {can("reservations.write") && (
            <div className="flex gap-2">
              {r.status === "booked" && (
                <Button onClick={() => setCheckIn(true)}>
                  <LogIn className="h-4 w-4" /> Check in
                </Button>
              )}
              {r.status === "checked_in" && (
                <Button variant="secondary" onClick={() => checkOut.mutate()} loading={checkOut.isPending}>
                  <LogOut className="h-4 w-4" /> Check out
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Stay</CardTitle>
              <span className="text-xs text-slate-500">
                Booked {fmtDateTime(r.created_at)} by {r.created_by ?? "—"}
              </span>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                <KeyValue label="Arrival">{fmtDate(r.arrival)}</KeyValue>
                <KeyValue label="Departure">{fmtDate(r.departure)}</KeyValue>
                <KeyValue label="Nights">{r.nights}</KeyValue>
                <KeyValue label="Guests">
                  {r.adults} adult{r.adults > 1 ? "s" : ""}
                  {r.children > 0 ? `, ${r.children} child${r.children > 1 ? "ren" : ""}` : ""}
                </KeyValue>
                <KeyValue label="Room type">{titleCase(r.room_type)}</KeyValue>
                <KeyValue label="Room no.">{r.room_no ?? "—"}</KeyValue>
                <KeyValue label="Total">{inr(r.total_amount)}</KeyValue>
                <KeyValue label="Balance">{inr(r.folio_summary.balance)}</KeyValue>
              </dl>
            </CardContent>
          </Card>

          {can("folio.read") && (
            <Card>
              <CardHeader>
                <CardTitle>Folio</CardTitle>
                <div className="flex gap-2">
                  {can("folio.write") && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setFolioModal("charge")} disabled={!folio.data}>
                        <Plus className="h-3.5 w-3.5" /> Charge
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setFolioModal("payment")} disabled={!folio.data}>
                        <CreditCard className="h-3.5 w-3.5" /> Payment
                      </Button>
                    </>
                  )}
                  {can("refund.create") && (
                    <Button size="sm" variant="secondary" onClick={() => setFolioModal("refund")} disabled={!folio.data}>
                      <RotateCcw className="h-3.5 w-3.5" /> Refund
                    </Button>
                  )}
                </div>
              </CardHeader>
              {folio.isLoading || !folio.data ? (
                <LoadingBlock />
              ) : (
                <>
                  <Table>
                    <THead>
                      <tr>
                        <TH>#</TH>
                        <TH>Type</TH>
                        <TH>Description</TH>
                        <TH>Status</TH>
                        <TH>By</TH>
                        <TH>When</TH>
                        <TH className="text-right">Amount</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {folio.data.items.length === 0 && (
                        <tr>
                          <TD colSpan={7} className="py-6 text-center text-slate-500">
                            No folio entries yet.
                          </TD>
                        </tr>
                      )}
                      {folio.data.items.map((f) => (
                        <TR key={f.id}>
                          <TD className="font-mono text-xs text-slate-500">{f.id}</TD>
                          <TD className="capitalize">{f.kind}</TD>
                          <TD>
                            {f.description}
                            {f.reason && <div className="text-xs text-slate-500">Reason: {f.reason}</div>}
                          </TD>
                          <TD>
                            <FolioStatus status={f.status} />
                          </TD>
                          <TD className="text-xs">
                            {f.created_by ?? "—"}
                            {f.approved_by && <div className="text-slate-500">approved: {f.approved_by}</div>}
                          </TD>
                          <TD className="text-xs text-slate-500">{fmtDateTime(f.created_at)}</TD>
                          <TD className={`text-right font-medium tabular-nums ${f.kind === "charge" ? "" : "text-emerald-700"}`}>
                            {f.kind === "charge" ? "" : "−"}
                            {inr(f.amount)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-5 py-3 text-sm md:grid-cols-5">
                    <KeyValue label="Charges">{inr(folio.data.totals.charges)}</KeyValue>
                    <KeyValue label="Paid">{inr(folio.data.totals.paid)}</KeyValue>
                    <KeyValue label="Refunded">{inr(folio.data.totals.refunded)}</KeyValue>
                    <KeyValue label="Pending refunds">{inr(folio.data.totals.pending_refunds)}</KeyValue>
                    <KeyValue label="Balance">
                      <span className="font-semibold">{inr(folio.data.totals.balance)}</span>
                    </KeyValue>
                  </div>
                </>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Guest</CardTitle>
              {g.masked ? <Badge color="green">PII masked</Badge> : <Badge color="red">PII unmasked</Badge>}
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Link to={`/guests/${g.id}`} className="text-base font-semibold text-slate-900 hover:underline">
                  {g.name}
                </Link>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{g.id}</span>
                  {g.loyalty && (
                    <Link to={`/loyalty/${g.loyalty.id}`}>
                      <TierBadge tier={g.loyalty.tier} points={g.loyalty.points} />
                    </Link>
                  )}
                </div>
              </div>
              <GuestIdentityGrid guest={g} />
            </CardContent>
          </Card>
          <SpecialRequests r={r} />
          <Card>
            <CardHeader>
              <CardTitle>ID documents</CardTitle>
            </CardHeader>
            <CardContent>
              <IdDocumentList docs={r.id_documents} />
            </CardContent>
          </Card>
        </div>
      </div>

      {checkIn && <CheckInDialog rid={r.id} open={checkIn} onClose={() => setCheckIn(false)} />}
      {folio.data && <FolioActions rid={r.id} folio={folio.data} modal={folioModal} setModal={setFolioModal} />}
    </div>
  );
}
