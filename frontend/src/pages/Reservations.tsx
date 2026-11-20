import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Download, Search, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChannelBadge, ReservationStatus, TierBadge } from "@/components/badges";
import { useProperties } from "@/components/shared";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
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
import type { Paged, ReservationRow } from "@/lib/types";
import { downloadBlob, filenameFromDisposition, fmtDate, inr } from "@/lib/utils";

interface Filters {
  property: string;
  status: string;
  channel: string;
  arrival_from: string;
  arrival_to: string;
  q: string;
  sort: string;
}

const EMPTY: Filters = { property: "", status: "", channel: "", arrival_from: "", arrival_to: "", q: "", sort: "arrival_desc" };

const SORTS = [
  ["arrival_desc", "Arrival (newest)"],
  ["arrival_asc", "Arrival (oldest)"],
  ["amount_desc", "Amount (highest)"],
  ["created_desc", "Recently booked"],
  ["loyalty_points_desc", "Loyalty points (highest)"],
];

function clean(f: Filters) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")) as Partial<Filters>;
}

function ExportDialog({ open, onClose, filters, total }: { open: boolean; onClose: () => void; filters: Filters; total: number }) {
  const [limit, setLimit] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api<Response>("/reservations/export", {
        method: "POST",
        body: { ...clean(filters), limit: limit ? Number(limit) : undefined },
        raw: true,
      });
      const blob = await res.blob();
      const rows = res.headers.get("X-Export-Count");
      downloadBlob(blob, filenameFromDisposition(res.headers.get("Content-Disposition"), "reservations-export.csv"));
      return rows;
    },
    onSuccess: (rows) => {
      toast.success("Export downloaded", `${Number(rows ?? 0).toLocaleString("en-IN")} reservations exported to CSV.`);
      onClose();
    },
  });
  const rows = limit ? Math.min(Number(limit), total) : total;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export reservations"
      description="Exports use the current filters and sort order. Large exports may require step-up verification."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
            <Download className="h-4 w-4" /> Export {rows.toLocaleString("en-IN")} rows
          </Button>
        </>
      }
    >
      <Field label="Row limit (optional)" hint={`${total.toLocaleString("en-IN")} reservations match the current filters`}>
        <Input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="All matching rows" />
      </Field>
    </Modal>
  );
}

export function ReservationsPage() {
  const { can } = useAuth();
  const { data: properties } = useProperties();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const pageSize = 25;

  const query = useQuery({
    queryKey: ["reservations", filters, page],
    queryFn: () =>
      api<Paged<ReservationRow>>("/reservations", { query: { ...clean(filters), page, page_size: pageSize } }),
    placeholderData: keepPreviousData,
  });

  const apply = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };
  const set = (key: keyof Filters, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const setAndApply = (key: keyof Filters, value: string) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    apply(next);
  };

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle="Search bookings across your properties"
        actions={
          can("reservations.export") && (
            <Button variant="secondary" onClick={() => setExportOpen(true)} disabled={!query.data}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <form
          className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 xl:grid-cols-8"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-8" value={draft.q} onChange={(e) => set("q", e.target.value)} placeholder="Guest, email, phone or STY-…" />
            </div>
          </div>
          <Field label="Property">
            <Select value={draft.property} onChange={(e) => setAndApply("property", e.target.value)}>
              <option value="">All in scope</option>
              {properties?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} · {p.city}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={draft.status} onChange={(e) => setAndApply("status", e.target.value)}>
              <option value="">Any</option>
              <option value="booked">Booked</option>
              <option value="checked_in">Checked in</option>
              <option value="checked_out">Checked out</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          <Field label="Channel">
            <Select value={draft.channel} onChange={(e) => setAndApply("channel", e.target.value)}>
              <option value="">Any</option>
              <option value="direct">Direct</option>
              <option value="walk_in">Walk-in</option>
              <option value="TRIPNEST">TripNest</option>
              <option value="STAYFINDER">StayFinder</option>
            </Select>
          </Field>
          <Field label="Arrival from">
            <Input type="date" value={draft.arrival_from} onChange={(e) => set("arrival_from", e.target.value)} />
          </Field>
          <Field label="Arrival to">
            <Input type="date" value={draft.arrival_to} onChange={(e) => set("arrival_to", e.target.value)} />
          </Field>
          <Field label="Sort">
            <Select value={draft.sort} onChange={(e) => setAndApply("sort", e.target.value)}>
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-8">
            <Button type="submit" size="sm">
              <Search className="h-3.5 w-3.5" /> Apply
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(EMPTY);
                apply(EMPTY);
              }}
            >
              <X className="h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {query.isLoading ? (
          <LoadingBlock />
        ) : !query.data || query.data.items.length === 0 ? (
          <EmptyState title="No reservations found" description="Try adjusting the filters." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Reservation</TH>
                  <TH>Guest</TH>
                  <TH>Contact</TH>
                  <TH>Property</TH>
                  <TH>Stay</TH>
                  <TH>Room</TH>
                  <TH>Channel</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {query.data.items.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link to={`/reservations/${r.id}`} className="font-mono text-[13px] font-medium text-indigo-600 hover:underline">
                        {r.id}
                      </Link>
                    </TD>
                    <TD>
                      <Link to={`/guests/${r.guest.id}`} className="font-medium text-slate-900 hover:underline">
                        {r.guest.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-1">
                        <span className="text-xs text-slate-500">{r.guest.nationality}</span>
                        {r.guest.loyalty && <TierBadge tier={r.guest.loyalty.tier} points={r.guest.loyalty.points} />}
                      </div>
                    </TD>
                    <TD className="text-xs text-slate-500">
                      <div className="font-mono">{r.guest.phone}</div>
                      <div className="max-w-[180px] truncate">{r.guest.email}</div>
                    </TD>
                    <TD className="font-medium">{r.property_id}</TD>
                    <TD className="whitespace-nowrap">
                      {fmtDate(r.arrival)} → {fmtDate(r.departure)}
                      <div className="text-xs text-slate-500">{r.nights} night{r.nights > 1 ? "s" : ""}</div>
                    </TD>
                    <TD className="capitalize">
                      {r.room_type}
                      {r.room_no && <span className="ml-1 text-xs text-slate-500">#{r.room_no}</span>}
                    </TD>
                    <TD>
                      <ChannelBadge channel={r.channel} />
                    </TD>
                    <TD>
                      <ReservationStatus status={r.status} />
                    </TD>
                    <TD className="text-right font-medium tabular-nums">{inr(r.total_amount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {exportOpen && query.data && (
        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} filters={filters} total={query.data.total} />
      )}
    </div>
  );
}
