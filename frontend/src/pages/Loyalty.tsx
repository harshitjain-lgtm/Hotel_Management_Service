import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, Snowflake } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TierBadge } from "@/components/badges";
import {
  Badge,
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
import type { LoyaltyAccountView, Paged } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

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
              <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Member name, email or AR… ID" />
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
              <option value="points_desc">Points (highest)</option>
              <option value="name_asc">Name (A–Z)</option>
              <option value="created_desc">Recently enrolled</option>
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
          <EmptyState title="No loyalty accounts found" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Account</TH>
                  <TH>Member</TH>
                  <TH>Portal email</TH>
                  <TH>Tier</TH>
                  <TH className="text-right">Points</TH>
                  <TH>Contact changed</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {query.data.items.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <Link to={`/loyalty/${a.id}`} className="font-mono text-[13px] font-medium text-indigo-600 hover:underline">
                        {a.id}
                      </Link>
                    </TD>
                    <TD>
                      <Link to={`/guests/${a.guest_id}`} className="font-medium text-slate-900 hover:underline">
                        {a.guest_name}
                      </Link>
                    </TD>
                    <TD className="text-xs">{a.portal_email}</TD>
                    <TD>
                      <TierBadge tier={a.tier} />
                    </TD>
                    <TD className="text-right font-medium tabular-nums">{a.points.toLocaleString("en-IN")}</TD>
                    <TD className="text-xs text-slate-500">{fmtDateTime(a.contact_changed_at)}</TD>
                    <TD>
                      {a.frozen ? (
                        <Badge color="red">
                          <Snowflake className="h-3 w-3" /> Frozen
                        </Badge>
                      ) : (
                        <Badge color="green">Active</Badge>
                      )}
                    </TD>
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
