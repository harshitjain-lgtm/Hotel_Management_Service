import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Search, Snowflake } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TierBadge } from "@/components/badges";
import { EmptyState, InitialsAvatar, LoadingBlock, PageHeader, Pagination, Reveal, SearchInput, SelectField } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { LoyaltyAccountView, Paged } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const SORTS = [
  { value: "points_desc", label: "Points (highest)" },
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "created_desc", label: "Recently enrolled" },
];

export function LoyaltyPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [sort, setSort] = useState("points_desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const query = useQuery({
    queryKey: ["loyalty", applied, sort, page],
    queryFn: () => api<Paged<LoyaltyAccountView>>("/loyalty/accounts", { query: { q: applied, sort, page, page_size: pageSize } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Aranya Rewards" subtitle="Loyalty accounts, balances and activity" />
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
              <SearchInput className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Member name, email or AR… ID" aria-label="Search members" />
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
            <EmptyState title="No loyalty accounts found" />
          ) : (
            <>
              <div className={cn("px-5 pt-5 transition-opacity", query.isFetching && "opacity-60")}>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Member</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Portal email</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead>Contact changed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.items.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <InitialsAvatar name={a.guest_name} />
                            <Link to={`/guests/${a.guest_id}`} className="font-medium text-ink hover:text-primary">
                              {a.guest_name}
                            </Link>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Link to={`/loyalty/${a.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                            {a.id}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs">{a.portal_email}</TableCell>
                        <TableCell>
                          <TierBadge tier={a.tier} />
                        </TableCell>
                        <TableCell className="text-right font-semibold text-ink tabular-nums">{a.points.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-xs text-ink-3">{fmtDateTime(a.contact_changed_at)}</TableCell>
                        <TableCell>
                          {a.frozen ? (
                            <Badge tone="red">
                              <Snowflake /> Frozen
                            </Badge>
                          ) : (
                            <Badge tone="green">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="icon-sm" className="rounded-full">
                            <Link to={`/loyalty/${a.id}`} aria-label={`Open ${a.id}`}>
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
