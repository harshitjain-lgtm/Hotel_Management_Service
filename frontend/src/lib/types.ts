export interface StaffProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  role_label: string;
  home_property: string;
  property_scope: string[];
  mfa_enabled: boolean;
  shift: string;
  on_shift: boolean;
  permissions: string[];
}

export interface Me {
  staff: StaffProfile;
  session: {
    id: string;
    device_id: string;
    mfa_verified: boolean;
    step_up_valid_until: string | null;
    expires_at: string;
  };
  policies: Record<string, boolean>;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  staff: StaffProfile;
}

export interface MfaChallenge {
  mfa_required: true;
  challenge_token: string;
  reason: string;
}

export interface LoyaltyBrief {
  id: string;
  tier: string;
  points: number;
}

export interface GuestBrief {
  id: string;
  name: string;
  phone: string;
  email: string;
  nationality: string;
  loyalty: LoyaltyBrief | null;
}

export interface GuestFull extends GuestBrief {
  first_name: string;
  last_name: string;
  dob: string | null;
  is_minor: boolean;
  address_city: string | null;
  id_type: string | null;
  passport_no: string | null;
  aadhaar: string | null;
  masked: boolean;
}

export interface ReservationRow {
  id: string;
  property_id: string;
  status: string;
  channel: string;
  arrival: string;
  departure: string;
  nights: number;
  room_type: string;
  room_no: string | null;
  adults: number;
  children: number;
  total_amount: number;
  guest: GuestBrief;
}

export interface IdDocumentInfo {
  id: string;
  doc_type: string;
  reservation_id?: string | null;
  uploaded_at: string;
  uploaded_by?: string | null;
  retention_until: string;
}

export interface ReservationDetail extends Omit<ReservationRow, "guest"> {
  special_requests: string | null;
  created_at: string | null;
  created_by: string | null;
  guest: GuestFull;
  id_documents: IdDocumentInfo[];
  folio_summary: { charges: number; paid: number; refunded: number; balance: number };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface FolioItem {
  id: number;
  kind: "charge" | "payment" | "refund";
  amount: number;
  description: string;
  card_token: string | null;
  status: string;
  reason: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string | null;
  approved_at: string | null;
}

export interface Folio {
  reservation_id: string;
  items: FolioItem[];
  totals: { charges: number; paid: number; refunded: number; pending_refunds: number; balance: number };
  cards_on_file: { token: string; brand: string; last4: string }[];
}

export interface GuestProfile extends GuestFull {
  stays: ReservationRow[];
  id_documents: IdDocumentInfo[];
}

export interface LoyaltyAccountView {
  id: string;
  guest_id: string;
  guest_name: string | null;
  tier: string;
  points: number;
  frozen: boolean;
  frozen_reason: string | null;
  portal_email: string;
  contact_changed_at: string | null;
}

export interface LoyaltyTxn {
  id: number;
  kind: string;
  points: number;
  description: string;
  performed_by_type: string;
  performed_by: string | null;
  created_at: string | null;
}

export interface LoyaltyAccountDetail extends LoyaltyAccountView {
  transactions: LoyaltyTxn[];
}

export interface RefundRow extends FolioItem {
  reservation_id: string;
  property_id: string;
}

export interface Policy {
  key: string;
  enabled: boolean;
  params: Record<string, number>;
  title: string;
  description: string;
  gap_when_off: string;
  risk: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: string;
  role_label: string;
  home_property: string;
  property_scope: string[];
  mfa_enabled: boolean;
  status: string;
  shift: string;
}

export interface PartnerRow {
  id: string;
  name: string;
  key_prefix: string;
  key_status: string;
  allowed_fields: string[];
  key_rotated_at: string | null;
}

export interface PropertyRow {
  id: string;
  name: string;
  city: string;
  rooms: number;
}
