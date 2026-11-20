"""STAYSEC action endpoint (contract v1.0, section 6): POST /internal/security/actions

* HMAC-SHA256 signature over "<timestamp>.<raw body>" (X-Staysec-Timestamp / X-Staysec-Signature), 300 s window
* idempotent on action_id (stored in security_actions)
* always HTTP 200 once processed; status = APPLIED | ALREADY_APPLIED | NOT_FOUND | UNSUPPORTED | REJECTED | FAILED
* 400 malformed body, 401 bad/stale signature

Contract actions: PING, REVOKE_SESSION, LOCK_USER, UNLOCK_USER, REVOKE_USER_SESSIONS, BLOCK_IP, UNBLOCK_IP,
SET_DATA_MASKING, FORCE_PASSWORD_RESET.
StayDesk extensions: SET_SECURITY_CONTROL, FREEZE_LOYALTY, UNFREEZE_LOYALTY, ROTATE_PARTNER_KEY.
"""

import hashlib
import hmac
import json
import logging
import time
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import contract_v1, security
from ..config import get_settings
from ..db import get_db
from ..deps import Ctx, basic_actor
from ..hms_events import active_sessions, emit_staff_reference, emit_v1, terminate_sessions
from ..models import BlockedIp, LoyaltyAccount, Partner, PolicySetting, SecurityAction, Staff, StaffSession
from ..policy import POLICY_DEFS

router = APIRouter(tags=["staysec-actions"])
log = logging.getLogger("staydesk.actions")


class Outcome(Exception):
    def __init__(self, status: str, message: str = "", details: dict | None = None):
        self.status, self.message, self.details = status, message, details or {}


