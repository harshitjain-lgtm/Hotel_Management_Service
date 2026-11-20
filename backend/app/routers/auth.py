import uuid
from dataclasses import replace
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import audit, security
from ..config import get_settings
from ..db import get_db
from ..deps import (Ctx, basic_actor, client_ip, device_id, get_staff_ctx, is_on_shift, local_now,
                    request_meta, staff_actor)
from ..models import PolicySetting, Staff, StaffDevice, StaffSession
from ..policy import get_policy
from ..rbac import ROLE_LABELS, permissions_for

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str  # staff id or email
    password: str


class MfaIn(BaseModel):
    challenge_token: str
    code: str


class StepUpIn(BaseModel):
    code: str


def _staff_profile(staff: Staff, request: Request) -> dict:
    return {
        "id": staff.id,
        "name": staff.name,
        "email": staff.email,
        "role": staff.role,
        "role_label": ROLE_LABELS.get(staff.role, staff.role),
        "home_property": staff.home_property_id,
        "property_scope": list(staff.property_scope or []),
        "mfa_enabled": staff.mfa_enabled,
        "shift": f"{staff.shift_start.strftime('%H:%M')}-{staff.shift_end.strftime('%H:%M')}",
        "on_shift": is_on_shift(staff, local_now(request)),
        "permissions": permissions_for(staff.role),
    }


def _open_session(db: Session, request: Request, staff: Staff, mfa_verified: bool) -> tuple[StaffSession, bool]:
    """Create a session. A new device only becomes trusted ("known") after a successful MFA,
    so password-only logins from new devices stay flagged as unknown on every event.
    Returns (session, device_was_known)."""
    dev = device_id(request)
    known_device = db.get(StaffDevice, (staff.id, dev))
    now = security.utcnow()
    if known_device is None:
        if mfa_verified:
            db.add(StaffDevice(staff_id=staff.id, device_id=dev, first_seen=now, last_seen=now))
    else:
        known_device.last_seen = now
    session = StaffSession(
        id=str(uuid.uuid4()),
        staff_id=staff.id,
        device_id=dev,
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
        mfa_verified=mfa_verified,
        step_up_at=now if mfa_verified else None,
        created_at=now,
        expires_at=now + timedelta(minutes=get_settings().jwt_ttl_minutes),
    )
    db.add(session)
    return session, known_device is not None


def _issue(db: Session, request: Request, staff: Staff, mfa_verified: bool) -> dict:
    session, was_known = _open_session(db, request, staff, mfa_verified)
    actor = staff_actor(request, staff, session, device_known=was_known)
    meta = replace(request_meta(request), status_code=200)
    if not was_known:
        audit.emit(db, action="auth.new_device", category="auth", actor=actor, request=meta,
                   details={"device_id": session.device_id})
    audit.emit(db, action="auth.login_success", category="auth", actor=actor, request=meta,
               details={"mfa_verified": mfa_verified, "new_device": not was_known})
    db.commit()
    token = security.create_token(staff.id, "staff", get_settings().jwt_ttl_minutes, sid=session.id)
    return {"access_token": token, "token_type": "bearer", "staff": _staff_profile(staff, request)}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    username = body.username.strip()
    staff = db.query(Staff).filter(or_(Staff.id == username, Staff.email == username.lower())).first()
    if staff is None:
        # Never record the attempted username for unknown users (it is often a mistyped password).
        Ctx(db, request, basic_actor(request, "staff", None)).deny(
            "auth.login_failed", "auth", 401, "Invalid credentials", event_code="UNKNOWN_USER",
            extra={"code": "invalid_credentials"})
    known = db.get(StaffDevice, (staff.id, device_id(request))) is not None
    ctx = Ctx(db, request, staff_actor(request, staff, device_known=known), staff=staff)
    if not security.verify_password(body.password, staff.password_hash):
        ctx.deny("auth.login_failed", "auth", 401, "Invalid credentials", event_code="BAD_PASSWORD",
                 extra={"code": "invalid_credentials"})
    now = security.utcnow()
    if staff.status != "active" or (staff.locked_until and staff.locked_until > now):
        ctx.deny("auth.login_blocked", "auth", 403, "Account locked", error_code="ACCOUNT_LOCKED",
                 extra={"code": "account_suspended",
                        "locked_until": staff.locked_until.isoformat() if staff.locked_until else None})
    if staff.must_reset_password:
        ctx.deny("auth.login_blocked", "auth", 403, "Password reset required", error_code="PASSWORD_RESET_REQUIRED",
                 event_code="OTHER", extra={"code": "password_reset_required"})

    mfa_on_new_device, _ = get_policy(db, "new_device_mfa")
    if staff.mfa_enabled and mfa_on_new_device and not known:
        ctx.emit("auth.mfa_challenge", "auth", details={"reason": "new_device"})
        db.commit()
        challenge = security.create_token(staff.id, "mfa_challenge", 5, dev=device_id(request))
        return {"mfa_required": True, "challenge_token": challenge, "reason": "new_device"}

    return _issue(db, request, staff, mfa_verified=False)


