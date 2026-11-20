"""Request context: who is acting, from where, and helpers to emit events / deny with an audit trail."""

import time
import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import audit, security
from .config import get_settings
from .db import get_db
from .models import LoyaltyAccount, Partner, Staff, StaffDevice, StaffSession
from .policy import is_enabled
from .rbac import has_perm

IST = timezone(timedelta(hours=5, minutes=30))

# Messages the STAYSEC contract (v1.0, section 6.5) expects attackers to see.
CONTRACT_MESSAGES = {
    "SESSION_REVOKED": "Your session was ended by hotel security.",
    "SESSION_EXPIRED": "Your session has expired. Please sign in again.",
    "ACCOUNT_LOCKED": "This account is locked. Contact your administrator.",
    "IP_BLOCKED": "Access from this network has been blocked by hotel security.",
    "UNAUTHENTICATED": "Authentication required.",
    "PASSWORD_RESET_REQUIRED": "A password reset is required before you can sign in.",
}


class ApiError(Exception):
    """Error with a contract-shaped JSON body: {"error": CODE, "message": ..., "detail": {...}}.
    `detail` keeps the shape the StayDesk frontend already understands."""

    def __init__(self, status_code: int, error: str, message: str | None = None, detail: dict | None = None):
        self.status_code = status_code
        self.body = {"error": error, "message": message or CONTRACT_MESSAGES.get(error, error), "detail": detail or {}}


def client_ip(request: Request) -> str | None:
    if get_settings().trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def device_id(request: Request) -> str:
    return (request.headers.get("x-device-id") or "unknown")[:80]


def local_now(request: Request) -> datetime:
    """Current time at the hotel (IST). In demo mode, X-Demo-Clock: HH:MM simulates the staff member's local time
    so off-shift scenarios can be demonstrated during the day. Event timestamps always use the real clock."""
    now = datetime.now(IST)
    clock = request.headers.get("x-demo-clock")
    if get_settings().demo_mode and clock:
        try:
            hh, mm = clock.split(":")
            return now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        except ValueError:
            pass
    return now


def is_on_shift(staff: Staff, at: datetime) -> bool:
    start, end, t = staff.shift_start, staff.shift_end, at.time()
    if start <= end:
        return start <= t < end
    return t >= start or t < end  # overnight shift


def request_meta(request: Request) -> audit.RequestMeta:
    rid = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    route = request.scope.get("route")
    return audit.RequestMeta(request_id=rid, method=request.method, path=request.url.path,
                             route=getattr(route, "path", None) or request.url.path)


def staff_actor(request: Request, staff: Staff, session: StaffSession | None = None,
                device_known: bool | None = None) -> audit.Actor:
    at = local_now(request)
    return audit.Actor(
        type="staff",
        id=staff.id,
        role=staff.role,
        home_property=staff.home_property_id,
        property_scope=list(staff.property_scope or []),
        on_shift=is_on_shift(staff, at),
        local_time=at.strftime("%H:%M"),
        ip=client_ip(request),
        device_id=device_id(request),
        device_known=device_known,
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
        session_id=session.id if session else None,
        session_issued_at=session.created_at.isoformat() if session and session.created_at else None,
        mfa_verified=session.mfa_verified if session else None,
    )


def basic_actor(request: Request, actor_type: str, actor_id: str | None) -> audit.Actor:
    return audit.Actor(
        type=actor_type,
        id=actor_id,
        ip=client_ip(request),
        device_id=device_id(request),
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
    )


class Ctx:
    def __init__(self, db: Session, request: Request, actor: audit.Actor, *, staff: Staff | None = None,
                 session: StaffSession | None = None, account: LoyaltyAccount | None = None,
                 partner: Partner | None = None):
        self.db = db
        self.request = request
        self.actor = actor
        self.req = request_meta(request)
        self.staff = staff
        self.session = session
        self.account = account
        self.partner = partner

    def _meta(self, status_code: int) -> audit.RequestMeta:
        started = getattr(self.request.state, "started", None)
        latency = int((time.perf_counter() - started) * 1000) if started else None
        return replace(self.req, status_code=status_code, latency_ms=latency)

    def emit(self, action: str, category: str, *, status_code: int = 200, **kwargs) -> dict:
        return audit.emit(self.db, action=action, category=category, actor=self.actor,
                          request=self._meta(status_code), **kwargs)

    def deny(self, action: str, category: str, status_code: int, reason: str, *, policy: str | None = None,
             resource: audit.Resource | dict | None = None, extra: dict | None = None, error_code: str | None = None,
             event_code: str | None = None):
        """Record a denied action and abort the request.
        error_code (e.g. SESSION_REVOKED) produces the STAYSEC-contract body; otherwise FastAPI's {"detail": ...}.
        event_code overrides the machine-readable code stored on the event (e.g. BAD_PASSWORD)."""
        code = event_code or error_code or ("FORBIDDEN" if status_code == 403 else None)
        self.emit(action, category, status_code=status_code, outcome="denied", reason=reason, policy=policy,
                  resource=resource, code=code, details=extra)
        self.db.commit()
        detail = {"error": "denied", "reason": reason}
        if policy:
            detail["policy"] = policy
        if extra:
            detail.update(extra)
        if error_code:
            raise ApiError(status_code, error_code, detail=detail)
        raise HTTPException(status_code=status_code, detail=detail)

    def require(self, perm: str, action: str, category: str, resource: audit.Resource | None = None) -> None:
        if not self.staff or not has_perm(self.staff.role, perm):
            role = self.staff.role if self.staff else self.actor.type
            self.deny(action, category, 403, f"Role '{role}' lacks permission '{perm}'", resource=resource)

    # ---- property scope ----

    def scope(self) -> list[str] | None:
        """Properties this staff member may access, or None when the property_scope control is OFF."""
        if self.staff is None:
            return None
        if not is_enabled(self.db, "property_scope"):
            return None
        return list(self.staff.property_scope or [])

    def check_property(self, property_id: str, action: str, category: str,
                       resource: audit.Resource | None = None) -> None:
        allowed = self.scope()
        if allowed is not None and property_id not in allowed:
            self.deny(action, category, 403, f"Property {property_id} is outside this account's scope",
                      policy="property_scope", resource=resource)

    # ---- data masking ----

    def masking(self) -> bool:
        """Whether sensitive guest fields are masked for this request.
        Precedence: session override > user override (STAYSEC SET_DATA_MASKING) > global pii_masking control."""
        for override in (self.session.masking_override if self.session else None,
                         self.staff.masking_override if self.staff else None):
            if override == "MASKED":
                return True
            if override == "FULL":
                return False
        return is_enabled(self.db, "pii_masking")


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    return auth[7:].strip()


