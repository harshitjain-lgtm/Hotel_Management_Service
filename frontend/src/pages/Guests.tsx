import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TierBadge } from "@/components/badges";
import {
  Button,
  Card,
  EmptyState,
  Input,
  LoadingBlock,
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
import type { GuestBrief, Paged } from "@/lib/types";

export function GuestsPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [sort, setSort] = useState("name_asc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const query = useQuery({
    queryKey: ["guests", applied, sort, page],
    queryFn: () => api<Paged<GuestBrief>>("/guests", { query: { q: applied, sort, page, page_size: pageSize } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Guests" subtitle="Guest profiles with stays at properties in your scope" />
      <Card className="mb-4">
        <form
          className="flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q);
            setPage(1);
          }}
        >
          <div className="min-w-[280px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, phone, guest or loyalty ID" />
            </div>
          </div>
          <div className="w-56">
            <label className="mb-1 block text-xs font-medium text-slate-600">Sort</label>
            <Select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="name_asc">Name (A–Z)</option>
              <option value="created_desc">Recently created</option>
              <option value="loyalty_points_desc">Loyalty points (highest)</option>
            </Select>
          </div>
          <Button type="submit" size="sm" className="h-9">
            Search
          </Button>
        </form>
      </Card>
      <Card>
        {query.isLoading ? (
          <LoadingBlock />
        ) : !query.data || query.data.items.length === 0 ? (
          <EmptyState title="No guests found" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Guest ID</TH>
                  <TH>Name</TH>
                  <TH>Phone</TH>
                  <TH>Email</TH>
                  <TH>Nationality</TH>
                  <TH>Loyalty</TH>
                </tr>
              </THead>
              <TBody>
                {query.data.items.map((g) => (
                  <TR key={g.id}>
                    <TD>
                      <Link to={`/guests/${g.id}`} className="font-mono text-[13px] font-medium text-indigo-600 hover:underline">
                        {g.id}
                      </Link>
                    </TD>
                    <TD className="font-medium text-slate-900">{g.name}</TD>
                    <TD className="font-mono text-xs">{g.phone}</TD>
                    <TD className="text-xs">{g.email}</TD>
                    <TD>{g.nationality}</TD>
                    <TD>{g.loyalty ? <TierBadge tier={g.loyalty.tier} points={g.loyalty.points} /> : <span className="text-slate-400">—</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
