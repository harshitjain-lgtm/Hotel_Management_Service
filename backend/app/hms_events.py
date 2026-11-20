"""Helpers that emit contract-native events (reference data, session termination, action audit).

They go through the same transactional outbox as every other event. The v1 adapter passes
details["v1"] through unchanged as the contract `data` block.
"""

from sqlalchemy.orm import Session

from . import audit, contract_v1, security
from .models import Partner, Property, Staff, StaffSession

SYSTEM = audit.Actor(type="system", id="staydesk")


def emit_v1(db: Session, event_type: str, data: dict, *, actor: audit.Actor | None = None,
            with_context: bool = False) -> dict:
    payload = dict(data)
    if with_context:
        payload["_with_context"] = True
    return audit.emit(db, action=event_type, category="contract", actor=actor or SYSTEM, details={"v1": payload})


def emit_staff_reference(db: Session, staff: Staff) -> None:
    emit_v1(db, "reference.staff", contract_v1.staff_reference(staff))


def emit_all_reference(db: Session) -> int:
    """reference.property, reference.staff (incl. OTA integrations as service accounts) and reference.field_catalog."""
    count = 0
    properties = db.query(Property).order_by(Property.id).all()
    for prop in properties:
        emit_v1(db, "reference.property", contract_v1.property_reference(prop))
        count += 1
    for staff in db.query(Staff).order_by(Staff.id).all():
        emit_staff_reference(db, staff)
        count += 1
    prop_ids = [p.id for p in properties]
    for partner in db.query(Partner).order_by(Partner.id).all():
        emit_v1(db, "reference.staff", contract_v1.partner_reference(partner, prop_ids))
        count += 1
    emit_v1(db, "reference.field_catalog", contract_v1.field_catalog())
    return count + 1


def session_actor(staff: Staff, session: StaffSession) -> audit.Actor:
    return audit.Actor(
        type="staff", id=staff.id, role=staff.role, home_property=staff.home_property_id,
        property_scope=list(staff.property_scope or []), ip=session.ip, device_id=session.device_id,
        user_agent=session.user_agent, session_id=session.id,
        session_issued_at=session.created_at.isoformat() if session.created_at else None,
        mfa_verified=session.mfa_verified,
    )


def terminate_sessions(db: Session, staff: Staff, sessions: list[StaffSession], *, reason_code: str,
                       action_id: str | None = None, revoked_by: str | None = None, message: str | None = None) -> int:
    """Revoke sessions and publish session.terminated for each (contract section 6.5).
    reason_code: STAYSEC_ACTION | EXPIRED | ADMIN | PASSWORD_CHANGED | OTHER"""
    now = security.utcnow()
    terminated = 0
    for s in sessions:
        if s.revoked_at is not None:
            continue
        s.revoked_at = now
        s.revoked_reason = (message or reason_code)[:300]
        s.revoked_by = f"staysec:{action_id}" if action_id else (revoked_by or "admin")
        data = {"reason": reason_code}
        if action_id:
            data["staysec_action_id"] = action_id
        emit_v1(db, "session.terminated", data, actor=session_actor(staff, s), with_context=True)
        terminated += 1
    return terminated


def active_sessions(db: Session, staff_id: str) -> list[StaffSession]:
    now = security.utcnow()
    return db.query(StaffSession).filter(StaffSession.staff_id == staff_id, StaffSession.revoked_at.is_(None),
                                         StaffSession.expires_at > now).all()
