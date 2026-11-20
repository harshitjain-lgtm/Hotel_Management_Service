"""Response shaping. Masking decisions live here so lists, detail views and exports stay consistent,
and so every response can report exactly which PII fields it exposed."""

from datetime import date

from . import pii, security
from .models import Guest, LoyaltyAccount, Reservation


def guest_name(g: Guest) -> str:
    return f"{g.first_name} {g.last_name}"


def is_minor(g: Guest) -> bool:
    if not g.dob:
        return False
    today = date.today()
    years = today.year - g.dob.year - ((today.month, today.day) < (g.dob.month, g.dob.day))
    return years < 18


def guest_brief(g: Guest, la: LoyaltyAccount | None, masking: bool) -> dict:
    return {
        "id": g.id,
        "name": guest_name(g),
        "phone": pii.mask_phone(g.phone) if masking else g.phone,
        "email": pii.mask_email(g.email) if masking else g.email,
        "nationality": g.nationality,
        "loyalty": {"id": la.id, "tier": la.tier, "points": la.points_balance} if la else None,
    }


def guest_brief_fields(masking: bool) -> tuple[list[str], list[str]]:
    """(exposed PII fields, masked PII fields) for guest_brief."""
    if masking:
        return ["name", "nationality"], ["phone", "email"]
    return ["name", "nationality", "phone", "email"], []


def guest_full(g: Guest, la: LoyaltyAccount | None, masking: bool) -> dict:
    data = guest_brief(g, la, masking)
    data.update({
        "first_name": g.first_name,
        "last_name": g.last_name,
        "dob": None if masking else (g.dob.isoformat() if g.dob else None),
        "is_minor": is_minor(g),
        "address_city": g.address_city,
        "id_type": g.id_type,
        "passport_no": (pii.mask_passport(g.passport_last4) if masking else security.decrypt_str(g.passport_no_enc)),
        "aadhaar": pii.mask_aadhaar(g.aadhaar_last4),
        "masked": masking,
    })
    return data


def guest_full_fields(g: Guest, masking: bool) -> tuple[list[str], list[str]]:
    exposed, masked = guest_brief_fields(masking)
    exposed = exposed + ["address_city"]
    if masking:
        masked = masked + ["dob"]
        if g.passport_last4:
            masked.append("passport_no")
    else:
        exposed.append("dob")
        if g.passport_last4:
            exposed.append("passport_no")
    if g.aadhaar_last4:
        masked = masked + ["aadhaar"]  # only last 4 digits are ever stored
    return exposed, masked


def reservation_row(r: Reservation, g: Guest, la: LoyaltyAccount | None, masking: bool) -> dict:
    return {
        "id": r.id,
        "property_id": r.property_id,
        "status": r.status,
        "channel": r.channel,
        "arrival": r.arrival.isoformat(),
        "departure": r.departure.isoformat(),
        "nights": (r.departure - r.arrival).days,
        "room_type": r.room_type,
        "room_no": r.room_no,
        "adults": r.adults,
        "children": r.children,
        "total_amount": float(r.total_amount),
        "guest": guest_brief(g, la, masking),
    }


EXPORT_COLUMNS = [
    "reservation_id", "property", "status", "channel", "arrival", "departure", "room_type", "total_amount",
    "guest_id", "guest_name", "phone", "email", "nationality", "dob", "id_type", "passport_no", "aadhaar",
    "loyalty_id", "loyalty_tier", "loyalty_points",
]


def export_row(r: Reservation, g: Guest, la: LoyaltyAccount | None, masking: bool) -> list:
    return [
        r.id, r.property_id, r.status, r.channel, r.arrival.isoformat(), r.departure.isoformat(), r.room_type,
        f"{r.total_amount:.2f}", g.id, guest_name(g),
        pii.mask_phone(g.phone) if masking else g.phone,
        pii.mask_email(g.email) if masking else g.email,
        g.nationality,
        "" if masking else (g.dob.isoformat() if g.dob else ""),
        g.id_type or "",
        (pii.mask_passport(g.passport_last4) if masking else security.decrypt_str(g.passport_no_enc)) or "",
        pii.mask_aadhaar(g.aadhaar_last4) or "",
        la.id if la else "", la.tier if la else "", la.points_balance if la else "",
    ]


def export_fields(masking: bool) -> tuple[list[str], list[str]]:
    if masking:
        return ["name", "nationality", "id_type", "loyalty"], ["phone", "email", "dob", "passport_no", "aadhaar"]
    return ["name", "nationality", "id_type", "loyalty", "phone", "email", "dob", "passport_no"], ["aadhaar"]


# ---- partner (OTA) projection ----

PARTNER_FIELDS = [
    "reservation_id", "property_id", "status", "arrival", "departure", "room_type", "adults", "children",
    "total_amount", "guest_name", "guest_email", "guest_phone", "nationality", "dob", "passport_no",
    "address_city", "loyalty_tier", "loyalty_points",
]


def partner_full_record(r: Reservation, g: Guest, la: LoyaltyAccount | None) -> dict:
    return {
        "reservation_id": r.id,
        "property_id": r.property_id,
        "status": r.status,
        "arrival": r.arrival.isoformat(),
        "departure": r.departure.isoformat(),
        "room_type": r.room_type,
        "adults": r.adults,
        "children": r.children,
        "total_amount": float(r.total_amount),
        "guest_name": guest_name(g),
        "guest_email": g.email,
        "guest_phone": g.phone,
        "nationality": g.nationality,
        "dob": g.dob.isoformat() if g.dob else None,
        "passport_no": security.decrypt_str(g.passport_no_enc),
        "address_city": g.address_city,
        "loyalty_tier": la.tier if la else None,
        "loyalty_points": la.points_balance if la else None,
    }
