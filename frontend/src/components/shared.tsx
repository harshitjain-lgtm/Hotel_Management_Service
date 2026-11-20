import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, FileText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { GuestFull, IdDocumentInfo, PropertyRow } from "@/lib/types";
import { fmtDate } from "@/lib/utils";
import { Field, KeyValue, Modal } from "./kit";

export function useProperties() {
  return useQuery({
    queryKey: ["properties"],
    queryFn: () => api<{ items: PropertyRow[] }>("/admin/properties"),
    staleTime: 5 * 60_000,
    select: (d) => d.items,
  });
}

const FIELD_LABELS: Record<string, string> = {
  passport_no: "passport number",
  phone: "phone number",
  email: "email",
  dob: "date of birth",
};

function RevealDialog({
  guestId,
  field,
  open,
  onClose,
  onRevealed,
}: {
  guestId: string;
  field: string;
  open: boolean;
  onClose: () => void;
  onRevealed: (value: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => api<{ value: string | null }>(`/guests/${guestId}/reveal`, { method: "POST", body: { field, reason } }),
    onSuccess: (res) => {
      onRevealed(res.value);
      toast.info("Value revealed", "This access was logged with your reason.");
      setReason("");
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reveal ${FIELD_LABELS[field] ?? field}`}
      description="Guest identity data is masked by default. Revealing it is logged and monitored."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={reason.trim().length < 5}>
            <Eye /> Reveal
          </Button>
        </>
      }
    >
      <Field label="Business reason" hint="Minimum 5 characters, e.g. 'Verifying ID at check-in'">
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why do you need this value?" />
      </Field>
    </Modal>
  );
}

export function RevealableValue({
  guestId,
  field,
  value,
  masked,
  mono,
}: {
  guestId: string;
  field: string;
  value: string | null;
  masked: boolean;
  mono?: boolean;
}) {
  const [revealed, setRevealed] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const shown = revealed !== undefined ? revealed : value;
  const canReveal = masked && revealed === undefined && value != null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={mono ? "font-mono text-[13px]" : undefined}>{shown ?? "—"}</span>
      {revealed !== undefined && <Badge tone="amber">revealed</Badge>}
      {canReveal && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary-soft"
        >
          <Eye className="size-3.5" /> Reveal
        </button>
      )}
      {open && <RevealDialog guestId={guestId} field={field} open={open} onClose={() => setOpen(false)} onRevealed={setRevealed} />}
    </span>
  );
}

export function GuestIdentityGrid({ guest }: { guest: GuestFull }) {
  return (
    <div className="@container">
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @xs:grid-cols-2 @2xl:grid-cols-3">
      <KeyValue label="Phone">
        <RevealableValue guestId={guest.id} field="phone" value={guest.phone} masked={guest.masked} />
      </KeyValue>
      <KeyValue label="Email">
        <RevealableValue guestId={guest.id} field="email" value={guest.email} masked={guest.masked} />
      </KeyValue>
      <KeyValue label="Nationality">{guest.nationality}</KeyValue>
      <KeyValue label="Date of birth">
        {guest.masked ? <RevealableValue guestId={guest.id} field="dob" value="**/**/****" masked /> : fmtDate(guest.dob)}
        {guest.is_minor && (
          <Badge tone="red" className="ml-1">
            Minor
          </Badge>
        )}
      </KeyValue>
      <KeyValue label="ID type">{guest.id_type ? guest.id_type.replace(/_/g, " ") : "—"}</KeyValue>
      <KeyValue label="Passport no.">
        {guest.passport_no ? <RevealableValue guestId={guest.id} field="passport_no" value={guest.passport_no} masked={guest.masked} mono /> : "—"}
      </KeyValue>
      <KeyValue label="Aadhaar" mono>
        {guest.aadhaar ?? "—"}
      </KeyValue>
      <KeyValue label="City">{guest.address_city ?? "—"}</KeyValue>
    </dl>
    </div>
  );
}

export function PiiBadge({ masked }: { masked: boolean }) {
  return masked ? (
    <Badge tone="green">
      <ShieldCheck /> PII masked
    </Badge>
  ) : (
    <Badge tone="red">PII unmasked</Badge>
  );
}

export async function openDocument(docId: string) {
  try {
    const res = await api<Response>(`/id-documents/${docId}/download`, { raw: true });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank", "noopener");
  } catch (err) {
    toast.fromError(err);
  }
}

export function IdDocumentList({ docs }: { docs: IdDocumentInfo[] }) {
  const today = new Date().toISOString().slice(0, 10);
  if (docs.length === 0) return <p className="text-sm text-muted-foreground">No ID documents on file.</p>;
  return (
    <ul className="space-y-2.5">
      {docs.map((d) => {
        const expired = d.retention_until < today;
        return (
          <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-[#fafcff] p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <FileText className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink capitalize">{d.doc_type.replace(/_/g, " ")} scan</p>
                <p className="text-xs text-muted-foreground">
                  Uploaded {fmtDate(d.uploaded_at)} · retain until {fmtDate(d.retention_until)} {expired && <Badge tone="red">past retention</Badge>}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => openDocument(d.id)}>
              View
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
