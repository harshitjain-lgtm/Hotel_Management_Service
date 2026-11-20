"""Seed synthetic data for a fictional 3-property hotel chain ("Aranya Hotels").

All people, emails (reserved .example domains), phone numbers and documents are synthetic.

Usage (from backend/):
    python -m scripts.seed --reset
Outputs:
    data/seed_output.json  - demo credentials, MFA secrets, partner keys, demo targets (gitignored)
    data/honeytokens.json  - honeytoken guest/loyalty IDs for the monitoring team (gitignored)
"""

import argparse
import json
import os
import random
import secrets
import string
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from faker import Faker
from sqlalchemy import insert

from app import contract_v1, security
from app.db import Base, SessionLocal, engine
from app.models import (
    CardToken,
    FolioItem,
    Guest,
    IdDocument,
    LoyaltyAccount,
    LoyaltyTransaction,
    Partner,
    Property,
    Reservation,
    Staff,
    StaffDevice,
)
from app.policy import ensure_policies

RNG = random.Random(42)
Faker.seed(42)
IST = timezone(timedelta(hours=5, minutes=30))

# Local defaults are public (README). Deployed environments set SEED_PASSWORD / SEED_GUEST_PASSWORD from Secrets Manager.
DEMO_STAFF_PASSWORD = os.environ.get("SEED_PASSWORD") or "StayDesk@2026"
DEMO_GUEST_PASSWORD = os.environ.get("SEED_GUEST_PASSWORD") or "Guest@2026"
EMAIL_DOMAINS = ["example.com", "example.net", "example.org", "mail.example", "inbox.example"]

PROPERTIES = [
    ("MUM", "Aranya Mumbai", "Mumbai", 220, 0.45),
    ("GOA", "Aranya Goa", "Goa", 140, 0.33),
    ("JAI", "Aranya Jaipur", "Jaipur", 120, 0.22),
]
ROOM_TYPES = [("standard", 4500, 35), ("deluxe", 7500, 40), ("premier", 11000, 18), ("suite", 18000, 7)]
CHANNELS = [("direct", 40), ("TRIPNEST", 30), ("STAYFINDER", 20), ("walk_in", 10)]
NATIONALITIES = [("IN", 85), ("GB", 3), ("US", 3), ("DE", 2), ("FR", 2), ("AE", 2), ("SG", 1), ("AU", 1), ("JP", 1)]
LOCALE_FOR = {"IN": "en_IN", "GB": "en_GB", "US": "en_US", "DE": "de_DE", "FR": "fr_FR"}
DIAL_CODE = {"IN": "+91", "GB": "+44", "US": "+1", "DE": "+49", "FR": "+33", "AE": "+971", "SG": "+65", "AU": "+61", "JP": "+81"}
SPECIAL_REQUESTS = [
    "Late check-in around 11pm", "High floor, away from lift", "Airport pickup required", "Extra pillows",
    "Vegetarian breakfast", "Anniversary - cake in room please", "Baby cot required", "Early check-in if possible",
    "Quiet room please", "Need GST invoice for company", "Twin beds preferred", "Allergic to nuts",
]
# Well-known payment-network TEST card numbers, typed into notes to simulate a PCI violation.
CARD_IN_NOTES = [
    "Guest asked us to keep card on file 4111 1111 1111 1111 exp 09/28",
    "Pay at hotel - card 5555 5555 5555 4444, call guest before charging",
    "Corporate card for incidentals: 4012-8888-8888-1881",
    "Charge deposit to 3782 822463 10005 (Amex)",
    "Guest gave card over phone 4111111111111111 cvv shared",
    "Use card 5555555555554444 for no-show fee",
    "Card on file: 4012 8888 8888 1881",
]
HONEYTOKEN_PROFILES = [
    ("Vikram", "Malhotra", "IN"), ("Ananya", "Kapoor", "IN"), ("Rohan", "Mehta", "IN"),
    ("Charlotte", "Whitfield", "GB"), ("Arjun", "Singhania", "IN"),
]

