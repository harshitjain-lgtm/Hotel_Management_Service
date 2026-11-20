"""STAYSEC x HMS integration contract v1.0: event adapter.

StayDesk records rich internal audit events (app.audit). This module converts them into the STAYSEC
v1.0 envelope (HMS_INTEGRATION_HANDOFF.md, sections 3-5):

  * guest IDs  -> guest_refs = "h_" + HMAC_SHA256(GUEST_REF_KEY, guest_id)[:32]
  * PII        -> field *names* only (fields_returned / fields_changed), never values
  * internal actions -> contract event types (data.access, auth.login.failed, access.denied, ...)

Contract changes are additive within 1.x. StayDesk adds a few optional fields (marked "ext") and two
extension event types for capabilities beyond the contract: security.control.changed and
security.control.triggered.
"""

import hashlib
import hmac
import socket
from datetime import datetime, timezone

from .config import get_settings

SCHEMA_VERSION = "1.0"
MAX_GUEST_REFS = 2000
FAR_FUTURE = datetime(2100, 1, 1, tzinfo=timezone.utc)

ROLE_MAP = {
    "front_desk": "FRONT_DESK",
    "property_manager": "MANAGER",
    "finance": "FINANCE",
    "regional_manager": "REVENUE_MANAGER",
    "loyalty_desk": "LOYALTY",
    "corporate_admin": "ADMIN",
}

# ---------------------------------------------------------------- field catalog

FIELD_CATEGORIES = {
    "IDENTITY_DOC": ["passport_no", "aadhaar", "id_type", "dob", "nationality", "id_document_image", "id_documents"],
    "PAYMENT": ["card_token", "card_brand", "card_last4", "total_amount", "folio_items", "folio_summary",
                "folio_amount", "refund_amount", "refund_status"],
    "CONTACT": ["phone", "email", "address_city", "guest_email", "guest_phone", "portal_email"],
    "STAY": ["reservation_id", "property_id", "status", "channel", "arrival", "departure", "nights", "room_type",
             "room_no", "adults", "children", "special_requests", "stays"],
    "LOYALTY": ["loyalty_id", "loyalty_tier", "loyalty_points", "loyalty_frozen", "loyalty_transactions"],
    "IDENTITY": ["guest_id", "guest_name", "first_name", "last_name"],
}

_RES_ROW = ["reservation_id", "property_id", "status", "channel", "arrival", "departure", "nights", "room_type",
            "room_no", "adults", "children", "total_amount"]
_GUEST_BRIEF = ["guest_id", "guest_name", "phone", "email", "nationality", "loyalty_id", "loyalty_tier", "loyalty_points"]
_GUEST_FULL = _GUEST_BRIEF + ["first_name", "last_name", "dob", "address_city", "id_type", "passport_no", "aadhaar"]

FIELDS_BY_ACTION = {
    "reservation.search": _RES_ROW + _GUEST_BRIEF,
    "reservation.view": _RES_ROW + _GUEST_FULL + ["special_requests", "id_documents", "folio_summary"],
    "reservation.export": ["reservation_id", "property_id", "status", "channel", "arrival", "departure", "room_type",
                           "total_amount", "guest_id", "guest_name", "phone", "email", "nationality", "dob", "id_type",
                           "passport_no", "aadhaar", "loyalty_id", "loyalty_tier", "loyalty_points"],
    "guest.search": _GUEST_BRIEF,
    "guest.view": _GUEST_FULL + ["stays", "id_documents"],
    "id_document.download": ["id_document_image"],
    "folio.view": ["reservation_id", "folio_items", "folio_summary", "card_token", "card_brand", "card_last4"],
    "loyalty.search": ["loyalty_id", "guest_id", "guest_name", "loyalty_tier", "loyalty_points", "loyalty_frozen", "portal_email"],
    "loyalty.view": ["loyalty_id", "guest_id", "guest_name", "loyalty_tier", "loyalty_points", "loyalty_frozen",
                     "portal_email", "loyalty_transactions"],
}

# internal action -> (resource_type, operation); operation None = "search" if a query string was used else "list"
DATA_ACCESS = {
    "reservation.search": ("reservation", None),
    "reservation.view": ("reservation", "read"),
    "reservation.export": ("reservation", "export"),
    "guest.search": ("guest_profile", None),
    "guest.view": ("guest_profile", "read"),
    "pii.reveal": ("guest_profile", "read"),
    "id_document.download": ("identity_document", "read"),
    "folio.view": ("payment", "read"),
    "loyalty.search": ("loyalty", None),
    "loyalty.view": ("loyalty", "read"),
    "partner.reservations_read": ("reservation", "list"),
    "partner.reservation_read": ("reservation", "read"),
}

