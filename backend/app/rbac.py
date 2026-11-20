"""Role-based permissions. RBAC is always enforced; policy toggles are additional controls on top."""

ALL_PERMISSIONS = {
    "reservations.read",
    "reservations.write",
    "reservations.export",
    "guests.read",
    "guests.reveal",
    "folio.read",
    "folio.write",
    "refund.create",
    "refund.approve",
    "loyalty.read",
    "loyalty.adjust",
    "loyalty.redeem",
    "admin.manage",
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "front_desk": {
        "reservations.read", "reservations.write", "guests.read", "guests.reveal",
        "folio.read", "folio.write", "refund.create", "loyalty.read",
    },
    "property_manager": {
        "reservations.read", "reservations.write", "reservations.export", "guests.read", "guests.reveal",
        "folio.read", "folio.write", "refund.create", "refund.approve",
        "loyalty.read", "loyalty.adjust", "loyalty.redeem",
    },
    "finance": {
        "reservations.read", "guests.read", "folio.read", "folio.write", "refund.create", "refund.approve",
    },
    "regional_manager": {
        "reservations.read", "reservations.export", "guests.read", "guests.reveal",
        "folio.read", "loyalty.read", "loyalty.adjust",
    },
    "loyalty_desk": {
        "guests.read", "loyalty.read", "loyalty.adjust", "loyalty.redeem",
    },
    "corporate_admin": set(ALL_PERMISSIONS),
}

ROLE_LABELS = {
    "front_desk": "Front Desk Agent",
    "property_manager": "Property Manager",
    "finance": "Finance Executive",
    "regional_manager": "Regional Revenue Manager",
    "loyalty_desk": "Loyalty Desk Agent",
    "corporate_admin": "Corporate Admin",
}


def has_perm(role: str, perm: str) -> bool:
    return perm in ROLE_PERMISSIONS.get(role, set())


def permissions_for(role: str) -> list[str]:
    return sorted(ROLE_PERMISSIONS.get(role, set()))