fakers = {loc: Faker(loc) for loc in set(LOCALE_FOR.values())}


def weighted(options):
    return RNG.choices([o[0] for o in options], weights=[o[-1] for o in options])[0]


def ascii_slug(value: str) -> str:
    return "".join(c for c in value.lower() if c.isascii() and c.isalnum())


def phone_for(nat: str) -> str:
    if nat == "IN":
        return f"+91 {RNG.choice('6789')}{RNG.randint(100000000, 999999999)}"
    return f"{DIAL_CODE.get(nat, '+1')} {RNG.randint(200000000, 999999999)}"


def passport_for(nat: str) -> str:
    if nat == "IN":
        return RNG.choice("JKLMNPRSTUVWZ") + f"{RNG.randint(1000000, 9999999)}"
    return "".join(RNG.choice(string.ascii_uppercase + string.digits) for _ in range(9))


def staff_specs():
    specs = []
    shifts = [("01", time(7), time(15)), ("02", time(15), time(23)), ("03", time(23), time(7))]
    for code, *_ in PROPERTIES:
        p = code.lower()
        for suffix, start, end in shifts:
            specs.append((f"fd_{p}_{suffix}", "front_desk", code, [code], start, end))
        specs.append((f"pm_{p}_01", "property_manager", code, [code], time(9), time(18)))
        specs.append((f"fin_{p}_01", "finance", code, [code], time(9), time(18)))
    all_props = [c for c, *_ in PROPERTIES]
    specs.append(("rm_west_01", "regional_manager", "MUM", all_props, time(10), time(19)))
    specs.append(("loy_desk_01", "loyalty_desk", "MUM", all_props, time(9), time(18)))
    specs.append(("admin_01", "corporate_admin", "MUM", all_props, time(9), time(18)))
    return specs


