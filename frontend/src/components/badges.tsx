import { Badge, type BadgeColor } from "./ui";
import { titleCase } from "@/lib/utils";

const RES_STATUS: Record<string, BadgeColor> = {
  booked: "blue",
  checked_in: "green",
  checked_out: "slate",
  cancelled: "red",
};

export function ReservationStatus({ status }: { status: string }) {
  return <Badge color={RES_STATUS[status] ?? "slate"}>{titleCase(status)}</Badge>;
}

const FOLIO_STATUS: Record<string, BadgeColor> = {
  completed: "green",
  pending_approval: "amber",
  rejected: "red",
};

export function FolioStatus({ status }: { status: string }) {
  return <Badge color={FOLIO_STATUS[status] ?? "slate"}>{titleCase(status)}</Badge>;
}

const TIER: Record<string, BadgeColor> = { Platinum: "violet", Gold: "amber", Silver: "slate" };

export function TierBadge({ tier, points }: { tier: string; points?: number }) {
  return (
    <Badge color={TIER[tier] ?? "slate"}>
      {tier}
      {points != null && <span className="font-normal opacity-80">· {points.toLocaleString("en-IN")} pts</span>}
    </Badge>
  );
}

const CHANNEL: Record<string, string> = {
  direct: "Direct",
  walk_in: "Walk-in",
  TRIPNEST: "TripNest",
  STAYFINDER: "StayFinder",
};

export function ChannelBadge({ channel }: { channel: string }) {
  const isOta = channel === "TRIPNEST" || channel === "STAYFINDER";
  return <Badge color={isOta ? "teal" : "slate"}>{CHANNEL[channel] ?? channel}</Badge>;
}

export const RISK_LABELS: Record<string, string> = {
  unauthorized_booking_access: "Unauthorized booking access",
  account_compromise: "Account compromise",
  guest_identity_exposure: "Guest identity exposure",
  payment_workflow_compromise: "Payment workflow compromise",
  loyalty_account_misuse: "Loyalty account misuse",
  excessive_third_party_sharing: "Third-party over-sharing",
};
