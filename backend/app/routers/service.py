"""Service-to-service APIs for the monitoring platform (authenticated with X-Service-Key).

/context/*  - read-only business context the monitoring layer needs for detection and blast-radius
/control/*  - response actions the monitoring layer can execute (after human approval on its side)
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import security
from ..audit import Resource
from ..deps import Ctx, get_service_ctx
from ..models import (
    CardToken,
    Guest,
    IdDocument,
    LoyaltyAccount,
    Partner,
    PolicySetting,
    Property,
    Staff,
    StaffDevice,
    StaffSession,
)
from ..policy import policy_view
from .admin import apply_policy_change

context = APIRouter(prefix="/context", tags=["context-api"])
control = APIRouter(prefix="/control", tags=["control-api"])


# ------------------------------ context ------------------------------

@context.get("/staff")
def ctx_staff(ctx: Ctx = Depends(get_service_ctx)):
    devices: dict[str, list[str]] = {}
    for d in ctx.db.query(StaffDevice).all():
        devices.setdefault(d.staff_id, []).append(d.device_id)
    return {"items": [{
        "id": s.id, "name": s.name, "role": s.role, "home_property": s.home_property_id,
        "property_scope": list(s.property_scope or []), "mfa_enabled": s.mfa_enabled, "status": s.status,
        "shift_start": s.shift_start.strftime("%H:%M"), "shift_end": s.shift_end.strftime("%H:%M"),
        "timezone": "Asia/Kolkata", "known_devices": devices.get(s.id, []),
    } for s in ctx.db.query(Staff).order_by(Staff.id).all()]}


@context.get("/properties")
def ctx_properties(ctx: Ctx = Depends(get_service_ctx)):
    return {"items": [{"id": p.id, "name": p.name, "city": p.city, "rooms": p.rooms}
                      for p in ctx.db.query(Property).order_by(Property.id).all()]}


@context.get("/partners")
def ctx_partners(ctx: Ctx = Depends(get_service_ctx)):
    return {"items": [{"id": p.id, "name": p.name, "key_status": p.key_status, "key_prefix": p.key_prefix,
                       "allowed_fields": list(p.allowed_fields or [])}
                      for p in ctx.db.query(Partner).order_by(Partner.id).all()]}


@context.get("/policies")
def ctx_policies(ctx: Ctx = Depends(get_service_ctx)):
    return {"items": [policy_view(p) for p in ctx.db.query(PolicySetting).order_by(PolicySetting.key).all()]}


class ClassifyIn(BaseModel):
    guest_ids: list[str] = Field(max_length=50_000)


@context.post("/guests/classify")
def ctx_classify(body: ClassifyIn, ctx: Ctx = Depends(get_service_ctx)):
    """Blast-radius helper: counts of data classes for a set of guests. Returns counts only, never PII values."""
    ids = list(dict.fromkeys(body.guest_ids))
    if not ids:
        return {"requested": 0, "found": 0}
    today = date.today()
    minor_cutoff = date(today.year - 18, today.month, min(today.day, 28))
    g = Guest
    row = ctx.db.execute(
        select(
            func.count(g.id),
            func.count(g.passport_no_enc),
            func.count(g.aadhaar_last4),
            func.count().filter(g.nationality != "IN"),
            func.count().filter(g.dob > minor_cutoff),
        ).where(g.id.in_(ids))
    ).one()
    loyalty = ctx.db.execute(
        select(func.count(LoyaltyAccount.id), func.coalesce(func.sum(LoyaltyAccount.points_balance), 0))
        .where(LoyaltyAccount.guest_id.in_(ids))
    ).one()
    with_cards = ctx.db.execute(select(func.count(func.distinct(CardToken.guest_id))).where(CardToken.guest_id.in_(ids))).scalar()
    with_docs = ctx.db.execute(select(func.count(func.distinct(IdDocument.guest_id))).where(IdDocument.guest_id.in_(ids))).scalar()
    nationalities = dict(ctx.db.execute(
        select(g.nationality, func.count()).where(g.id.in_(ids)).group_by(g.nationality)
    ).all())
    return {
        "requested": len(ids),
        "found": row[0],
        "with_passport": row[1],
        "with_aadhaar_last4": row[2],
        "foreign_nationals": row[3],
        "minors": row[4],
        "loyalty_members": loyalty[0],
        "loyalty_points_total": int(loyalty[1]),
        "with_card_tokens": with_cards,
        "with_id_document_scans": with_docs,
        "by_nationality": nationalities,
        "data_classes": ["name", "email", "phone", "nationality", "dob", "passport_no", "aadhaar_last4",
                         "loyalty", "card_token_reference", "id_document_scan"],
    }


# ------------------------------ control ------------------------------

class ActionMeta(BaseModel):
    reason: str = Field(default="StaySec response action", max_length=300)
    incident_id: str | None = None
    approved_by: str | None = None


class RevokeIn(ActionMeta):
    staff_id: str


@control.post("/sessions/revoke")
def revoke_sessions(body: RevokeIn, ctx: Ctx = Depends(get_service_ctx)):
    staff = ctx.db.get(Staff, body.staff_id)
    if staff is None:
        raise HTTPException(status_code=404, detail={"error": "staff_not_found"})
    now = security.utcnow()
    active = ctx.db.query(StaffSession).filter(StaffSession.staff_id == staff.id, StaffSession.revoked_at.is_(None),
                                               StaffSession.expires_at > now).all()
    for s in active:
        s.revoked_at, s.revoked_reason, s.revoked_by = now, body.reason, f"service:{ctx.actor.id}"
    ctx.emit("control.sessions_revoked", "control", resource=Resource(type="staff", ids=[staff.id]),
             details={"sessions_revoked": len(active), **body.model_dump(exclude={"staff_id"})})
    ctx.db.commit()
    return {"staff_id": staff.id, "sessions_revoked": len(active)}


@control.post("/staff/{staff_id}/suspend")
def suspend_staff(staff_id: str, body: ActionMeta, ctx: Ctx = Depends(get_service_ctx)):
    return _set_staff_status(ctx, staff_id, "suspended", body)


@control.post("/staff/{staff_id}/reinstate")
def reinstate_staff(staff_id: str, body: ActionMeta, ctx: Ctx = Depends(get_service_ctx)):
    return _set_staff_status(ctx, staff_id, "active", body)


def _set_staff_status(ctx: Ctx, staff_id: str, status: str, body: ActionMeta) -> dict:
    staff = ctx.db.get(Staff, staff_id)
    if staff is None:
        raise HTTPException(status_code=404, detail={"error": "staff_not_found"})
    before = staff.status
    staff.status = status
    revoked = 0
    if status == "suspended":
        now = security.utcnow()
        for s in ctx.db.query(StaffSession).filter(StaffSession.staff_id == staff_id, StaffSession.revoked_at.is_(None)).all():
            s.revoked_at, s.revoked_reason, s.revoked_by = now, body.reason, f"service:{ctx.actor.id}"
            revoked += 1
    action = "control.staff_suspended" if status == "suspended" else "control.staff_reinstated"
    ctx.emit(action, "control", resource=Resource(type="staff", ids=[staff_id]),
             details={"before": before, "after": status, "sessions_revoked": revoked, **body.model_dump()})
    ctx.db.commit()
    return {"staff_id": staff_id, "status": status, "sessions_revoked": revoked}


class FreezeIn(ActionMeta):
    account_ids: list[str] = []
    guest_ids: list[str] = []


def _loyalty_targets(ctx: Ctx, body: FreezeIn) -> list[LoyaltyAccount]:
    q = ctx.db.query(LoyaltyAccount)
    if body.account_ids and body.guest_ids:
        from sqlalchemy import or_
        q = q.filter(or_(LoyaltyAccount.id.in_(body.account_ids), LoyaltyAccount.guest_id.in_(body.guest_ids)))
    elif body.account_ids:
        q = q.filter(LoyaltyAccount.id.in_(body.account_ids))
    elif body.guest_ids:
        q = q.filter(LoyaltyAccount.guest_id.in_(body.guest_ids))
    else:
        raise HTTPException(status_code=422, detail={"error": "account_ids_or_guest_ids_required"})
    return q.all()


@control.post("/loyalty/freeze")
def freeze_loyalty(body: FreezeIn, ctx: Ctx = Depends(get_service_ctx)):
    accounts = _loyalty_targets(ctx, body)
    for a in accounts:
        a.frozen, a.frozen_reason = True, body.reason
    ctx.emit("control.loyalty_frozen", "control",
             resource=Resource(type="loyalty_account", ids=[a.id for a in accounts], guest_ids=[a.guest_id for a in accounts]),
             details={"accounts_frozen": len(accounts), "points_protected": sum(a.points_balance for a in accounts),
                      **body.model_dump(exclude={"account_ids", "guest_ids"})})
    ctx.db.commit()
    return {"accounts_frozen": len(accounts)}


@control.post("/loyalty/unfreeze")
def unfreeze_loyalty(body: FreezeIn, ctx: Ctx = Depends(get_service_ctx)):
    accounts = _loyalty_targets(ctx, body)
    for a in accounts:
        a.frozen, a.frozen_reason = False, None
    ctx.emit("control.loyalty_unfrozen", "control",
             resource=Resource(type="loyalty_account", ids=[a.id for a in accounts], guest_ids=[a.guest_id for a in accounts]),
             details=body.model_dump(exclude={"account_ids", "guest_ids"}))
    ctx.db.commit()
    return {"accounts_unfrozen": len(accounts)}


@control.post("/partners/{partner_id}/rotate-key")
def rotate_partner_key(partner_id: str, body: ActionMeta, ctx: Ctx = Depends(get_service_ctx)):
    partner = ctx.db.get(Partner, partner_id)
    if partner is None:
        raise HTTPException(status_code=404, detail={"error": "partner_not_found"})
    new_key = security.new_api_key(partner.id.lower()[:8])
    partner.api_key_hash = security.hash_api_key(new_key)
    partner.key_prefix = new_key[:12]
    partner.key_status = "active"
    partner.key_rotated_at = security.utcnow()
    ctx.emit("control.partner_key_rotated", "control", resource=Resource(type="partner", ids=[partner_id]),
             details=body.model_dump())
    ctx.db.commit()
    # The new key must be delivered to the partner out-of-band; returned here for the demo.
    return {"partner_id": partner_id, "new_api_key": new_key, "key_prefix": partner.key_prefix}


class PolicyControlIn(ActionMeta):
    enabled: bool | None = None
    params: dict | None = None


@control.put("/policies/{key}")
def control_policy(key: str, body: PolicyControlIn, ctx: Ctx = Depends(get_service_ctx)):
    return apply_policy_change(ctx, key, body.enabled, body.params, "control.policy_changed",
                               details=body.model_dump(exclude={"enabled", "params"}))