def chunked_insert(db, model, rows, size=1000):
    # One multi-row INSERT ... VALUES per chunk. (executemany is very slow against Docker Desktop on Windows.)
    for i in range(0, len(rows), size):
        db.execute(insert(model.__table__).values(rows[i:i + size]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="drop and recreate all tables first")
    parser.add_argument("--guests", type=int, default=10_000)
    parser.add_argument("--reservations", type=int, default=25_000)
    args = parser.parse_args()

    if args.reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    today = date.today()
    now = datetime.now(timezone.utc)
    out = {"generated_at": now.isoformat(), "staff_password": DEMO_STAFF_PASSWORD,
           "guest_portal_password": DEMO_GUEST_PASSWORD, "staff": [], "partners": [], "demo_targets": {}}

    with SessionLocal() as db:
        # ---- properties ----
        chunked_insert(db, Property, [{"id": c, "name": n, "city": city, "rooms": rooms} for c, n, city, rooms, _ in PROPERTIES])

        # ---- staff ----
        staff_hash = security.hash_password(DEMO_STAFF_PASSWORD)
        en_in = fakers["en_IN"]
        staff_rows, device_rows = [], []
        all_days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        for sid, role, home, scope, start, end in staff_specs():
            secret = security.new_totp_secret()
            day_off = RNG.choice(all_days)
            days = [d for d in all_days if d != day_off] if role in ("front_desk", "finance", "property_manager") else all_days[:5]
            name = en_in.name()
            staff_rows.append({"id": sid, "name": name, "email": f"{sid}@aranyahotels.example", "password_hash": staff_hash,
                               "role": role, "home_property_id": home, "property_scope": scope, "mfa_secret": secret,
                               "mfa_enabled": True, "status": "active", "shift_start": start, "shift_end": end,
                               "shift_days": days})
            device_rows.append({"staff_id": sid, "device_id": f"dev-{sid}-desk",
                                "first_seen": now - timedelta(days=200), "last_seen": now - timedelta(hours=8)})
            out["staff"].append({"id": sid, "name": name, "role": role, "home_property": home, "property_scope": scope,
                                 "shift": f"{start:%H:%M}-{end:%H:%M}", "shift_days": days, "known_device_id": f"dev-{sid}-desk",
                                 "mfa_secret": secret, "otpauth_uri": security.totp_uri(secret, sid)})
        chunked_insert(db, Staff, staff_rows)
        chunked_insert(db, StaffDevice, device_rows)
        front_desk_by_prop = {c: [s["id"] for s in staff_rows if s["role"] == "front_desk" and s["home_property_id"] == c]
                              for c, *_ in PROPERTIES}

        # ---- partners ----
        partner_defs = [
            ("TRIPNEST", "TripNest", ["reservation_id", "property_id", "status", "arrival", "departure", "room_type",
                                      "adults", "children", "total_amount", "guest_name"]),
            ("STAYFINDER", "StayFinder", ["reservation_id", "property_id", "status", "arrival", "departure", "room_type",
                                          "adults", "children", "total_amount", "guest_name", "guest_email"]),
        ]
        for pid, name, fields in partner_defs:
            key = security.new_api_key(pid.lower()[:8])
            db.add(Partner(id=pid, name=name, api_key_hash=security.hash_api_key(key), key_prefix=key[:12],
                           key_status="active", allowed_fields=fields))
            out["partners"].append({"id": pid, "name": name, "api_key": key, "allowed_fields": fields})

        # ---- guests ----
        guest_rows = []
        honeytoken_idx = set(RNG.sample(range(args.guests), len(HONEYTOKEN_PROFILES)))
        honey_iter = iter(HONEYTOKEN_PROFILES)
        honeytoken_guest_ids = []
        for i in range(args.guests):
            gid = f"G{1_000_000 + i}"
            if i in honeytoken_idx:
                first, last, nat = next(honey_iter)
                honeytoken_guest_ids.append(gid)
                dob = date(RNG.randint(1965, 1985), RNG.randint(1, 12), RNG.randint(1, 28))
            else:
                nat = weighted(NATIONALITIES)
                fk = fakers[LOCALE_FOR.get(nat, "en_US")]
                first, last = fk.first_name(), fk.last_name()
                if RNG.random() < 0.03:
                    dob = today - timedelta(days=RNG.randint(5 * 365, 17 * 365))
                else:
                    dob = today - timedelta(days=RNG.randint(18 * 365, 75 * 365))
            email = f"{ascii_slug(first)}.{ascii_slug(last)}{i}@{RNG.choice(EMAIL_DOMAINS)}"
            row = {"id": gid, "first_name": first, "last_name": last, "email": email, "phone": phone_for(nat),
                   "nationality": nat, "dob": dob, "address_city": fakers[LOCALE_FOR.get(nat, "en_US")].city(),
                   "id_type": None, "passport_no_enc": None, "passport_last4": None, "aadhaar_last4": None}
            roll = RNG.random()
            if nat != "IN" or roll < 0.25 or gid in honeytoken_guest_ids:
                passport = passport_for(nat)
                row.update(id_type="passport", passport_no_enc=security.encrypt_str(passport), passport_last4=passport[-4:])
            elif roll < 0.85:
                row.update(id_type="aadhaar", aadhaar_last4=f"{RNG.randint(0, 9999):04d}")
            else:
                row.update(id_type="driving_licence")
            guest_rows.append(row)
        chunked_insert(db, Guest, guest_rows)
        guest_ids = [g["id"] for g in guest_rows]
        guest_by_id = {g["id"]: g for g in guest_rows}

        # ---- loyalty ----
        guest_hash = security.hash_password(DEMO_GUEST_PASSWORD)
        loyalty_rows, txn_rows, loyalty_by_guest = [], [], {}
        honeytoken_loyalty_ids = []
        for n, gid in enumerate(guest_ids):
            is_honey = gid in honeytoken_guest_ids
            if not is_honey and RNG.random() > 0.35:
                continue
            points = RNG.randint(650_000, 950_000) if is_honey else min(int(RNG.lognormvariate(9.2, 1.0)), 400_000)
            tier = "Platinum" if points >= 50_000 else ("Gold" if points >= 10_000 else "Silver")
            lid = f"AR{2_000_000 + n}"
            loyalty_rows.append({"id": lid, "guest_id": gid, "tier": tier, "points_balance": points,
                                 "portal_email": guest_by_id[gid]["email"], "portal_password_hash": guest_hash,
                                 "frozen": False, "created_at": now - timedelta(days=RNG.randint(30, 1500))})
            txn_rows.append({"account_id": lid, "kind": "earn", "points": points, "description": "Opening balance (stays & promotions)",
                             "performed_by_type": "system", "performed_by": None})
            loyalty_by_guest[gid] = lid
            if is_honey:
                honeytoken_loyalty_ids.append(lid)
        chunked_insert(db, LoyaltyAccount, loyalty_rows)
        chunked_insert(db, LoyaltyTransaction, txn_rows)

        # ---- reservations, folios, card tokens, ID documents ----
        res_rows, folio_rows, card_rows, doc_rows = [], [], [], []
        card_by_guest: dict[str, str] = {}
        used_ids: set[str] = set()
        card_note_slots = set(RNG.sample(range(args.reservations), len(CARD_IN_NOTES)))
        card_notes = iter(CARD_IN_NOTES)
        prop_codes = [p[0] for p in PROPERTIES]
        prop_weights = [p[4] for p in PROPERTIES]
        # every honeytoken guest gets a few stays so bulk exports sorted by loyalty points touch them
        forced_guests = [g for g in honeytoken_guest_ids for _ in range(3)]

        for i in range(args.reservations):
            rid = "STY-" + "".join(RNG.choice(string.ascii_uppercase + string.digits) for _ in range(8))
            while rid in used_ids:
                rid = "STY-" + "".join(RNG.choice(string.ascii_uppercase + string.digits) for _ in range(8))
            used_ids.add(rid)
            gid = forced_guests[i] if i < len(forced_guests) else RNG.choice(guest_ids)
            prop = RNG.choices(prop_codes, weights=prop_weights)[0]
            arrival = today + timedelta(days=RNG.randint(-365, 60))
            nights = RNG.choices([1, 2, 3, 4, 5, 7], weights=[25, 30, 20, 10, 8, 7])[0]
            departure = arrival + timedelta(days=nights)
            room_type = weighted(ROOM_TYPES)
            rate = next(r for t, r, _ in ROOM_TYPES if t == room_type)
            total = Decimal(round(nights * rate * RNG.uniform(0.85, 1.15), 2))
            channel = weighted(CHANNELS)
            if departure < today:
                status = "cancelled" if RNG.random() < 0.05 else "checked_out"
            elif arrival <= today:
                status = "checked_in"
            else:
                status = "cancelled" if RNG.random() < 0.04 else "booked"
            notes = None
            if i in card_note_slots:
                notes = next(card_notes)
            elif RNG.random() < 0.3:
                notes = RNG.choice(SPECIAL_REQUESTS)
            desk = RNG.choice(front_desk_by_prop[prop])
            created_by = channel if channel in ("TRIPNEST", "STAYFINDER") else desk
            created_at = datetime.combine(arrival - timedelta(days=RNG.randint(1, 60)), time(RNG.randint(8, 22), RNG.randint(0, 59)), IST)
            res_rows.append({"id": rid, "guest_id": gid, "property_id": prop, "channel": channel, "status": status,
                             "arrival": arrival, "departure": departure, "room_type": room_type,
                             "room_no": f"{RNG.randint(1, 9)}{RNG.randint(1, 40):02d}" if status in ("checked_in", "checked_out") else None,
                             "adults": RNG.choice([1, 2, 2, 2, 3]), "children": RNG.choice([0, 0, 0, 1, 2]),
                             "total_amount": total, "special_requests": notes, "created_at": created_at, "created_by": created_by})

            if status in ("checked_in", "checked_out"):
                folio_rows.append({"reservation_id": rid, "kind": "charge", "amount": total, "description": f"Room charges ({nights} nights)",
                                   "card_token": None, "status": "completed", "created_by": desk})
                if status == "checked_out":
                    token = None
                    if RNG.random() < 0.8:
                        token = card_by_guest.get(gid)
                        if token is None:
                            token = "tok_" + secrets.token_hex(8)
                            card_by_guest[gid] = token
                            card_rows.append({"token": token, "guest_id": gid, "brand": RNG.choice(["visa", "mastercard", "rupay", "amex"]),
                                              "last4": f"{RNG.randint(0, 9999):04d}"})
                    folio_rows.append({"reservation_id": rid, "kind": "payment", "amount": total,
                                       "description": "Card payment" if token else "Cash payment", "card_token": token,
                                       "status": "completed", "created_by": desk})
                g = guest_by_id[gid]
                if g["nationality"] != "IN" or RNG.random() < 0.4:
                    doc_rows.append({"id": str(uuid.uuid4()), "guest_id": gid, "reservation_id": rid,
                                     "doc_type": g["id_type"] or "id_card", "storage_key": f"seed://no-file/{rid}",
                                     "uploaded_by": desk, "uploaded_at": datetime.combine(arrival, time(14), IST),
                                     "retention_until": departure + timedelta(days=180)})

        chunked_insert(db, Reservation, res_rows)
        chunked_insert(db, CardToken, card_rows)
        chunked_insert(db, FolioItem, folio_rows)
        chunked_insert(db, IdDocument, doc_rows)
        ensure_policies(db)
        db.commit()

        # ---- demo targets ----
        victim = next(l for l in loyalty_rows if 30_000 <= l["points_balance"] <= 90_000 and l["id"] not in honeytoken_loyalty_ids)
        mule = next(l for l in loyalty_rows if l["points_balance"] < 2_000 and l["id"] != victim["id"])
        out["demo_targets"] = {
            "headline_compromised_staff": "rm_west_01",
            "refund_insider_staff": "fd_goa_02",
            "loyalty_victim": {"account_id": victim["id"], "email": victim["portal_email"], "password": DEMO_GUEST_PASSWORD,
                               "points": victim["points_balance"]},
            "loyalty_mule_account": mule["id"],
            "ota_partner": "TRIPNEST",
        }
        out["honeytokens"] = {"guest_ids": honeytoken_guest_ids, "loyalty_account_ids": honeytoken_loyalty_ids,
                              # STAYSEC v1 guest_refs (HMAC with GUEST_REF_KEY) - what the monitoring side will see
                              "guest_refs": [contract_v1.guest_ref(g) for g in honeytoken_guest_ids]}
        out["counts"] = {"guests": len(guest_rows), "loyalty_accounts": len(loyalty_rows), "reservations": len(res_rows),
                         "folio_items": len(folio_rows), "card_tokens": len(card_rows), "id_documents": len(doc_rows),
                         "reservations_with_card_numbers_in_notes": len(CARD_IN_NOTES),
                         "id_documents_past_retention": sum(1 for d in doc_rows if d["retention_until"] < today)}

    data_dir = Path("data")
    data_dir.mkdir(exist_ok=True)
    (data_dir / "seed_output.json").write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    (data_dir / "honeytokens.json").write_text(json.dumps(out["honeytokens"], indent=2), encoding="utf-8")
    print(json.dumps(out["counts"], indent=2))
    shown = "(from SEED_PASSWORD, not printed)" if os.environ.get("SEED_PASSWORD") else DEMO_STAFF_PASSWORD
    print(f"Staff password: {shown} | demo secrets written to {data_dir / 'seed_output.json'}")


if __name__ == "__main__":
    main()
