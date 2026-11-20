"""Security controls ("Policy Center" toggles).

Every control is enforced in the backend, so attack scripts calling the API directly
are subject to the same checks as the UI. Turning a control OFF models a realistic
misconfiguration (e.g. "front desk complained about MFA, so a manager disabled it").
"""

from sqlalchemy.orm import Session

from .models import PolicySetting

POLICY_DEFS: dict[str, dict] = {
    "property_scope": {
        "title": "Property-scoped access",
        "description": "Staff can only access reservations and guests of properties in their assigned scope.",
        "gap_when_off": "Any staff account can query every property in the chain.",
        "risk": "unauthorized_booking_access",
        "default": True,
        "params": {},
    },
    "new_device_mfa": {
        "title": "MFA on new devices",
        "description": "Logging in from an unrecognised device requires a TOTP code.",
        "gap_when_off": "A stolen password alone is enough to log in from anywhere.",
        "risk": "account_compromise",
        "default": True,
        "params": {},
    },
    "export_step_up": {
        "title": "Step-up MFA for bulk exports",
        "description": "Exports above the row threshold require a fresh TOTP code.",
        "gap_when_off": "Unlimited silent bulk export of reservations.",
        "risk": "unauthorized_booking_access",
        "default": True,
        "params": {"threshold": 500, "window_minutes": 5},
    },
    "pii_masking": {
        "title": "Guest identity masking",
        "description": "Phone, email and ID numbers are masked in lists and exports; revealing a value requires a reason and is logged.",
        "gap_when_off": "Full passport numbers, phones and emails appear in lists and exports.",
        "risk": "guest_identity_exposure",
        "default": True,
        "params": {},
    },
    "refund_dual_approval": {
        "title": "Two-person refund approval",
        "description": "Refunds stay pending until a different finance/manager user approves them.",
        "gap_when_off": "A single user can refund any amount to any card.",
        "risk": "payment_workflow_compromise",
        "default": True,
        "params": {},
    },
    "loyalty_cooling_off": {
        "title": "Loyalty cooling-off after contact change",
        "description": "Point redemptions and transfers are blocked for a period after the account email/phone changes.",
        "gap_when_off": "A hijacked loyalty account can be drained immediately.",
        "risk": "loyalty_account_misuse",
        "default": True,
        "params": {"hours": 24},
    },
    "ota_field_allowlist": {
        "title": "OTA data-sharing allowlist",
        "description": "Partner API responses contain only the fields contracted for each partner.",
        "gap_when_off": "Partners receive full guest profiles, including passport and date of birth.",
        "risk": "excessive_third_party_sharing",
        "default": True,
        "params": {},
    },
    "card_number_scrubbing": {
        "title": "Card-number scrubbing in free text",
        "description": "Card numbers typed into notes or special requests are detected (Luhn) and removed.",
        "gap_when_off": "Full card numbers are stored in plain-text notes (PCI DSS exposure).",
        "risk": "payment_workflow_compromise",
        "default": True,
        "params": {},
    },
}


def ensure_policies(db: Session) -> None:
    existing = {p.key for p in db.query(PolicySetting.key).all()}
    for key, definition in POLICY_DEFS.items():
        if key not in existing:
            db.add(PolicySetting(key=key, enabled=definition["default"], params=dict(definition["params"]), updated_by="system"))


def get_policy(db: Session, key: str) -> tuple[bool, dict]:
    setting = db.get(PolicySetting, key)
    definition = POLICY_DEFS[key]
    if setting is None:
        return definition["default"], dict(definition["params"])
    params = {**definition["params"], **(setting.params or {})}
    return setting.enabled, params


def is_enabled(db: Session, key: str) -> bool:
    return get_policy(db, key)[0]


def policy_view(setting: PolicySetting) -> dict:
    definition = POLICY_DEFS.get(setting.key, {})
    return {
        "key": setting.key,
        "enabled": setting.enabled,
        "params": {**definition.get("params", {}), **(setting.params or {})},
        "title": definition.get("title", setting.key),
        "description": definition.get("description", ""),
        "gap_when_off": definition.get("gap_when_off", ""),
        "risk": definition.get("risk"),
        "updated_by": setting.updated_by,
        "updated_at": setting.updated_at.isoformat() if setting.updated_at else None,
    }
