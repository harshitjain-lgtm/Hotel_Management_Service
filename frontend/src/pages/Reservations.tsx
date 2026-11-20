import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Download, Eye, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChannelBadge, ReservationStatus, TierBadge } from "@/components/badges";
import { EmptyState, Field, InitialsAvatar, LoadingBlock, Modal, PageHeader, Pagination, Reveal, SearchInput, SelectField } from "@/components/kit";
import { useProperties } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import type { Paged, ReservationRow } from "@/lib/types";
import { cn, downloadBlob, filenameFromDisposition, fmtDate, inr, titleCase } from "@/lib/utils";

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
const KEYS = Object.keys(EMPTY) as (keyof Filters)[];

const SORTS = [
  { value: "arrival_desc", label: "Arrival (newest)" },
  { value: "arrival_asc", label: "Arrival (oldest)" },
  { value: "amount_desc", label: "Amount (highest)" },
  { value: "created_desc", label: "Recently booked" },
  { value: "loyalty_points_desc", label: "Loyalty points (highest)" },
];

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "booked", label: "Booked" },
  { value: "checked_in", label: "Checked in" },
  { value: "checked_out", label: "Checked out" },
  { value: "cancelled", label: "Cancelled" },
];

const CHANNEL_OPTIONS = [
  { value: "", label: "Any channel" },
  { value: "direct", label: "Direct" },
  { value: "walk_in", label: "Walk-in" },
  { value: "TRIPNEST", label: "TripNest" },
  { value: "STAYFINDER", label: "StayFinder" },
];

function clean(f: Filters) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")) as Partial<Filters>;
}

function fromParams(params: URLSearchParams): Filters {
  const f = { ...EMPTY };
  for (const k of KEYS) {
    const v = params.get(k);
    if (v) f[k] = v;
  }
  return f;
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
            <Download /> Export {rows.toLocaleString("en-IN")} rows
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
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Filters>(() => fromParams(params));
  const [filters, setFilters] = useState<Filters>(() => fromParams(params));
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const pageSize = 25;

  const query = useQuery({
    queryKey: ["reservations", filters, page],
    queryFn: () => api<Paged<ReservationRow>>("/reservations", { query: { ...clean(filters), page, page_size: pageSize } }),
    placeholderData: keepPreviousData,
  });

  const apply = (next: Filters) => {
    setFilters(next);
    setPage(1);
    const { sort, ...rest } = clean(next);
    setParams({ ...rest, ...(sort && sort !== EMPTY.sort ? { sort } : {}) } as Record<string, string>, { replace: true });
  };
  const set = (key: keyof Filters, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const setAndApply = (key: keyof Filters, value: string) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    apply(next);
  };
  const dirty = KEYS.some((k) => filters[k] !== EMPTY[k]);

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle="Search bookings across the properties in your scope"
        actions={
          can("reservations.export") && (
            <Button variant="outline-primary" onClick={() => setExportOpen(true)} disabled={!query.data}>
              <Download /> Export CSV
            </Button>
          )
        }
      />

      <Reveal>
        <Card className="mb-5">
          <CardContent className="pt-5">
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12"
              onSubmit={(e) => {
                e.preventDefault();
                apply(draft);
              }}
            >
              <SearchInput
                className="sm:col-span-2 lg:col-span-4"
                value={draft.q}
                onChange={(e) => set("q", e.target.value)}
                placeholder="Search guest, email, phone or STY-…"
                aria-label="Search"
              />
              <div className="lg:col-span-2">
                <SelectField
                  aria-label="Property"
                  value={draft.property}
                  onChange={(v) => setAndApply("property", v)}
                  options={[{ value: "", label: "All properties" }, ...(properties ?? []).map((p) => ({ value: p.id, label: `${p.id} · ${p.city}` }))]}
                />
              </div>
              <div className="lg:col-span-2">
                <SelectField aria-label="Channel" value={draft.channel} onChange={(v) => setAndApply("channel", v)} options={CHANNEL_OPTIONS} />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <SelectField aria-label="Sort" value={draft.sort} onChange={(v) => setAndApply("sort", v)} options={SORTS} />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-6">
                <span className="shrink-0 text-xs text-ink-3">Arrival</span>
                <Input type="date" aria-label="Arrival from" value={draft.arrival_from} onChange={(e) => set("arrival_from", e.target.value)} />
                <span className="text-ink-3">→</span>
                <Input type="date" aria-label="Arrival to" value={draft.arrival_to} onChange={(e) => set("arrival_to", e.target.value)} />
              </div>
              <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-6">
                {dirty && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDraft(EMPTY);
                      apply(EMPTY);
                    }}
                  >
                    <RotateCcw /> Reset
                  </Button>
                )}
                <Button type="submit" className="h-10">
                  <SlidersHorizontal /> Apply filters
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </Reveal>

      <Reveal delay={0.06}>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
            <Tabs value={filters.status || "all"} onValueChange={(v) => setAndApply("status", v === "all" ? "" : v)}>
              <TabsList variant="pill" className="flex-wrap">
                {STATUS_TABS.map((t) => (
                  <TabsTrigger key={t.value || "all"} value={t.value || "all"}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {query.data && (
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-ink">{query.data.total.toLocaleString("en-IN")}</span> reservations
              </p>
            )}
          </div>
          {query.isLoading ? (
            <LoadingBlock rows={8} />
          ) : !query.data || query.data.items.length === 0 ? (
            <EmptyState title="No reservations found" description="Try adjusting the filters." />
          ) : (
            <div className={cn("px-5 transition-opacity", query.isFetching && "opacity-60")}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Guest</TableHead>
                    <TableHead>Reservation</TableHead>
                    <TableHead>Stay</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <InitialsAvatar name={r.guest.name} />
                          <div className="min-w-0 leading-tight">
                            <Link to={`/guests/${r.guest.id}`} className="block max-w-[200px] truncate font-medium text-ink hover:text-primary">
                              {r.guest.name}
                            </Link>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="text-xs text-ink-3">{r.guest.phone}</span>
                              {r.guest.loyalty && <TierBadge tier={r.guest.loyalty.tier} />}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Link to={`/reservations/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                          {r.id}
                        </Link>
                        <div className="mt-0.5 text-xs text-ink-3">{r.property_id}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fmtDate(r.arrival)} → {fmtDate(r.departure)}
                        <div className="text-xs text-ink-3">
                          {r.nights} night{r.nights > 1 ? "s" : ""} · {r.adults + r.children} guest{r.adults + r.children > 1 ? "s" : ""}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {titleCase(r.room_type)}
                        {r.room_no && <span className="ml-1 text-xs text-ink-3">#{r.room_no}</span>}
                      </TableCell>
                      <TableCell>
                        <ChannelBadge channel={r.channel} />
                      </TableCell>
                      <TableCell>
                        <ReservationStatus status={r.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium text-ink tabular-nums">{inr(r.total_amount)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline-primary" size="icon-sm" className="rounded-full">
                          <Link to={`/reservations/${r.id}`} aria-label={`Open ${r.id}`}>
                            <Eye />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {query.data && query.data.total > 0 && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
        </Card>
      </Reveal>

      {exportOpen && query.data && <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} filters={filters} total={query.data.total} />}
    </div>
  );
}
