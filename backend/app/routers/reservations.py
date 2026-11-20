import csv
import io
import secrets
import string
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import security
from ..audit import Resource
from ..config import get_settings
from ..deps import Ctx, get_staff_ctx
from ..models import FolioItem, Guest, IdDocument, LoyaltyAccount, Reservation
from ..pii import find_card_numbers, scrub_card_numbers
from ..policy import get_policy, is_enabled
from ..queries import ReservationFilters, count_rows, reservation_query
from ..serializers import (
    EXPORT_COLUMNS,
    export_fields,
    export_row,
    guest_brief_fields,
    guest_full,
    guest_full_fields,
    reservation_row,
    vip_count,
)

router = APIRouter(prefix="/reservations", tags=["reservations"])

ROOM_RATES = {"standard": 4500, "deluxe": 7500, "premier": 11000, "suite": 18000}
MAX_EXPORT_ROWS = 50_000


def new_reservation_id() -> str:
    return "STY-" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))


def load_reservation(ctx: Ctx, rid: str, action: str) -> tuple[Reservation, Guest, LoyaltyAccount | None]:
    row = ctx.db.execute(
        select(Reservation, Guest, LoyaltyAccount)
        .join(Guest, Guest.id == Reservation.guest_id)
        .outerjoin(LoyaltyAccount, LoyaltyAccount.guest_id == Guest.id)
        .where(Reservation.id == rid)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "reservation_not_found"})
    r, g, la = row
    ctx.check_property(r.property_id, action, "data_access",
                       Resource(type="reservation", ids=[r.id], guest_ids=[g.id], properties=[r.property_id]))
    return r, g, la


def apply_card_scrubbing(ctx: Ctx, text: str | None, resource: Resource) -> tuple[str | None, dict]:
    """Detect card numbers in free text. Control ON: remove them. Control OFF: keep them, but flag it in the event."""
    found = find_card_numbers(text)
    if not found:
        return text, {}
    if is_enabled(ctx.db, "card_number_scrubbing"):
        ctx.emit("pii.card_number_scrubbed", "pii", resource=resource, policy="card_number_scrubbing",
                 details={"card_numbers_removed": len(found)})
        return scrub_card_numbers(text), {"card_numbers_removed": len(found)}
    return text, {"card_number_stored_in_free_text": True, "card_numbers_detected": len(found)}


