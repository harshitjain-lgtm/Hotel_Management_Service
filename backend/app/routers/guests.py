from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import exists, func, or_, select

from .. import security
from ..audit import Resource
from ..deps import Ctx, get_staff_ctx
from ..models import Guest, IdDocument, LoyaltyAccount, Reservation

from ..queries import count_rows
from ..serializers import guest_brief, guest_brief_fields, guest_full, guest_full_fields, reservation_row, vip_count

router = APIRouter(prefix="/guests", tags=["guests"])
docs_router = APIRouter(prefix="/id-documents", tags=["guests"])

GUEST_SORTS = {
    "name_asc": lambda: [Guest.last_name.asc(), Guest.first_name.asc(), Guest.id],
    "created_desc": lambda: [Guest.created_at.desc(), Guest.id],
    "loyalty_points_desc": lambda: [func.coalesce(LoyaltyAccount.points_balance, 0).desc(), Guest.id],
}

REVEALABLE = {"passport_no", "phone", "email", "dob"}


def _in_scope_clause(scope: list[str]):
    return exists(select(Reservation.id).where(Reservation.guest_id == Guest.id, Reservation.property_id.in_(scope)))


def load_guest(ctx: Ctx, gid: str, action: str) -> tuple[Guest, LoyaltyAccount | None]:
    row = ctx.db.execute(
        select(Guest, LoyaltyAccount).outerjoin(LoyaltyAccount, LoyaltyAccount.guest_id == Guest.id)
        .where(Guest.id == gid)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "guest_not_found"})
    guest, account = row
    scope = ctx.scope()
    if scope is not None:
        visible = ctx.db.execute(select(_in_scope_clause(scope)).where(Guest.id == gid)).scalar()
        if not visible:
            ctx.deny(action, "data_access", 403, "Guest has no stays at properties in this account's scope",
                     policy="property_scope", resource=Resource(type="guest", ids=[gid], guest_ids=[gid]))
    return guest, account


@router.get("")
def list_guests(
    ctx: Ctx = Depends(get_staff_ctx),
    q: str | None = None,
    sort: str = "name_asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query = {"q": q, "sort": sort, "page": page, "page_size": page_size}
    ctx.require("guests.read", "guest.search", "data_access", Resource(type="guest", query=query))
    stmt = select(Guest, LoyaltyAccount).outerjoin(LoyaltyAccount, LoyaltyAccount.guest_id == Guest.id)
    scope = ctx.scope()
    if scope is not None:
        stmt = stmt.where(_in_scope_clause(scope))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            Guest.id.ilike(like), Guest.first_name.ilike(like), Guest.last_name.ilike(like),
            (Guest.first_name + " " + Guest.last_name).ilike(like), Guest.email.ilike(like),
            Guest.phone.ilike(like), LoyaltyAccount.id.ilike(like),
        ))
    stmt = stmt.order_by(*GUEST_SORTS.get(sort, GUEST_SORTS["name_asc"])())
    total = count_rows(ctx.db, stmt)
    rows = ctx.db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    masking = ctx.masking()
    exposed, masked = guest_brief_fields(masking)
    ctx.emit("guest.search", "data_access", resource=Resource(
        type="guest", ids=[g.id for g, _ in rows], guest_ids=[g.id for g, _ in rows],
        pii_fields=exposed, masked_fields=masked, query=query,
        extra={"total_matching": total, "vip_count": vip_count((g.id, la) for g, la in rows)}))
    ctx.db.commit()
    return {"items": [guest_brief(g, la, masking) for g, la in rows], "total": total, "page": page,
            "page_size": page_size}