@router.post("/mfa")
def verify_mfa(body: MfaIn, request: Request, db: Session = Depends(get_db)):
    try:
        claims = security.decode_token(body.challenge_token, expected_type="mfa_challenge")
    except security.TokenError:
        raise HTTPException(status_code=401, detail={"error": "invalid_challenge"})
    staff = db.get(Staff, claims["sub"])
    if staff is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_challenge"})
    ctx = Ctx(db, request, staff_actor(request, staff, device_known=False), staff=staff)
    if claims.get("dev") != device_id(request):
        ctx.deny("auth.mfa_failed", "auth", 401, "MFA challenge was issued to a different device", event_code="MFA_FAILED")
    if not security.verify_totp(staff.mfa_secret, body.code):
        ctx.deny("auth.mfa_failed", "auth", 401, "Invalid MFA code", event_code="MFA_FAILED", extra={"code": "invalid_mfa"})
    ctx.emit("auth.mfa_success", "auth")
    return _issue(db, request, staff, mfa_verified=True)


@router.post("/step-up")
def step_up(body: StepUpIn, ctx: Ctx = Depends(get_staff_ctx)):
    if not security.verify_totp(ctx.staff.mfa_secret, body.code):
        ctx.deny("auth.step_up_failed", "auth", 401, "Invalid MFA code", event_code="MFA_FAILED", extra={"code": "invalid_mfa"})
    ctx.session.step_up_at = security.utcnow()
    ctx.session.mfa_verified = True
    ctx.emit("auth.step_up_success", "auth")
    ctx.db.commit()
    _, params = get_policy(ctx.db, "export_step_up")
    valid_until = ctx.session.step_up_at + timedelta(minutes=params.get("window_minutes", 5))
    return {"ok": True, "step_up_valid_until": valid_until.isoformat()}


@router.post("/logout")
def logout(ctx: Ctx = Depends(get_staff_ctx)):
    ctx.session.revoked_at = security.utcnow()
    ctx.session.revoked_reason = "logout"
    ctx.session.revoked_by = ctx.staff.id
    ctx.emit("auth.logout", "auth")
    ctx.db.commit()
    return {"ok": True}


@router.get("/me")
def me(ctx: Ctx = Depends(get_staff_ctx)):
    _, params = get_policy(ctx.db, "export_step_up")
    step_up_until = None
    if ctx.session.step_up_at:
        step_up_until = (ctx.session.step_up_at + timedelta(minutes=params.get("window_minutes", 5))).isoformat()
    policies = {p.key: p.enabled for p in ctx.db.query(PolicySetting).all()}
    return {
        "staff": _staff_profile(ctx.staff, ctx.request),
        "session": {
            "id": ctx.session.id,
            "device_id": ctx.session.device_id,
            "mfa_verified": ctx.session.mfa_verified,
            "step_up_valid_until": step_up_until,
            "expires_at": ctx.session.expires_at.isoformat(),
        },
        "policies": policies,
    }