@router.get("")
def list_reservations(
    ctx: Ctx = Depends(get_staff_ctx),
    property: str | None = None,
    status: str | None = None,
    q: str | None = None,
    arrival_from: date | None = None,
    arrival_to: date | None = None,
    channel: str | None = None,
    sort: str = "arrival_desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    filters = ReservationFilters(property, status, q, arrival_from, arrival_to, channel, sort)
    resource_base = Resource(type="reservation", query={**filters.as_query(), "page": page, "page_size": page_size})
    ctx.require("reservations.read", "reservation.search", "data_access", resource_base)
    if property:
        ctx.check_property(property, "reservation.search", "data_access", resource_base)

    stmt = reservation_query(filters, ctx.scope())
    total = count_rows(ctx.db, stmt)
    rows = ctx.db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    masking = ctx.masking()
    items = [reservation_row(r, g, la, masking) for r, g, la in rows]

    exposed, masked = guest_brief_fields(masking)
    ctx.emit("reservation.search", "data_access", resource=Resource(
        type="reservation",
        ids=[r.id for r, _, _ in rows],
        guest_ids=[g.id for _, g, _ in rows],
        properties=[r.property_id for r, _, _ in rows],
        pii_fields=exposed, masked_fields=masked,
        query={**filters.as_query(), "page": page, "page_size": page_size},
        extra={"total_matching": total, "vip_count": vip_count((g.id, la) for _, g, la in rows)},
    ))
    ctx.db.commit()
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{rid}")
def get_reservation(rid: str, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("reservations.read", "reservation.view", "data_access")
    r, g, la = load_reservation(ctx, rid, "reservation.view")
    masking = ctx.masking()
    docs = ctx.db.query(IdDocument).filter(IdDocument.guest_id == g.id).order_by(IdDocument.uploaded_at.desc()).all()
    folio = ctx.db.query(FolioItem).filter(FolioItem.reservation_id == r.id).all()
    charges = sum((f.amount for f in folio if f.kind == "charge"), Decimal(0))
    paid = sum((f.amount for f in folio if f.kind == "payment"), Decimal(0))
    refunded = sum((f.amount for f in folio if f.kind == "refund" and f.status == "completed"), Decimal(0))

    exposed, masked = guest_full_fields(g, masking)
    ctx.emit("reservation.view", "data_access", resource=Resource(
        type="reservation", ids=[r.id], guest_ids=[g.id], properties=[r.property_id],
        pii_fields=exposed, masked_fields=masked, extra={"vip_count": vip_count([(g.id, la)])}))
    ctx.db.commit()

    data = reservation_row(r, g, la, masking)
    data.update({
        "special_requests": r.special_requests,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "created_by": r.created_by,
        "guest": guest_full(g, la, masking),
        "id_documents": [
            {"id": d.id, "doc_type": d.doc_type, "uploaded_at": d.uploaded_at.isoformat(),
             "uploaded_by": d.uploaded_by, "retention_until": d.retention_until.isoformat()}
            for d in docs
        ],
        "folio_summary": {
            "charges": float(charges),
            "paid": float(paid),
            "refunded": float(refunded),
            "balance": float(charges - paid + refunded),
        },
    })
    return data


class ExportIn(BaseModel):
    property: str | None = None
    status: str | None = None
    q: str | None = None
    arrival_from: date | None = None
    arrival_to: date | None = None
    channel: str | None = None
    sort: str = "arrival_desc"
    limit: int | None = Field(default=None, ge=1, le=MAX_EXPORT_ROWS)


@router.post("/export")
def export_reservations(body: ExportIn, ctx: Ctx = Depends(get_staff_ctx)):
    filters = ReservationFilters(body.property, body.status, body.q, body.arrival_from, body.arrival_to,
                                 body.channel, body.sort)
    query = {**filters.as_query(), "limit": body.limit}
    ctx.require("reservations.export", "reservation.export", "data_access", Resource(type="reservation", query=query))
    if body.property:
        ctx.check_property(body.property, "reservation.export", "data_access", Resource(type="reservation", query=query))

    stmt = reservation_query(filters, ctx.scope())
    matching = count_rows(ctx.db, stmt)
    rows_to_export = min(matching, body.limit or MAX_EXPORT_ROWS)

    enabled, params = get_policy(ctx.db, "export_step_up")
    threshold = int(params.get("threshold", 500))
    if enabled and rows_to_export > threshold:
        window = timedelta(minutes=int(params.get("window_minutes", 5)))
        step_up_at = ctx.session.step_up_at
        if step_up_at is None or step_up_at + window < security.utcnow():
            ctx.deny("reservation.export", "data_access", 403,
                     f"Export of {rows_to_export} rows exceeds {threshold}; step-up MFA required",
                     policy="export_step_up",
                     resource=Resource(type="reservation", count=rows_to_export, query=query),
                     extra={"code": "step_up_required", "rows": rows_to_export, "threshold": threshold})

    rows = ctx.db.execute(stmt.limit(rows_to_export)).all()
    masking = ctx.masking()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    for r, g, la in rows:
        writer.writerow(export_row(r, g, la, masking))

    exposed, masked = export_fields(masking)
    ctx.emit("reservation.export", "data_access", resource=Resource(
        type="reservation",
        ids=[r.id for r, _, _ in rows],
        guest_ids=[g.id for _, g, _ in rows],
        properties=[r.property_id for r, _, _ in rows],
        pii_fields=exposed, masked_fields=masked,
        query=query,
        extra={"format": "csv", "bytes": len(buffer.getvalue()), "vip_count": vip_count((g.id, la) for _, g, la in rows)},
    ))
    ctx.db.commit()
    filename = f"reservations-export-{date.today().isoformat()}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Export-Count": str(len(rows))},
    )