@router.get("/{gid}")
def get_guest(gid: str, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("guests.read", "guest.view", "data_access")
    guest, account = load_guest(ctx, gid, "guest.view")
    masking = ctx.masking()
    stays_stmt = (select(Reservation, Guest, LoyaltyAccount)
                  .join(Guest, Guest.id == Reservation.guest_id)
                  .outerjoin(LoyaltyAccount, LoyaltyAccount.guest_id == Guest.id)
                  .where(Reservation.guest_id == gid).order_by(Reservation.arrival.desc()))
    scope = ctx.scope()
    if scope is not None:
        stays_stmt = stays_stmt.where(Reservation.property_id.in_(scope))
    stays = ctx.db.execute(stays_stmt.limit(50)).all()
    docs = ctx.db.query(IdDocument).filter(IdDocument.guest_id == gid).order_by(IdDocument.uploaded_at.desc()).all()

    exposed, masked = guest_full_fields(guest, masking)
    ctx.emit("guest.view", "data_access", resource=Resource(
        type="guest", ids=[gid], guest_ids=[gid], properties=[r.property_id for r, _, _ in stays],
        pii_fields=exposed, masked_fields=masked, extra={"vip_count": vip_count([(gid, account)])}))
    ctx.db.commit()
    data = guest_full(guest, account, masking)
    data["stays"] = [reservation_row(r, g, la, masking) for r, g, la in stays]
    data["id_documents"] = [
        {"id": d.id, "doc_type": d.doc_type, "reservation_id": d.reservation_id,
         "uploaded_at": d.uploaded_at.isoformat(), "retention_until": d.retention_until.isoformat()}
        for d in docs
    ]
    return data


class RevealIn(BaseModel):
    field: str
    reason: str | None = Field(default=None, max_length=300)


@router.post("/{gid}/reveal")
def reveal(gid: str, body: RevealIn, ctx: Ctx = Depends(get_staff_ctx)):
    resource = Resource(type="guest", ids=[gid], guest_ids=[gid], pii_fields=[body.field])
    ctx.require("guests.reveal", "pii.reveal", "pii", resource)
    if body.field not in REVEALABLE:
        raise HTTPException(status_code=422, detail={"error": "field_not_revealable", "allowed": sorted(REVEALABLE)})
    guest, _ = load_guest(ctx, gid, "pii.reveal")
    masking = ctx.masking()
    reason = (body.reason or "").strip()
    if masking and len(reason) < 5:
        ctx.deny("pii.reveal", "pii", 422, "A reason is required to reveal guest identity data",
                 policy="pii_masking", resource=resource, extra={"code": "reason_required"})
    value = {
        "passport_no": lambda: security.decrypt_str(guest.passport_no_enc),
        "phone": lambda: guest.phone,
        "email": lambda: guest.email,
        "dob": lambda: guest.dob.isoformat() if guest.dob else None,
    }[body.field]()
    ctx.emit("pii.reveal", "pii", resource=resource, details={"reason": reason or None})
    ctx.db.commit()
    return {"guest_id": gid, "field": body.field, "value": value}


_PLACEHOLDER_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300">
<rect width="100%" height="100%" fill="#eef2f7"/><rect x="16" y="16" width="448" height="268" rx="12" fill="#fff" stroke="#94a3b8"/>
<text x="40" y="70" font-family="sans-serif" font-size="22" fill="#0f172a">SYNTHETIC ID DOCUMENT</text>
<text x="40" y="110" font-family="sans-serif" font-size="14" fill="#475569">Demo data - no real document stored</text>
<text x="40" y="150" font-family="monospace" font-size="14" fill="#475569">{doc}</text></svg>"""


@docs_router.get("/{doc_id}/download")
def download_document(doc_id: str, ctx: Ctx = Depends(get_staff_ctx)):
    doc = ctx.db.get(IdDocument, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail={"error": "document_not_found"})
    resource = Resource(type="id_document", ids=[doc.id], guest_ids=[doc.guest_id], pii_fields=[doc.doc_type])
    ctx.require("guests.reveal", "id_document.download", "pii", resource)
    load_guest(ctx, doc.guest_id, "id_document.download")
    ctx.emit("id_document.download", "pii", resource=resource)
    ctx.db.commit()
    path = Path(doc.storage_key)
    if path.is_file():
        return FileResponse(path)
    return Response(content=_PLACEHOLDER_SVG.format(doc=doc.id), media_type="image/svg+xml")
