"""Security event construction.

Events are written to the transactional outbox in the same DB transaction as the business
action, so an action can never happen without its event (and vice versa). Events carry
pseudonymous IDs and PII *field names* only, never raw PII values.
"""

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from .config import get_settings
from .models import EventOutbox

SCHEMA_VERSION = "0.1"
MAX_IDS = 10_000


@dataclass
class Actor:
    type: str  # staff | guest | partner | service | anonymous
    id: str | None = None
    role: str | None = None
    home_property: str | None = None
    property_scope: list[str] | None = None
    on_shift: bool | None = None
    local_time: str | None = None
    ip: str | None = None
    device_id: str | None = None
    device_known: bool | None = None
    user_agent: str | None = None
    session_id: str | None = None
    mfa_verified: bool | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class RequestMeta:
    request_id: str
    method: str
    path: str


@dataclass
class Resource:
    type: str
    count: int | None = None
    ids: list[str] | None = None
    guest_ids: list[str] | None = None
    properties: list[str] | None = None
    pii_fields: list[str] | None = None
    masked_fields: list[str] | None = None
    query: dict | None = None
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"type": self.type}
        if self.ids is not None:
            ids = list(self.ids)
            out["count"] = self.count if self.count is not None else len(ids)
            out["ids"] = ids[:MAX_IDS]
            if len(ids) > MAX_IDS:
                out["ids_truncated"] = True
        elif self.count is not None:
            out["count"] = self.count
        if self.guest_ids is not None:
            distinct = list(dict.fromkeys(g for g in self.guest_ids if g))
            out["guest_ids"] = distinct[:MAX_IDS]
            out["distinct_guests"] = len(distinct)
        if self.properties is not None:
            out["properties"] = sorted({p for p in self.properties if p})
        if self.pii_fields is not None:
            out["pii_fields"] = list(self.pii_fields)
        if self.masked_fields:
            out["masked_fields"] = list(self.masked_fields)
        if self.query:
            out["query"] = {k: v for k, v in self.query.items() if v is not None}
        out.update(self.extra)
        return out


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def build_event(
    *,
    action: str,
    category: str,
    actor: Actor,
    request: RequestMeta | None = None,
    resource: Resource | dict | None = None,
    outcome: str = "allowed",
    reason: str | None = None,
    policy: str | None = None,
    details: dict | None = None,
    ts: datetime | None = None,
) -> dict:
    event: dict = {
        "schema_version": SCHEMA_VERSION,
        "event_id": str(uuid.uuid4()),
        "ts": (ts or datetime.now(timezone.utc)).isoformat(timespec="milliseconds"),
        "source": {"system": "staydesk", "component": "hm-backend", "env": get_settings().env},
        "action": action,
        "category": category,
        "actor": actor.to_dict(),
        "outcome": {"result": outcome},
    }
    if reason:
        event["outcome"]["reason"] = reason
    if policy:
        event["outcome"]["policy"] = policy
    if resource is not None:
        event["resource"] = resource.to_dict() if isinstance(resource, Resource) else resource
    if details:
        event["details"] = details
    if request is not None:
        event["request"] = asdict(request)
    return json.loads(json.dumps(event, default=_json_default))


def emit(db: Session, **kwargs) -> dict:
    event = build_event(**kwargs)
    db.add(EventOutbox(event_id=event["event_id"], action=event["action"], payload=event))
    return event
