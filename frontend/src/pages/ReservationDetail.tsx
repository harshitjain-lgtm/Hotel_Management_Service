import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BedDouble, CalendarDays, CreditCard, LogIn, LogOut, Moon, Plus, RotateCcw, Save, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChannelBadge, FolioStatus, ReservationStatus, TierBadge } from "@/components/badges";
import { MeterRow, RadialGauge } from "@/components/charts";
import { EmptyState, Field, IconChip, InitialsAvatar, KeyValue, LoadingBlock, Modal, Reveal, SelectField } from "@/components/kit";
import { GuestIdentityGrid, IdDocumentList, PiiBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import type { Folio, ReservationDetail } from "@/lib/types";
import { cn, fmtDate, fmtDateTime, inr, titleCase } from "@/lib/utils";

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
        <SelectField
          value={token}
          onChange={setToken}
          options={[
            ...cards.map((c) => ({ value: c.token, label: `${c.brand.toUpperCase()} •••• ${c.last4} (on file)` })),
            { value: "__new", label: "New card…" },
          ]}
        />
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
      description={modal === "refund" ? `Refundable: ${inr(folio.totals.paid - folio.totals.refunded - folio.totals.pending_refunds)}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={() => setModal(null)}>
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!room.trim()}>
            <LogIn /> Check in
          </Button>
        </>
      }
    >
      <Field label="Room number">
        <Input autoFocus value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 412" />
      </Field>
      <Field label="ID document type">
        <SelectField
          value={docType}
          onChange={setDocType}
          options={[
            { value: "passport", label: "Passport" },
            { value: "aadhaar", label: "Aadhaar (masked copy)" },
            { value: "driving_licence", label: "Driving licence" },
          ]}
        />
      </Field>
      <Field label="ID document scan (optional)" hint="Required for foreign nationals (Form C reporting).">
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full cursor-pointer rounded-lg border border-dashed border-input bg-[#fafcff] p-2 text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-strong hover:file:bg-[#d4e8fc]"
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
      api<{ special_requests: string; card_numbers_removed?: number; card_number_stored_in_free_text?: boolean }>(`/reservations/${r.id}/notes`, {
        method: "PATCH",
        body: { special_requests: text },
      }),
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
      <CardContent className="space-y-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!editable} placeholder="No special requests" />
        {editable && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={text === (r.special_requests ?? "")}>
              <Save /> Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StayProgress({ r }: { r: ReservationDetail }) {
  const day = 86_400_000;
  const start = new Date(r.arrival).getTime();
  const now = Date.now();
  const elapsed = Math.floor((now - start) / day);
  if (r.status === "checked_in") {
    const night = Math.min(r.nights, Math.max(1, elapsed + 1));
    return <MeterRow label="Stay progress" value={night} max={r.nights} display={`Night ${night} of ${r.nights}`} series="green" />;
  }
  if (r.status === "booked") {
    const days = Math.ceil((start - now) / day);
    return (
      <p className="text-xs text-ink-2">
        {days > 0 ? (
          <>
            Arrives in <span className="font-medium text-ink">{days}</span> day{days > 1 ? "s" : ""}
          </>
        ) : (
          "Arriving today"
        )}
      </p>
    );
  }
  return <MeterRow label="Stay progress" value={r.status === "checked_out" ? r.nights : 0} max={r.nights} display={r.status === "checked_out" ? "Completed" : "Cancelled"} series={r.status === "checked_out" ? "periwinkle" : "gray"} />;
}

function FolioSummary({ folio }: { folio: Folio }) {
  const t = folio.totals;
  const net = t.paid - t.refunded;
  const ratio = t.charges > 0 ? net / t.charges : 0;
  const max = Math.max(t.charges, t.paid, 1);
  return (
    <div className="grid grid-cols-1 items-center gap-6 border-b border-border px-5 pb-5 md:grid-cols-[220px_1fr]">
      <RadialGauge
        value={Math.max(0, net)}
        max={Math.max(t.charges, 1)}
        severity={ratio >= 1 ? "good" : "warning"}
        caption="Settled"
        center={<span className="text-2xl leading-none font-semibold text-ink">{t.charges > 0 ? Math.round(Math.min(ratio, 9.99) * 100) : 0}%</span>}
      />
      <div className="space-y-3.5">
        <MeterRow label="Charges" value={t.charges} max={max} display={inr(t.charges)} series="blue" />
        <MeterRow label="Paid" value={t.paid} max={max} display={inr(t.paid)} series="green" />
        <MeterRow label="Refunded" value={t.refunded} max={max} display={inr(t.refunded)} series="periwinkle" />
        <MeterRow label="Pending refunds" value={t.pending_refunds} max={max} display={inr(t.pending_refunds)} series="amber" />
        <div className="flex items-center justify-between rounded-xl bg-[#f6f9fe] px-3.5 py-2.5 text-sm">
          <span className="text-ink-2">Balance due</span>
          <span className={cn("font-semibold tabular-nums", t.balance > 0 ? "text-danger" : "text-success")}>{inr(t.balance)}</span>
        </div>
      </div>
    </div>
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

  if (res.isLoading) return <LoadingBlock label="Loading reservation…" />;
  if (!res.data)
    return (
      <EmptyState title="Reservation unavailable" description="It may be outside your property scope, or it doesn't exist." />
    );
  const r = res.data;
  const g = r.guest;
  const guests = `${r.adults} adult${r.adults > 1 ? "s" : ""}${r.children > 0 ? `, ${r.children} child${r.children > 1 ? "ren" : ""}` : ""}`;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/reservations" className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-primary">
          <ArrowLeft className="size-4" /> Reservations
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-ink">{r.id}</h1>
            <ReservationStatus status={r.status} />
            <ChannelBadge channel={r.channel} />
            <Badge tone="solid">{r.property_id}</Badge>
          </div>
          {can("reservations.write") && (
            <div className="flex gap-2">
              {r.status === "booked" && (
                <Button onClick={() => setCheckIn(true)}>
                  <LogIn /> Check in
                </Button>
              )}
              {r.status === "checked_in" && (
                <Button variant="outline-primary" onClick={() => checkOut.mutate()} loading={checkOut.isPending}>
                  <LogOut /> Check out
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Reveal>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Stay</CardTitle>
                  <CardDescription>
                    Booked {fmtDateTime(r.created_at)} by {r.created_by ?? "—"}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {[
                    { icon: CalendarDays, tone: "violet" as const, label: "Arrival", value: fmtDate(r.arrival) },
                    { icon: CalendarDays, tone: "orange" as const, label: "Departure", value: fmtDate(r.departure) },
                    { icon: Moon, tone: "blue" as const, label: "Nights", value: String(r.nights) },
                    { icon: Users, tone: "green" as const, label: "Guests", value: guests },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center gap-3 rounded-xl border border-border bg-[#fafcff] p-3">
                      <IconChip icon={s.icon} tone={s.tone} size="sm" />
                      <div className="min-w-0 leading-tight">
                        <p className="text-[11px] text-ink-3">{s.label}</p>
                        <p className="truncate text-sm font-medium text-ink">{s.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <StayProgress r={r} />
                <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <KeyValue label="Room type">
                    <span className="inline-flex items-center gap-1.5">
                      <BedDouble className="size-4 text-ink-3" /> {titleCase(r.room_type)}
                    </span>
                  </KeyValue>
                  <KeyValue label="Room no.">{r.room_no ?? "—"}</KeyValue>
                  <KeyValue label="Total">{inr(r.total_amount)}</KeyValue>
                  <KeyValue label="Balance">
                    <span className={r.folio_summary.balance > 0 ? "font-semibold text-danger" : "font-semibold text-success"}>{inr(r.folio_summary.balance)}</span>
                  </KeyValue>
                </dl>
              </CardContent>
            </Card>
          </Reveal>

          {can("folio.read") && (
            <Reveal delay={0.06}>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <IconChip icon={Wallet} tone="blue" size="sm" />
                    <CardTitle>Folio</CardTitle>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {can("folio.write") && (
                      <>
                        <Button size="sm" variant="soft" onClick={() => setFolioModal("charge")} disabled={!folio.data}>
                          <Plus /> Charge
                        </Button>
                        <Button size="sm" variant="soft" onClick={() => setFolioModal("payment")} disabled={!folio.data}>
                          <CreditCard /> Payment
                        </Button>
                      </>
                    )}
                    {can("refund.create") && (
                      <Button size="sm" variant="outline" onClick={() => setFolioModal("refund")} disabled={!folio.data}>
                        <RotateCcw /> Refund
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {folio.isLoading || !folio.data ? (
                  <LoadingBlock rows={4} />
                ) : (
                  <>
                    <FolioSummary folio={folio.data} />
                    <div className="p-5">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead>#</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>By</TableHead>
                            <TableHead>When</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {folio.data.items.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                                No folio entries yet.
                              </TableCell>
                            </TableRow>
                          )}
                          {folio.data.items.map((f) => (
                            <TableRow key={f.id}>
                              <TableCell className="font-mono text-xs text-ink-3">{f.id}</TableCell>
                              <TableCell>
                                <Badge tone={f.kind === "charge" ? "blue" : f.kind === "payment" ? "green" : "violet"} className="capitalize">
                                  {f.kind}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className="text-ink">{f.description}</span>
                                {f.reason && <div className="text-xs text-ink-3">Reason: {f.reason}</div>}
                              </TableCell>
                              <TableCell>
                                <FolioStatus status={f.status} />
                              </TableCell>
                              <TableCell className="text-xs">
                                {f.created_by ?? "—"}
                                {f.approved_by && <div className="text-ink-3">approved: {f.approved_by}</div>}
                              </TableCell>
                              <TableCell className="text-xs text-ink-3">{fmtDateTime(f.created_at)}</TableCell>
                              <TableCell className={cn("text-right font-semibold tabular-nums", f.kind === "charge" ? "text-ink" : "text-success")}>
                                {f.kind === "charge" ? "" : "−"}
                                {inr(f.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </Card>
            </Reveal>
          )}
        </div>

        <div className="space-y-5">
          <Reveal delay={0.04}>
            <Card>
              <CardHeader>
                <CardTitle>Guest</CardTitle>
                <PiiBadge masked={g.masked} />
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center gap-3">
                  <InitialsAvatar name={g.name} className="size-12 text-sm" />
                  <div className="min-w-0">
                    <Link to={`/guests/${g.id}`} className="block truncate text-base font-semibold text-ink hover:text-primary">
                      {g.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-3">{g.id}</span>
                      {g.loyalty && (
                        <Link to={`/loyalty/${g.loyalty.id}`}>
                          <TierBadge tier={g.loyalty.tier} points={g.loyalty.points} />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
                <GuestIdentityGrid guest={g} />
              </CardContent>
            </Card>
          </Reveal>
          <Reveal delay={0.08}>
            <SpecialRequests r={r} />
          </Reveal>
          <Reveal delay={0.12}>
            <Card>
              <CardHeader>
                <CardTitle>ID documents</CardTitle>
              </CardHeader>
              <CardContent>
                <IdDocumentList docs={r.id_documents} />
              </CardContent>
            </Card>
          </Reveal>
        </div>
      </div>

      {checkIn && <CheckInDialog rid={r.id} open={checkIn} onClose={() => setCheckIn(false)} />}
      {folio.data && <FolioActions rid={r.id} folio={folio.data} modal={folioModal} setModal={setFolioModal} />}
    </div>
  );
}
