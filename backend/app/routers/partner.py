"""Partner (OTA / third-party booking platform) API, authenticated with X-Partner-Key."""

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from .. import security
from ..audit import Resource
from ..deps import Ctx, get_partner_ctx
from ..models import Guest, LoyaltyAccount, Reservation
from ..policy import is_enabled
from ..serializers import partner_full_record, vip_count
from .reservations import ROOM_RATES, new_reservation_id

router = APIRouter(prefix="/partner/v1", tags=["partner-api"])

PII_FIELDS = {"guest_name", "guest_email", "guest_phone", "nationality", "dob", "passport_no", "address_city"}


def _project(ctx: Ctx, record: dict) -> dict:
    if is_enabled(ctx.db, "ota_field_allowlist"):
        allowed = set(ctx.partner.allowed_fields or []) | {"reservation_id"}
        return {k: v for k, v in record.items() if k in allowed}
    return record


def _emit_read(ctx: Ctx, action: str, rows: list[tuple], records: list[dict], query: dict | None = None) -> None:
    returned = sorted({k for rec in records for k, v in rec.items() if v is not None})
    allowed = set(ctx.partner.allowed_fields or []) | {"reservation_id"}
    ctx.emit(action, "partner", resource=Resource(
        type="reservation",
        ids=[r.id for r, _, _ in rows], guest_ids=[g.id for _, g, _ in rows],
        properties=[r.property_id for r, _, _ in rows],
        pii_fields=sorted(PII_FIELDS & set(returned)), query=query,
        extra={"fields_returned": returned, "fields_beyond_contract": sorted(set(returned) - allowed),
               "vip_count": vip_count((g.id, la) for _, g, la in rows)},
    ))


@router.get("/reservations")
def partner_list(
    ctx: Ctx = Depends(get_partner_ctx),
    arrival_from: date | None = None,
    limit: int = Query(100, ge=1, le=500),
    page: int = Query(1, ge=1),
):
    stmt = (select(Reservation, Guest, LoyaltyAccount).join(Guest, Guest.id == Reservation.guest_id)
            .outerjoin(LoyaltyAccount, LoyaltyAccount.guest_id == Guest.id)
            .where(Reservation.channel == ctx.partner.id).order_by(Reservation.arrival.desc(), Reservation.id))
    if arrival_from:
        stmt = stmt.where(Reservation.arrival >= arrival_from)
    rows = ctx.db.execute(stmt.offset((page - 1) * limit).limit(limit)).all()
    records = [_project(ctx, partner_full_record(r, g, la)) for r, g, la in rows]
    _emit_read(ctx, "partner.reservations_read", rows, records,
               {"arrival_from": arrival_from.isoformat() if arrival_from else None, "limit": limit, "page": page})
    ctx.db.commit()
    return {"items": records, "page": page, "limit": limit}


@router.get("/reservations/{rid}")
def partner_get(rid: str, ctx: Ctx = Depends(get_partner_ctx)):
    row = ctx.db.execute(
        select(Reservation, Guest, LoyaltyAccount).join(Guest, Guest.id == Reservation.guest_id)
        .outerjoin(LoyaltyAccount, LoyaltyAccount.guest_id == Guest.id).where(Reservation.id == rid)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "reservation_not_found"})
    r, g, la = row
    if r.channel != ctx.partner.id:
        ctx.deny("partner.reservation_read", "partner", 404, "Reservation was not booked through this partner",
                 resource=Resource(type="reservation", ids=[rid]))
    record = _project(ctx, partner_full_record(r, g, la))
    _emit_read(ctx, "partner.reservation_read", [row], [record])
    ctx.db.commit()
    return record


class PartnerGuestIn(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    nationality: str = "IN"
    passport_no: str | None = None


class PartnerBookingIn(BaseModel):
    property_id: str
    arrival: date
    departure: date
    room_type: str = "deluxe"
    adults: int = 2
    children: int = 0
    guest: PartnerGuestIn


@router.post("/reservations")
def partner_create(body: PartnerBookingIn, ctx: Ctx = Depends(get_partner_ctx)):
    if body.departure <= body.arrival:
        raise HTTPException(status_code=422, detail={"error": "departure_must_be_after_arrival"})
    g = body.guest
    guest = Guest(
        id="G" + uuid.uuid4().hex[:9].upper(), first_name=g.first_name, last_name=g.last_name,
        email=g.email.lower(), phone=g.phone, nationality=g.nationality.upper()[:2],
        id_type="passport" if g.passport_no else None,
        passport_no_enc=security.encrypt_str(g.passport_no) if g.passport_no else None,
        passport_last4=g.passport_no[-4:] if g.passport_no else None,
    )
    ctx.db.add(guest)
    rid = new_reservation_id()
    nights = (body.departure - body.arrival).days
    ctx.db.add(Reservation(
        id=rid, guest_id=guest.id, property_id=body.property_id, channel=ctx.partner.id, status="booked",
        arrival=body.arrival, departure=body.departure, room_type=body.room_type, adults=body.adults,
        children=body.children, total_amount=Decimal(nights * ROOM_RATES.get(body.room_type, 7500)),
        created_by=ctx.partner.id,
    ))
    ctx.emit("partner.reservation_created", "partner",
             resource=Resource(type="reservation", ids=[rid], guest_ids=[guest.id], properties=[body.property_id]))
    ctx.db.commit()
    return {"reservation_id": rid, "status": "booked"}
