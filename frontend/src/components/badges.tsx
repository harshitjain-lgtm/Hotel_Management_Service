import { Crown } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { SeriesKey } from "./charts";
import { titleCase } from "@/lib/utils";

/*
 * Entity → colour mappings. Badges and chart series share them so an entity keeps one
 * colour everywhere (e.g. "Checked in" is green in a pill and in a segmented bar).
 */

export const RES_STATUS: Record<string, { tone: BadgeTone; series: SeriesKey; label: string }> = {
  booked: { tone: "blue", series: "blue", label: "Booked" },
  checked_in: { tone: "green", series: "green", label: "Checked in" },
  checked_out: { tone: "violet", series: "periwinkle", label: "Checked out" },
  cancelled: { tone: "slate", series: "gray", label: "Cancelled" },
};

export function ReservationStatus({ status }: { status: string }) {
  const s = RES_STATUS[status];
  return (
    <Badge tone={s?.tone ?? "slate"}>
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {s?.label ?? titleCase(status)}
    </Badge>
  );
}

const FOLIO_STATUS: Record<string, BadgeTone> = {
  completed: "green",
  pending_approval: "amber",
  rejected: "red",
};

export function FolioStatus({ status }: { status: string }) {
  return <Badge tone={FOLIO_STATUS[status] ?? "slate"}>{titleCase(status)}</Badge>;
}

const TIER: Record<string, BadgeTone> = { Platinum: "violet", Gold: "amber", Silver: "slate" };

export function TierBadge({ tier, points }: { tier: string; points?: number }) {
  return (
    <Badge tone={TIER[tier] ?? "slate"}>
      <Crown />
      {tier}
      {points != null && <span className="font-normal opacity-80">· {points.toLocaleString("en-IN")} pts</span>}
    </Badge>
  );
}

export const CHANNELS: Record<string, { label: string; tone: BadgeTone; series: SeriesKey }> = {
  direct: { label: "Direct", tone: "blue", series: "blue" },
  walk_in: { label: "Walk-in", tone: "amber", series: "amber" },
  TRIPNEST: { label: "TripNest", tone: "green", series: "green" },
  STAYFINDER: { label: "StayFinder", tone: "violet", series: "periwinkle" },
};

export function ChannelBadge({ channel }: { channel: string }) {
  const c = CHANNELS[channel];
  return <Badge tone={c?.tone ?? "slate"}>{c?.label ?? channel}</Badge>;
}

export const RISK_LABELS: Record<string, string> = {
  unauthorized_booking_access: "Unauthorized booking access",
  account_compromise: "Account compromise",
  guest_identity_exposure: "Guest identity exposure",
  payment_workflow_compromise: "Payment workflow compromise",
  loyalty_account_misuse: "Loyalty account misuse",
  excessive_third_party_sharing: "Third-party over-sharing",
};

/** Short names for the Policy Center controls (keys come from /auth/me policies). */
export const CONTROL_LABELS: Record<string, string> = {
  property_scope: "Property scope",
  new_device_mfa: "New-device MFA",
  export_step_up: "Export step-up",
  pii_masking: "PII masking",
  refund_dual_approval: "Two-person refunds",
  loyalty_cooling_off: "Loyalty cooling-off",
  ota_field_allowlist: "OTA allowlist",
  card_number_scrubbing: "Card scrubbing",
};
