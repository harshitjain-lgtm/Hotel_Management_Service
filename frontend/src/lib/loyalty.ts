import type { Datum } from "@/components/charts";
import type { LoyaltyTxn } from "./types";

/**
 * Balance after each transaction, oldest first.
 * The API returns the most recent transactions newest-first (id desc), so walking backwards from
 * the current balance gives the exact balance at every point inside that window.
 */
export function balanceSeries(current: number, txns: LoyaltyTxn[]): Datum[] {
  const newestFirst = [...txns].sort((a, b) => b.id - a.id);
  let balance = current;
  const out: Datum[] = [];
  for (const t of newestFirst) {
    const when = t.created_at ? new Date(t.created_at) : null;
    out.push({
      label: when ? when.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : `#${t.id}`,
      title: `${when ? when.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : `#${t.id}`} · ${t.description}`,
      value: balance,
    });
    balance -= t.points;
  }
  if (out.length) out.push({ label: "Start", title: "Before the earliest transaction shown", value: balance });
  return out.reverse();
}

export function earnedRedeemed(txns: LoyaltyTxn[]) {
  let earned = 0;
  let spent = 0;
  for (const t of txns) {
    if (t.points >= 0) earned += t.points;
    else spent += -t.points;
  }
  return { earned, spent };
}
