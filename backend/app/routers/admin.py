"""Admin: Policy Center (security toggles), staff and partner configuration."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import security
from ..audit import Resource
from ..deps import Ctx, get_staff_ctx
from ..models import Partner, PolicySetting, Property, Staff
from ..policy import POLICY_DEFS, policy_view
from ..rbac import ROLE_LABELS, ROLE_PERMISSIONS
from ..serializers import PARTNER_FIELDS

router = APIRouter(prefix="/admin", tags=["admin"])


def apply_policy_change(ctx: Ctx, key: str, enabled: bool | None, params: dict | None, action: str,
                        details: dict | None = None) -> dict:
    if key not in POLICY_DEFS:
        raise HTTPException(status_code=404, detail={"error": "unknown_policy"})
    setting = ctx.db.get(PolicySetting, key)
    before = {"enabled": setting.enabled, "params": dict(setting.params or {})}
    if enabled is not None:
        setting.enabled = enabled
    if params:
        allowed = set(POLICY_DEFS[key]["params"])
        setting.params = {**(setting.params or {}), **{k: v for k, v in params.items() if k in allowed}}
    setting.updated_by = ctx.actor.id
    setting.updated_at = security.utcnow()
    after = {"enabled": setting.enabled, "params": dict(setting.params or {})}
    ctx.emit(action, "admin" if ctx.actor.type == "staff" else "control",
             resource=Resource(type="policy", ids=[key]),
             details={"policy": key, "before": before, "after": after,
                      "control_disabled": before["enabled"] and not after["enabled"], **(details or {})})
    ctx.db.commit()
    return policy_view(setting)


@router.get("/policies")
def list_policies(ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("admin.manage", "admin.policies_view", "admin")
    return {"items": [policy_view(p) for p in ctx.db.query(PolicySetting).order_by(PolicySetting.key).all()]}


class PolicyUpdateIn(BaseModel):
    enabled: bool | None = None
    params: dict | None = None


@router.put("/policies/{key}")
def update_policy(key: str, body: PolicyUpdateIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("admin.manage", "admin.policy_changed", "admin", Resource(type="policy", ids=[key]))
    return apply_policy_change(ctx, key, body.enabled, body.params, "admin.policy_changed")


@router.get("/staff")
def list_staff(ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("admin.manage", "admin.staff_view", "admin")
    staff = ctx.db.query(Staff).order_by(Staff.home_property_id, Staff.role, Staff.id).all()
    return {"items": [{
        "id": s.id, "name": s.name, "email": s.email, "role": s.role, "role_label": ROLE_LABELS.get(s.role, s.role),
        "home_property": s.home_property_id, "property_scope": list(s.property_scope or []),
        "mfa_enabled": s.mfa_enabled, "status": s.status,
        "shift": f"{s.shift_start.strftime('%H:%M')}-{s.shift_end.strftime('%H:%M')}",
    } for s in staff], "roles": {r: sorted(p) for r, p in ROLE_PERMISSIONS.items()}}


class StaffUpdateIn(BaseModel):
    role: str | None = None
    property_scope: list[str] | None = None
    status: str | None = Field(default=None, pattern="^(active|suspended)$")
    mfa_enabled: bool | None = None


@router.put("/staff/{staff_id}")
def update_staff(staff_id: str, body: StaffUpdateIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("admin.manage", "admin.staff_updated", "admin", Resource(type="staff", ids=[staff_id]))
    staff = ctx.db.get(Staff, staff_id)
    if staff is None:
        raise HTTPException(status_code=404, detail={"error": "staff_not_found"})
    if body.role is not None and body.role not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=422, detail={"error": "unknown_role"})
    changes = {}
    for field in ("role", "property_scope", "status", "mfa_enabled"):
        value = getattr(body, field)
        if value is not None and value != getattr(staff, field):
            changes[field] = {"before": getattr(staff, field), "after": value}
            setattr(staff, field, value)
    ctx.emit("admin.staff_updated", "admin", resource=Resource(type="staff", ids=[staff_id]),
             details={"changes": changes})
    ctx.db.commit()
    return {"id": staff.id, "changes": changes}


@router.get("/partners")
def list_partners(ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("admin.manage", "admin.partners_view", "admin")
    return {"items": [{
        "id": p.id, "name": p.name, "key_prefix": p.key_prefix, "key_status": p.key_status,
        "allowed_fields": list(p.allowed_fields or []),
        "key_rotated_at": p.key_rotated_at.isoformat() if p.key_rotated_at else None,
    } for p in ctx.db.query(Partner).order_by(Partner.id).all()], "available_fields": PARTNER_FIELDS}


class PartnerUpdateIn(BaseModel):
    allowed_fields: list[str]


@router.put("/partners/{partner_id}")
def update_partner(partner_id: str, body: PartnerUpdateIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("admin.manage", "admin.partner_updated", "admin", Resource(type="partner", ids=[partner_id]))
    partner = ctx.db.get(Partner, partner_id)
    if partner is None:
        raise HTTPException(status_code=404, detail={"error": "partner_not_found"})
    unknown = set(body.allowed_fields) - set(PARTNER_FIELDS)
    if unknown:
        raise HTTPException(status_code=422, detail={"error": "unknown_fields", "fields": sorted(unknown)})
    before = list(partner.allowed_fields or [])
    partner.allowed_fields = body.allowed_fields
    ctx.emit("admin.partner_updated", "admin", resource=Resource(type="partner", ids=[partner_id]),
             details={"allowed_fields": {"before": before, "after": body.allowed_fields},
                      "fields_added": sorted(set(body.allowed_fields) - set(before))})
    ctx.db.commit()
    return {"id": partner.id, "allowed_fields": partner.allowed_fields}


@router.get("/properties")
def list_properties(ctx: Ctx = Depends(get_staff_ctx)):
    return {"items": [{"id": p.id, "name": p.name, "city": p.city, "rooms": p.rooms}
                      for p in ctx.db.query(Property).order_by(Property.id).all()]}