def verify_signature(request: Request, raw: bytes) -> str | None:
    """Returns None when valid, otherwise the rejection reason."""
    settings = get_settings()
    ts = request.headers.get("x-staysec-timestamp")
    sig = request.headers.get("x-staysec-signature", "")
    key_id = request.headers.get("x-staysec-key-id")
    if not ts or not sig:
        return "missing signature headers"
    if key_id and key_id != settings.staysec_key_id:
        return "unknown key id"
    try:
        if abs(time.time() - int(ts)) > 300:
            return "stale timestamp"
    except ValueError:
        return "invalid timestamp"
    expected = "v1=" + hmac.new(settings.staysec_signing_secret.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return None if hmac.compare_digest(expected, sig) else "signature mismatch"


def _staff(db: Session, target: dict) -> Staff:
    staff = db.get(Staff, target.get("user_id") or "")
    if staff is None:
        raise Outcome("NOT_FOUND", f"user {target.get('user_id')!r} not found")
    return staff


def _message(reason: dict) -> str:
    return (reason.get("message") or reason.get("code") or "Ended by hotel security")[:300]


# ---------------------------------------------------------------- handlers
# Each handler: (db, action_id, target, params, reason, dry_run) -> details dict, or raise Outcome

def ping(db, action_id, target, params, reason, dry_run):
    return {}


def revoke_session(db, action_id, target, params, reason, dry_run):
    session = db.get(StaffSession, target.get("session_id") or "")
    if session is None:
        raise Outcome("NOT_FOUND", "session not found")
    if session.revoked_at is not None:
        raise Outcome("ALREADY_APPLIED", "session already terminated", {"sessions_terminated": 0})
    if session.expires_at < security.utcnow():
        raise Outcome("NOT_FOUND", "session already expired")
    if dry_run:
        return {"sessions_terminated": 1}
    staff = db.get(Staff, session.staff_id)
    n = terminate_sessions(db, staff, [session], reason_code="STAYSEC_ACTION", action_id=action_id, message=_message(reason))
    return {"sessions_terminated": n, "user_id": staff.id}


def revoke_user_sessions(db, action_id, target, params, reason, dry_run):
    staff = _staff(db, target)
    sessions = active_sessions(db, staff.id)
    if not sessions:
        raise Outcome("ALREADY_APPLIED", "no active sessions", {"sessions_terminated": 0})
    if dry_run:
        return {"sessions_terminated": len(sessions)}
    return {"sessions_terminated": terminate_sessions(db, staff, sessions, reason_code="STAYSEC_ACTION",
                                                      action_id=action_id, message=_message(reason))}


def lock_user(db, action_id, target, params, reason, dry_run):
    staff = _staff(db, target)
    minutes = params.get("duration_minutes")
    until = security.utcnow() + timedelta(minutes=int(minutes)) if minutes else contract_v1.FAR_FUTURE
    if staff.locked_until and staff.locked_until >= until:
        raise Outcome("ALREADY_APPLIED", "user already locked", {"locked_until": contract_v1.iso_z(staff.locked_until)})
    sessions = active_sessions(db, staff.id)
    if dry_run:
        return {"locked_until": contract_v1.iso_z(until), "sessions_terminated": len(sessions)}
    staff.locked_until = until
    n = terminate_sessions(db, staff, sessions, reason_code="STAYSEC_ACTION", action_id=action_id, message=_message(reason))
    emit_staff_reference(db, staff)
    return {"locked_until": contract_v1.iso_z(until), "sessions_terminated": n}


def unlock_user(db, action_id, target, params, reason, dry_run):
    staff = _staff(db, target)
    if not staff.locked_until or staff.locked_until <= security.utcnow():
        raise Outcome("ALREADY_APPLIED", "user is not locked")
    if not dry_run:
        staff.locked_until = None
        emit_staff_reference(db, staff)
    return {}


def block_ip(db, action_id, target, params, reason, dry_run):
    ip = (target.get("ip") or "").strip()
    if not ip:
        raise Outcome("REJECTED", "target.ip is required")
    minutes = params.get("duration_minutes")
    until = security.utcnow() + timedelta(minutes=int(minutes)) if minutes else None
    if not dry_run:
        existing = db.get(BlockedIp, ip)
        if existing:
            existing.until, existing.action_id = until, action_id
        else:
            db.add(BlockedIp(ip=ip, until=until, action_id=action_id))
    return {"ip": ip, "blocked_until": contract_v1.iso_z(until) if until else None}


def unblock_ip(db, action_id, target, params, reason, dry_run):
    existing = db.get(BlockedIp, (target.get("ip") or "").strip())
    if existing is None:
        raise Outcome("ALREADY_APPLIED", "ip is not blocked")
    if not dry_run:
        db.delete(existing)
    return {}


def set_data_masking(db, action_id, target, params, reason, dry_run):
    mode = (params.get("mode") or "").upper()
    if mode not in ("MASKED", "FULL"):
        raise Outcome("REJECTED", "params.mode must be MASKED or FULL")
    if target.get("session_id"):
        obj = db.get(StaffSession, target["session_id"])
        if obj is None:
            raise Outcome("NOT_FOUND", "session not found")
        scope = "session"
    else:
        obj, scope = _staff(db, target), "user"
    if obj.masking_override == mode:
        raise Outcome("ALREADY_APPLIED", f"{scope} already {mode}")
    if not dry_run:
        obj.masking_override = mode
    return {"scope": scope, "mode": mode}


def force_password_reset(db, action_id, target, params, reason, dry_run):
    staff = _staff(db, target)
    if staff.must_reset_password:
        raise Outcome("ALREADY_APPLIED", "password reset already required")
    sessions = active_sessions(db, staff.id)
    if dry_run:
        return {"sessions_terminated": len(sessions)}
    staff.must_reset_password = True
    n = terminate_sessions(db, staff, sessions, reason_code="PASSWORD_CHANGED", action_id=action_id, message=_message(reason))
    return {"sessions_terminated": n}


# ---- StayDesk extensions ----

def set_security_control(db, action_id, target, params, reason, dry_run):
    key = params.get("control")
    if key not in POLICY_DEFS:
        raise Outcome("REJECTED", f"unknown control {key!r}; known: {sorted(POLICY_DEFS)}")
    if not isinstance(params.get("enabled"), bool):
        raise Outcome("REJECTED", "params.enabled (bool) is required")
    setting = db.get(PolicySetting, key)
    if setting.enabled == params["enabled"]:
        raise Outcome("ALREADY_APPLIED", f"{key} already {'ON' if setting.enabled else 'OFF'}")
    if not dry_run:
        before = setting.enabled
        setting.enabled = params["enabled"]
        setting.updated_by = f"staysec:{action_id}"
        setting.updated_at = security.utcnow()
        emit_v1(db, "security.control.changed", {
            "control": key, "enabled_before": before, "enabled_after": setting.enabled,
            "control_disabled": before and not setting.enabled, "changed_via": "staysec_action",
            "staysec_action_id": action_id})
    return {"control": key, "enabled": params["enabled"]}


def _loyalty_targets(db, target) -> list[LoyaltyAccount]:
    accounts = []
    if target.get("account_ids"):
        accounts = db.query(LoyaltyAccount).filter(LoyaltyAccount.id.in_(target["account_ids"])).all()
    if target.get("guest_refs"):
        wanted = set(target["guest_refs"])
        key = get_settings().guest_ref_key
        for account in db.query(LoyaltyAccount).all():
            if contract_v1.guest_ref(account.guest_id, key) in wanted:
                accounts.append(account)
    return list({a.id: a for a in accounts}.values())


def freeze_loyalty(db, action_id, target, params, reason, dry_run, freeze=True):
    accounts = _loyalty_targets(db, target)
    if not accounts:
        raise Outcome("NOT_FOUND", "no matching loyalty accounts (use target.account_ids or target.guest_refs)")
    changed = [a for a in accounts if a.frozen != freeze]
    if not changed:
        raise Outcome("ALREADY_APPLIED", "accounts already in requested state", {"accounts": len(accounts)})
    if not dry_run:
        for a in changed:
            a.frozen, a.frozen_reason = freeze, (_message(reason) if freeze else None)
    return {"accounts_changed": len(changed), "points_protected": sum(a.points_balance for a in changed) if freeze else None}


def unfreeze_loyalty(db, action_id, target, params, reason, dry_run):
    return freeze_loyalty(db, action_id, target, params, reason, dry_run, freeze=False)


def rotate_partner_key(db, action_id, target, params, reason, dry_run):
    partner = db.get(Partner, target.get("partner_id") or "")
    if partner is None:
        raise Outcome("NOT_FOUND", "partner not found")
    if dry_run:
        return {}
    new_key = security.new_api_key(partner.id.lower()[:8])
    partner.api_key_hash, partner.key_prefix = security.hash_api_key(new_key), new_key[:12]
    partner.key_status, partner.key_rotated_at = "active", security.utcnow()
    # The new key is delivered to the partner out-of-band by hotel IT, never returned to STAYSEC.
    return {"partner_id": partner.id, "key_prefix": partner.key_prefix}


HANDLERS = {
    "PING": ping, "REVOKE_SESSION": revoke_session, "REVOKE_USER_SESSIONS": revoke_user_sessions,
    "LOCK_USER": lock_user, "UNLOCK_USER": unlock_user, "BLOCK_IP": block_ip, "UNBLOCK_IP": unblock_ip,
    "SET_DATA_MASKING": set_data_masking, "FORCE_PASSWORD_RESET": force_password_reset,
    "SET_SECURITY_CONTROL": set_security_control, "FREEZE_LOYALTY": freeze_loyalty,
    "UNFREEZE_LOYALTY": unfreeze_loyalty, "ROTATE_PARTNER_KEY": rotate_partner_key,
}


@router.post("/internal/security/actions")
async def security_action(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    rejection = verify_signature(request, raw)
    if rejection:
        Ctx(db, request, basic_actor(request, "service", "staysec?")).emit(
            "security.action_rejected", "control", status_code=401, outcome="denied", reason=rejection,
            code="UNAUTHENTICATED")
        db.commit()
        return JSONResponse(status_code=401, content={"error": "INVALID_SIGNATURE", "message": rejection})
    try:
        body = json.loads(raw)
        action_id, action = str(body["action_id"]), str(body["action"]).upper()
        target, params, reason = body.get("target") or {}, body.get("params") or {}, body.get("reason") or {}
        dry_run = bool(body.get("dry_run", False))
        if not isinstance(target, dict) or not isinstance(params, dict) or not isinstance(reason, dict):
            raise ValueError("target, params and reason must be objects")
    except (ValueError, KeyError, TypeError) as exc:
        return JSONResponse(status_code=400, content={"error": "MALFORMED", "message": str(exc)})

    previous = db.get(SecurityAction, action_id)
    if previous is not None and not dry_run:
        return {**previous.response, "status": "ALREADY_APPLIED",
                "message": f"action_id already processed (original status {previous.status})"}

    applied_at = contract_v1.iso_z(security.utcnow())
    handler = HANDLERS.get(action)
    try:
        if handler is None:
            raise Outcome("UNSUPPORTED", f"action {action} is not implemented by this HMS")
        details, status, message = handler(db, action_id, target, params, reason, dry_run) or {}, "APPLIED", ""
    except Outcome as outcome:
        details, status, message = outcome.details, outcome.status, outcome.message
    except Exception as exc:  # never 500 for a processed action
        db.rollback()
        log.exception("security action %s failed", action_id)
        details, status, message = {}, "FAILED", str(exc)[:300]
    if dry_run:
        db.rollback()
        return {"action_id": action_id, "status": status, "applied_at": None, "details": details,
                "message": ("dry_run: no changes made. " + message).strip()}

    response = {"action_id": action_id, "status": status, "applied_at": applied_at if status == "APPLIED" else None,
                "details": details, "message": message}
    db.add(SecurityAction(action_id=action_id, action=action, target=target, params=params, reason=reason,
                          requested_by=body.get("requested_by"), status=status, response=response))
    if action != "PING":
        emit_v1(db, "security.action.applied", {"action_id": action_id, "action": action, "status": status,
                                                "applied_at": applied_at, "requested_by": body.get("requested_by"),
                                                "incident_id": reason.get("incident_id"), **details})
    db.commit()
    return response