def _unauthenticated(db: Session, request: Request, reason: str):
    Ctx(db, request, basic_actor(request, "anonymous", None)).deny(
        "auth.unauthenticated", "auth", 401, reason, error_code="UNAUTHENTICATED", extra={"code": "unauthenticated"})


def get_staff_ctx(request: Request, db: Session = Depends(get_db)) -> Ctx:
    token = _bearer(request)
    if not token:
        _unauthenticated(db, request, "Missing bearer token")
    try:
        claims = security.decode_token(token, expected_type="staff")
    except security.TokenError:
        _unauthenticated(db, request, "Invalid or expired token")
    session = db.get(StaffSession, claims.get("sid"))
    staff = db.get(Staff, claims.get("sub"))
    if session is None or staff is None:
        _unauthenticated(db, request, "Unknown session")
    known = db.get(StaffDevice, (staff.id, device_id(request))) is not None
    ctx = Ctx(db, request, staff_actor(request, staff, session, known), staff=staff, session=session)
    now = security.utcnow()
    if session.revoked_at is not None:
        ctx.deny("auth.session_rejected", "auth", 401, "Session was revoked", error_code="SESSION_REVOKED",
                 extra={"code": "session_revoked", "revoked_by": session.revoked_by,
                        "revoked_reason": session.revoked_reason,
                        "revoked_at": session.revoked_at.isoformat()})
    if session.expires_at < now:
        ctx.deny("auth.session_rejected", "auth", 401, "Session expired", error_code="SESSION_EXPIRED",
                 extra={"code": "session_expired"})
    if staff.status != "active" or (staff.locked_until and staff.locked_until > now):
        ctx.deny("auth.session_rejected", "auth", 401, "Account locked", error_code="ACCOUNT_LOCKED",
                 extra={"code": "account_suspended"})
    return ctx


def get_guest_ctx(request: Request, db: Session = Depends(get_db)) -> Ctx:
    try:
        claims = security.decode_token(_bearer(request) or "", expected_type="guest")
    except security.TokenError:
        raise HTTPException(status_code=401, detail={"error": "invalid_token"})
    account = db.get(LoyaltyAccount, claims.get("sub"))
    if account is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_account"})
    return Ctx(db, request, basic_actor(request, "guest", account.id), account=account)


def get_partner_ctx(request: Request, db: Session = Depends(get_db)) -> Ctx:
    key = request.headers.get("x-partner-key", "")
    partner = db.query(Partner).filter(Partner.api_key_hash == security.hash_api_key(key)).first() if key else None
    if partner is None:
        ctx = Ctx(db, request, basic_actor(request, "partner", None))
        ctx.deny("partner.auth_failed", "partner", 401, "Invalid partner API key", error_code="UNAUTHENTICATED",
                 resource={"type": "partner_key", "key_prefix": key[:12] if key else None})
    ctx = Ctx(db, request, basic_actor(request, "partner", partner.id), partner=partner)
    if partner.key_status != "active":
        ctx.deny("partner.auth_failed", "partner", 401, "Partner API key is revoked", error_code="UNAUTHENTICATED")
    return ctx


def get_service_ctx(request: Request, db: Session = Depends(get_db)) -> Ctx:
    key = request.headers.get("x-service-key", "")
    if not key or not security.const_eq(key, get_settings().service_api_key):
        raise HTTPException(status_code=401, detail={"error": "invalid_service_key"})
    return Ctx(db, request, basic_actor(request, "service", request.headers.get("x-service-name", "staysec")))
