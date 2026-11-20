import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TierBadge } from "@/components/badges";
import { EmptyState, InitialsAvatar, LoadingBlock, PageHeader, Pagination, Reveal, SearchInput, SelectField } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { GuestBrief, Paged } from "@/lib/types";
import { cn } from "@/lib/utils";

const SORTS = [
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "created_desc", label: "Recently created" },
  { value: "loyalty_points_desc", label: "Loyalty points (highest)" },
];

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
      <Reveal>
        <Card className="mb-5">
          <CardContent className="pt-5">
            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                setApplied(q);
                setPage(1);
              }}
            >
              <SearchInput className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, phone, guest or loyalty ID" aria-label="Search guests" />
              <div className="sm:w-60">
                <SelectField
                  aria-label="Sort"
                  value={sort}
                  onChange={(v) => {
                    setSort(v);
                    setPage(1);
                  }}
                  options={SORTS}
                />
              </div>
              <Button type="submit" className="h-10">
                <Search /> Search
              </Button>
            </form>
          </CardContent>
        </Card>
      </Reveal>
      <Reveal delay={0.06}>
        <Card>
          {query.isLoading ? (
            <LoadingBlock rows={8} />
          ) : !query.data || query.data.items.length === 0 ? (
            <EmptyState title="No guests found" description="Try a different name, phone number or ID." />
          ) : (
            <>
              <div className={cn("px-5 pt-5 transition-opacity", query.isFetching && "opacity-60")}>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Guest</TableHead>
                      <TableHead>Guest ID</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Nationality</TableHead>
                      <TableHead>Loyalty</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.items.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <InitialsAvatar name={g.name} />
                            <Link to={`/guests/${g.id}`} className="font-medium text-ink hover:text-primary">
                              {g.name}
                            </Link>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{g.id}</TableCell>
                        <TableCell className="font-mono text-xs">{g.phone}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs">{g.email}</TableCell>
                        <TableCell>{g.nationality}</TableCell>
                        <TableCell>{g.loyalty ? <TierBadge tier={g.loyalty.tier} points={g.loyalty.points} /> : <span className="text-ink-3">—</span>}</TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="icon-sm" className="rounded-full">
                            <Link to={`/guests/${g.id}`} aria-label={`Open ${g.name}`}>
                              <ChevronRight />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />
            </>
          )}
        </Card>
      </Reveal>
    </div>
  );
}