DATA_CHANGE = {
    "reservation.create": ("reservation", "create", ["reservation_id", "guest_name", "arrival", "departure", "room_type", "special_requests"]),
    "partner.reservation_created": ("reservation", "create", ["reservation_id", "guest_name", "guest_email", "guest_phone", "arrival", "departure"]),
    "reservation.update": ("reservation", "update", ["special_requests"]),
    "reservation.check_in": ("reservation", "update", ["status", "room_no"]),
    "reservation.check_out": ("reservation", "update", ["status"]),
    "id_document.upload": ("identity_document", "create", ["id_document_image"]),
    "folio.charge": ("payment", "create", ["folio_amount"]),
    "payment.capture": ("payment", "create", ["folio_amount", "card_token"]),
    "payment.refund_requested": ("payment", "create", ["refund_amount", "card_token", "refund_status"]),
    "payment.refund_completed": ("payment", "create", ["refund_amount", "card_token", "refund_status"]),
    "payment.refund_approved": ("payment", "update", ["refund_status"]),
    "payment.refund_rejected": ("payment", "update", ["refund_status"]),
    "loyalty.adjust": ("loyalty", "update", ["loyalty_points"]),
    "loyalty.redeem": ("loyalty", "update", ["loyalty_points"]),
    "loyalty.transfer": ("loyalty", "update", ["loyalty_points"]),
    "loyalty.contact_changed": ("loyalty", "update", ["portal_email"]),
}

# details keys that are safe (no PII values) to forward as ext fields on data.change
SAFE_CHANGE_DETAILS = {"amount", "new_card", "refund_to_new_instrument", "points", "new_balance", "field",
                       "old_domain", "new_domain", "card_number_stored_in_free_text", "card_numbers_detected",
                       "card_numbers_removed", "requested_by", "approved_by", "new_guest"}

LOGIN_FAILURES = {"auth.login_failed", "auth.login_blocked", "auth.mfa_failed", "auth.step_up_failed",
                  "auth.guest_login_failed"}
DENIAL_REASONS = {"SESSION_REVOKED", "SESSION_EXPIRED", "ACCOUNT_LOCKED", "IP_BLOCKED", "FORBIDDEN", "UNAUTHENTICATED"}


def guest_ref(guest_id: str, key: str | None = None) -> str:
    key = key if key is not None else get_settings().guest_ref_key
    return "h_" + hmac.new(key.encode(), guest_id.encode(), hashlib.sha256).hexdigest()[:32]


def field_catalog() -> dict:
    return {"fields": [{"resource_type": "*", "field": f, "category": cat}
                       for cat, fields in FIELD_CATEGORIES.items() for f in fields]}


