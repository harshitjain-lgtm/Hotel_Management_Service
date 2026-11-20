import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, FileText } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { GuestFull, IdDocumentInfo, PropertyRow } from "@/lib/types";
import { fmtDate } from "@/lib/utils";
import { Badge, Button, Field, KeyValue, Modal, Textarea } from "./ui";

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
    mutationFn: () =>
      api<{ value: string | null }>(`/guests/${guestId}/reveal`, { method: "POST", body: { field, reason } }),
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
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={reason.trim().length < 5}>
            Reveal
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
      {revealed !== undefined && <Badge color="amber">revealed</Badge>}
      {canReveal && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-0.5 rounded px-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          <Eye className="h-3.5 w-3.5" /> Reveal
        </button>
      )}
      {open && (
        <RevealDialog guestId={guestId} field={field} open={open} onClose={() => setOpen(false)} onRevealed={setRevealed} />
      )}
    </span>
  );
}

export function GuestIdentityGrid({ guest }: { guest: GuestFull }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
      <KeyValue label="Phone">
        <RevealableValue guestId={guest.id} field="phone" value={guest.phone} masked={guest.masked} />
      </KeyValue>
      <KeyValue label="Email">
        <RevealableValue guestId={guest.id} field="email" value={guest.email} masked={guest.masked} />
      </KeyValue>
      <KeyValue label="Nationality">{guest.nationality}</KeyValue>
      <KeyValue label="Date of birth">
        {guest.masked ? (
          <RevealableValue guestId={guest.id} field="dob" value="**/**/****" masked />
        ) : (
          fmtDate(guest.dob)
        )}
        {guest.is_minor && (
          <Badge color="red" className="ml-1">
            Minor
          </Badge>
        )}
      </KeyValue>
      <KeyValue label="ID type">{guest.id_type ? guest.id_type.replace(/_/g, " ") : "—"}</KeyValue>
      <KeyValue label="Passport no.">
        {guest.passport_no ? (
          <RevealableValue guestId={guest.id} field="passport_no" value={guest.passport_no} masked={guest.masked} mono />
        ) : (
          "—"
        )}
      </KeyValue>
      <KeyValue label="Aadhaar" mono>
        {guest.aadhaar ?? "—"}
      </KeyValue>
      <KeyValue label="City">{guest.address_city ?? "—"}</KeyValue>
    </dl>
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
  if (docs.length === 0) return <p className="text-sm text-slate-500">No ID documents on file.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {docs.map((d) => {
        const expired = d.retention_until < today;
        return (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-800">{d.doc_type.replace(/_/g, " ")} scan</p>
                <p className="text-xs text-slate-500">
                  Uploaded {fmtDate(d.uploaded_at)} · retain until {fmtDate(d.retention_until)}{" "}
                  {expired && <Badge color="red">past retention</Badge>}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => openDocument(d.id)}>
              View
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