class NewGuestIn(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    nationality: str = "IN"
    dob: date | None = None
    passport_no: str | None = None
    aadhaar_last4: str | None = Field(default=None, min_length=4, max_length=4)
    address_city: str | None = None


class CreateReservationIn(BaseModel):
    property_id: str
    guest_id: str | None = None
    guest: NewGuestIn | None = None
    arrival: date
    departure: date
    room_type: str = "deluxe"
    adults: int = 2
    children: int = 0
    channel: str = "direct"
    special_requests: str | None = None


def create_guest(ctx: Ctx, data: NewGuestIn) -> Guest:
    guest = Guest(
        id="G" + uuid.uuid4().hex[:9].upper(),
        first_name=data.first_name, last_name=data.last_name, email=data.email.lower(), phone=data.phone,
        nationality=data.nationality.upper()[:2], dob=data.dob, address_city=data.address_city,
        id_type="passport" if data.passport_no else ("aadhaar" if data.aadhaar_last4 else None),
        passport_no_enc=security.encrypt_str(data.passport_no) if data.passport_no else None,
        passport_last4=data.passport_no[-4:] if data.passport_no else None,
        aadhaar_last4=data.aadhaar_last4,
    )
    ctx.db.add(guest)
    return guest


@router.post("")
def create_reservation(body: CreateReservationIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("reservations.write", "reservation.create", "data_access")
    ctx.check_property(body.property_id, "reservation.create", "data_access")
    if body.departure <= body.arrival:
        raise HTTPException(status_code=422, detail={"error": "departure_must_be_after_arrival"})
    if body.guest_id:
        guest = ctx.db.get(Guest, body.guest_id)
        if guest is None:
            raise HTTPException(status_code=404, detail={"error": "guest_not_found"})
    elif body.guest:
        guest = create_guest(ctx, body.guest)
    else:
        raise HTTPException(status_code=422, detail={"error": "guest_or_guest_id_required"})

    rid = new_reservation_id()
    resource = Resource(type="reservation", ids=[rid], guest_ids=[guest.id], properties=[body.property_id])
    notes, scrub_details = apply_card_scrubbing(ctx, body.special_requests, resource)
    nights = (body.departure - body.arrival).days
    reservation = Reservation(
        id=rid, guest_id=guest.id, property_id=body.property_id, channel=body.channel, status="booked",
        arrival=body.arrival, departure=body.departure, room_type=body.room_type, adults=body.adults,
        children=body.children, total_amount=Decimal(nights * ROOM_RATES.get(body.room_type, 7500)),
        special_requests=notes, created_by=ctx.staff.id,
    )
    ctx.db.add(reservation)
    ctx.emit("reservation.create", "data_access", resource=resource,
             details={"new_guest": body.guest_id is None, **scrub_details})
    ctx.db.commit()
    return {"id": rid, "guest_id": guest.id, "status": "booked", **scrub_details}


class NotesIn(BaseModel):
    special_requests: str


@router.patch("/{rid}/notes")
def update_notes(rid: str, body: NotesIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("reservations.write", "reservation.update", "data_access")
    r, g, _ = load_reservation(ctx, rid, "reservation.update")
    resource = Resource(type="reservation", ids=[r.id], guest_ids=[g.id], properties=[r.property_id])
    notes, scrub_details = apply_card_scrubbing(ctx, body.special_requests, resource)
    r.special_requests = notes
    ctx.emit("reservation.update", "data_access", resource=resource,
             details={"fields": ["special_requests"], **scrub_details})
    ctx.db.commit()
    return {"id": r.id, "special_requests": r.special_requests, **scrub_details}


@router.post("/{rid}/check-in")
async def check_in(
    rid: str,
    ctx: Ctx = Depends(get_staff_ctx),
    room_no: str = Form(...),
    doc_type: str | None = Form(None),
    id_document: UploadFile | None = File(None),
):
    ctx.require("reservations.write", "reservation.check_in", "data_access")
    r, g, _ = load_reservation(ctx, rid, "reservation.check_in")
    if r.status != "booked":
        raise HTTPException(status_code=409, detail={"error": f"cannot_check_in_from_{r.status}"})
    r.status = "checked_in"
    r.room_no = room_no
    resource = Resource(type="reservation", ids=[r.id], guest_ids=[g.id], properties=[r.property_id])
    ctx.emit("reservation.check_in", "data_access", resource=resource, details={"room_no": room_no})

    doc_id = None
    if id_document is not None and id_document.filename:
        doc_id = str(uuid.uuid4())
        suffix = Path(id_document.filename).suffix.lower()[:8] or ".bin"
        storage_dir = Path(get_settings().id_doc_dir)
        storage_dir.mkdir(parents=True, exist_ok=True)
        path = storage_dir / f"{doc_id}{suffix}"
        path.write_bytes(await id_document.read())
        ctx.db.add(IdDocument(
            id=doc_id, guest_id=g.id, reservation_id=r.id, doc_type=doc_type or g.id_type or "id_card",
            storage_key=str(path), uploaded_by=ctx.staff.id, retention_until=r.departure + timedelta(days=180),
        ))
        ctx.emit("id_document.upload", "pii", resource=Resource(
            type="id_document", ids=[doc_id], guest_ids=[g.id], properties=[r.property_id],
            pii_fields=[doc_type or g.id_type or "id_card"]))
    ctx.db.commit()
    return {"id": r.id, "status": r.status, "room_no": r.room_no, "id_document_id": doc_id}


@router.post("/{rid}/check-out")
def check_out(rid: str, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("reservations.write", "reservation.check_out", "data_access")
    r, g, _ = load_reservation(ctx, rid, "reservation.check_out")
    if r.status != "checked_in":
        raise HTTPException(status_code=409, detail={"error": f"cannot_check_out_from_{r.status}"})
    r.status = "checked_out"
    ctx.emit("reservation.check_out", "data_access",
             resource=Resource(type="reservation", ids=[r.id], guest_ids=[g.id], properties=[r.property_id]))
    ctx.db.commit()
    return {"id": r.id, "status": r.status}