def iso_z(value: str | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def producer() -> dict:
    s = get_settings()
    return {"system": "hms", "service": s.producer_service, "instance": s.producer_instance or socket.gethostname(),
            "environment": s.env}


def envelope(event_type: str, occurred_at: str | datetime, event_id: str, **blocks) -> dict:
    out = {"schema_version": SCHEMA_VERSION, "event_id": event_id, "event_type": event_type,
           "occurred_at": iso_z(occurred_at), "producer": producer()}
    out.update({k: v for k, v in blocks.items() if v is not None})
    return out


# ---------------------------------------------------------------- reference data builders

def staff_reference(staff) -> dict:
    now = datetime.now(timezone.utc)
    if staff.status != "active":
        status = "SUSPENDED"
    elif staff.locked_until and staff.locked_until > now:
        status = "LOCKED"
    else:
        status = "ACTIVE"
    parts = staff.name.split()
    display = f"{parts[0]} {parts[-1][0]}." if len(parts) > 1 else staff.name
    return {
        "user_id": staff.id, "display_name": display, "role": ROLE_MAP.get(staff.role, staff.role.upper()),
        "home_property_id": staff.home_property_id, "assigned_property_ids": list(staff.property_scope or []),
        "shift": {"start": staff.shift_start.strftime("%H:%M"), "end": staff.shift_end.strftime("%H:%M"),
                  "timezone": "Asia/Kolkata", "days": list(staff.shift_days or [])},
        "status": status, "mfa_enrolled": bool(staff.mfa_enabled and staff.mfa_secret),
        "is_service_account": False,
    }


def partner_reference(partner, property_ids: list[str]) -> dict:
    return {"user_id": partner.id, "display_name": partner.name, "role": "INTEGRATION", "home_property_id": None,
            "assigned_property_ids": property_ids, "shift": None,
            "status": "ACTIVE" if partner.key_status == "active" else "SUSPENDED", "mfa_enrolled": False,
            "is_service_account": True}


def property_reference(prop) -> dict:
    return {"property_id": prop.id, "name": prop.name, "city": prop.city, "timezone": "Asia/Kolkata"}


# ---------------------------------------------------------------- adapter

def _guest_refs(resource: dict) -> list[str]:
    return [guest_ref(g) for g in (resource.get("guest_ids") or [])[:MAX_GUEST_REFS]]


def _actor(ev: dict) -> dict | None:
    a = ev.get("actor", {})
    kind = a.get("type")
    if kind == "staff" and a.get("id"):
        return {"user_id": a["id"], "role": ROLE_MAP.get(a.get("role"), (a.get("role") or "").upper() or None),
                "home_property_id": a.get("home_property"), "is_service_account": False,
                # ext: business context STAYSEC can use directly
                "assigned_property_ids": a.get("property_scope"), "on_shift": a.get("on_shift"),
                "local_time": a.get("local_time")}
    if kind == "partner" and a.get("id"):
        return {"user_id": a["id"], "role": "INTEGRATION", "home_property_id": None, "is_service_account": True}
    if kind == "guest" and a.get("id"):
        guest_ids = (ev.get("resource") or {}).get("guest_ids") or []
        ref = guest_ref(guest_ids[0]) if guest_ids else guest_ref("loyalty:" + a["id"])
        return {"user_id": ref, "role": "GUEST", "home_property_id": None, "is_service_account": False}
    if kind == "service":
        return {"user_id": f"service:{a.get('id')}", "role": "SERVICE", "home_property_id": None, "is_service_account": True}
    return None


def _session(ev: dict) -> dict | None:
    a = ev.get("actor", {})
    if a.get("type") == "partner":
        return {"session_id": None, "auth_method": "api_key", "mfa_verified": False}
    if a.get("session_id"):
        return {"session_id": a["session_id"], "auth_method": "password", "mfa_verified": bool(a.get("mfa_verified")),
                "issued_at": iso_z(a.get("session_issued_at"))}
    return None


def _client(ev: dict) -> dict | None:
    a = ev.get("actor", {})
    if not a.get("ip") and not a.get("user_agent"):
        return None
    device = a.get("device_id")
    return {"ip": a.get("ip"), "user_agent": a.get("user_agent"),
            "device_id": None if device in (None, "unknown") else device,
            "device_known": a.get("device_known")}  # ext


def _request(ev: dict) -> dict | None:
    r = ev.get("request")
    if not r:
        return None
    return {"request_id": r.get("request_id"), "method": r.get("method"), "route": r.get("route") or r.get("path"),
            "status_code": r.get("status_code"), "latency_ms": r.get("latency_ms")}


def _common(ev: dict) -> dict:
    return {"actor": _actor(ev), "session": _session(ev), "client": _client(ev), "request": _request(ev)}


def _data_access(ev: dict) -> dict:
    action, res = ev["action"], ev.get("resource") or {}
    resource_type, operation = DATA_ACCESS[action]
    query = res.get("query") or {}
    if operation is None:
        operation = "search" if query.get("q") else "list"
    if action.startswith("partner."):
        fields = res.get("fields_returned") or []
    elif action == "pii.reveal":
        fields = list(res.get("pii_fields") or [])
    else:
        fields = FIELDS_BY_ACTION.get(action, [])
    masked_fields = res.get("masked_fields") or []
    data = {
        "resource_type": resource_type,
        "operation": operation,
        "record_count": res.get("count", len(res.get("ids") or [])),
        "guest_refs": _guest_refs(res),
        "property_ids": res.get("properties") or [],
        "fields_returned": fields,
        "vip_record_count": res.get("vip_count", 0),
        "page": query.get("page"),
        "page_size": query.get("page_size") or query.get("limit"),
        "total_available": res.get("total_matching"),
        "export_format": res.get("format") if operation == "export" else None,
        # Aadhaar is never stored in full, so it is always partial; "masked" reflects the masking control itself.
        "masked": bool(set(masked_fields) - {"aadhaar"}),
        # ext
        "distinct_guests": res.get("distinct_guests"),
        "masked_fields": masked_fields or None,
        "sort": query.get("sort"),
        "fields_beyond_contract": res.get("fields_beyond_contract") or None,
        "export_bytes": res.get("bytes"),
    }
    if action == "pii.reveal":
        data["reveal"] = True
        data["reason_provided"] = bool((ev.get("details") or {}).get("reason"))
    return {k: v for k, v in data.items() if v is not None or k in ("export_format",)}


def _data_change(ev: dict) -> dict:
    res, details = ev.get("resource") or {}, ev.get("details") or {}
    resource_type, operation, fields = DATA_CHANGE[ev["action"]]
    data = {"resource_type": resource_type, "operation": operation,
            "record_count": max(1, len(set(res.get("guest_ids") or res.get("ids") or []))),
            "guest_refs": _guest_refs(res), "property_ids": res.get("properties") or [], "fields_changed": fields,
            "change": ev["action"]}  # ext: precise StayDesk action
    extras = {k: v for k, v in details.items() if k in SAFE_CHANGE_DETAILS}
    if extras:
        data["details"] = extras  # ext
    return data


def _staysec_action_id(details: dict) -> str | None:
    by = (details or {}).get("revoked_by") or ""
    return by.split(":", 1)[1] if by.startswith("staysec:") else None


def to_v1(ev: dict) -> dict | None:
    """Convert one internal StayDesk event to a STAYSEC v1.0 event (or None if it has no contract equivalent)."""
    action = ev.get("action", "")
    outcome = ev.get("outcome") or {}
    details = ev.get("details") or {}
    eid, ts = ev["event_id"], ev["ts"]

    # Pre-built contract events (reference.*, session.terminated, security.action.applied, ...)
    if "v1" in details:
        payload = details["v1"]
        blocks = _common(ev) if payload.get("_with_context") else {}
        data = {k: v for k, v in payload.items() if k != "_with_context"}
        return envelope(action, ts, eid, data=data, **blocks)

    if outcome.get("result") == "denied":
        if action in LOGIN_FAILURES:
            code = outcome.get("code")
            actor_id = (ev.get("actor") or {}).get("id")
            if not code:
                code = "BAD_PASSWORD" if actor_id else "UNKNOWN_USER"
            data = {"failure_reason": code if code in {"BAD_PASSWORD", "UNKNOWN_USER", "ACCOUNT_LOCKED", "MFA_FAILED",
                                                       "IP_BLOCKED"} else "OTHER",
                    "user_id": actor_id if code != "UNKNOWN_USER" and ev["actor"].get("type") == "staff" else None,
                    "realm": "guest_portal" if action == "auth.guest_login_failed" else "staff",  # ext
                    "stage": {"auth.mfa_failed": "mfa", "auth.step_up_failed": "step_up"}.get(action, "login")}  # ext
            blocks = _common(ev)
            if code == "UNKNOWN_USER":
                blocks["actor"] = None
            return envelope("auth.login.failed", ts, eid, data={k: v for k, v in data.items() if v is not None}, **blocks)

        code = outcome.get("code") or ("UNAUTHENTICATED" if (ev.get("request") or {}).get("status_code") == 401 else "FORBIDDEN")
        actor_id = (ev.get("actor") or {}).get("id")
        res = ev.get("resource") or {}
        data = {"reason": code if code in DENIAL_REASONS else "FORBIDDEN",
                "user_id": actor_id if ev.get("actor", {}).get("type") == "staff" else None,
                "staysec_action_id": _staysec_action_id(details),
                # ext: why StayDesk refused, so attempts blocked by a control are visible to STAYSEC
                "attempted_action": action, "policy": outcome.get("policy"), "message": outcome.get("reason"),
                "requested_record_count": res.get("count"), "property_ids": res.get("properties")}
        return envelope("access.denied", ts, eid, data={k: v for k, v in data.items() if v is not None}, **_common(ev))

    if action in ("auth.login_success", "auth.guest_login_success"):
        blocks = _common(ev)
        data = {"realm": "guest_portal" if action == "auth.guest_login_success" else "staff",  # ext
                "new_device": details.get("new_device")}
        return envelope("auth.login.succeeded", ts, eid, data={k: v for k, v in data.items() if v is not None}, **blocks)
    if action == "auth.logout":
        blocks = _common(ev)
        return envelope("auth.logout", ts, eid, actor=blocks["actor"], session=blocks["session"])
    if action in DATA_ACCESS:
        return envelope("data.access", ts, eid, data=_data_access(ev), **_common(ev))
    if action in DATA_CHANGE:
        return envelope("data.change", ts, eid, data=_data_change(ev), **_common(ev))
    if action in ("admin.policy_changed", "control.policy_changed"):
        before, after = details.get("before") or {}, details.get("after") or {}
        return envelope("security.control.changed", ts, eid, **_common(ev), data={
            "control": details.get("policy"), "enabled_before": before.get("enabled"), "enabled_after": after.get("enabled"),
            "params_after": after.get("params"), "control_disabled": details.get("control_disabled", False),
            "changed_via": "admin_ui" if action.startswith("admin.") else "control_api",
            "staysec_action_id": details.get("action_id")})
    if action == "admin.partner_updated":
        return envelope("security.control.changed", ts, eid, **_common(ev), data={
            "control": "ota_partner_allowlist", "partner_id": (ev.get("resource") or {}).get("ids", [None])[0],
            "fields_added": details.get("fields_added"), "changed_via": "admin_ui"})
    if action == "pii.card_number_scrubbed":
        res = ev.get("resource") or {}
        return envelope("security.control.triggered", ts, eid, **_common(ev), data={
            "control": "card_number_scrubbing", "guest_refs": _guest_refs(res), "property_ids": res.get("properties") or [],
            "card_numbers_removed": details.get("card_numbers_removed")})
    return None
