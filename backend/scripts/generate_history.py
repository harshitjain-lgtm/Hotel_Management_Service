"""Generate N days of synthetic *normal* activity events for monitoring baselines.

Uses the same event schema as the live service (app.audit.build_event) and real IDs from the seeded DB, but
writes straight to a JSONL file instead of the outbox. Events are tagged source.component = "history-generator".

Usage (from backend/):
    python -m scripts.generate_history --days 30 --out data/history_events.jsonl
"""

import argparse
import json
import random
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.audit import Actor, RequestMeta, Resource, build_event
from app.contract_v1 import to_v1
from app.db import SessionLocal
from app.models import Guest, LoyaltyAccount, Partner, Reservation, Staff

IST = timezone(timedelta(hours=5, minutes=30))
PROPERTY_NET = {"MUM": "10.10", "GOA": "10.20", "JAI": "10.30"}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
MASKED_BRIEF = (["name", "nationality"], ["phone", "email"])
REVEAL_REASONS = ["Calling guest about late arrival", "Verifying identity at check-in", "Guest requested invoice by email",
                  "Arranging airport pickup", "FRRO Form C submission"]


class Gen:
    def __init__(self, rng: random.Random):
        self.rng, self.events = rng, []

    @property
    def count(self) -> int:
        return len(self.events)

    def emit(self, ts: datetime, action: str, category: str, actor: Actor, path: str, method: str = "GET", **kw):
        event = build_event(action=action, category=category, actor=actor, ts=ts.astimezone(timezone.utc),
                            request=RequestMeta(request_id=str(uuid.uuid4()), method=method, path=path, route=path,
                                                status_code=200, latency_ms=self.rng.randint(15, 180)), **kw)
        event["source"]["component"] = "history-generator"
        self.events.append(event)


def shift_window(day: date, staff: Staff) -> tuple[datetime, datetime]:
    start = datetime.combine(day, staff.shift_start, IST)
    end = datetime.combine(day, staff.shift_end, IST)
    if end <= start:
        end += timedelta(days=1)
    return start, end


def staff_actor(staff: Staff, ts: datetime, ip: str, session: str) -> Actor:
    return Actor(type="staff", id=staff.id, role=staff.role, home_property=staff.home_property_id,
                 property_scope=list(staff.property_scope), on_shift=True, local_time=ts.astimezone(IST).strftime("%H:%M"),
                 ip=ip, device_id=f"dev-{staff.id}-desk", device_known=True, user_agent=UA, session_id=session,
                 mfa_verified=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--out", default="data/history_events.jsonl")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--format", choices=["v1", "internal"], default="v1",
                        help="v1 = STAYSEC HMS contract envelope (default), internal = raw StayDesk audit events")
    args = parser.parse_args()
    rng = random.Random(args.seed)

    with SessionLocal() as db:
        staff = db.query(Staff).order_by(Staff.id).all()
        partners = db.query(Partner).all()
        res_rows = db.execute(select(Reservation.id, Reservation.guest_id, Reservation.property_id, Reservation.arrival,
                                     Reservation.channel)).all()
        loyalty = db.execute(select(LoyaltyAccount.id, LoyaltyAccount.guest_id)).all()
        foreign = {g for (g,) in db.execute(select(Guest.id).where(Guest.nationality != "IN")).all()}

    by_prop_day: dict[tuple[str, date], list] = defaultdict(list)
    by_prop: dict[str, list] = defaultdict(list)
    by_channel: dict[str, list] = defaultdict(list)
    for r in res_rows:
        by_prop_day[(r.property_id, r.arrival)].append(r)
        by_prop[r.property_id].append(r)
        by_channel[r.channel].append(r)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    today = date.today()
    gen = Gen(rng)
    for offset in range(args.days, 0, -1):
        day = today - timedelta(days=offset)
        for s in staff:
            if s.role == "corporate_admin" or day.strftime("%a").upper() not in (s.shift_days or []):
                continue
            start, end = shift_window(day, s)
            net = PROPERTY_NET.get(s.home_property_id, "10.0")
            ip = f"{net}.{rng.randint(1, 20)}.{rng.randint(10, 200)}"
            session = str(uuid.uuid4())
            t = start + timedelta(minutes=rng.randint(0, 20))
            actor = lambda ts: staff_actor(s, ts, ip, session)  # noqa: E731
            gen.emit(t, "auth.login_success", "auth", actor(t), "/auth/login", "POST",
                     details={"mfa_verified": False, "new_device": False})
            props = s.property_scope if s.role in ("regional_manager", "loyalty_desk") else [s.home_property_id]

            def tick(lo=3, hi=25):
                nonlocal t
                t = min(t + timedelta(minutes=rng.randint(lo, hi), seconds=rng.randint(0, 59)), end - timedelta(minutes=1))
                return t

            if s.role in ("front_desk", "property_manager", "finance", "regional_manager"):
                n_search = {"front_desk": (4, 12), "property_manager": (3, 8), "finance": (2, 5), "regional_manager": (3, 10)}[s.role]
                n_view = {"front_desk": (15, 45), "property_manager": (8, 25), "finance": (5, 15), "regional_manager": (4, 12)}[s.role]
                pool = [r for p in props for r in by_prop_day.get((p, day), [])] or [r for p in props for r in by_prop[p][:200]]
                for _ in range(rng.randint(*n_search)):
                    page = rng.sample(pool, k=min(len(pool), rng.randint(5, 25)))
                    gen.emit(tick(), "reservation.search", "data_access", actor(t), "/reservations", resource=Resource(
                        type="reservation", ids=[r.id for r in page], guest_ids=[r.guest_id for r in page],
                        properties=[r.property_id for r in page], pii_fields=MASKED_BRIEF[0], masked_fields=MASKED_BRIEF[1],
                        query={"property": props[0] if len(props) == 1 else None, "sort": rng.choice(["arrival_asc", "arrival_desc"]),
                               "page": 1, "page_size": 25}, extra={"total_matching": len(pool)}))
                for _ in range(rng.randint(*n_view)):
                    r = rng.choice(pool)
                    gen.emit(tick(1, 12), "reservation.view", "data_access", actor(t), f"/reservations/{r.id}",
                             resource=Resource(type="reservation", ids=[r.id], guest_ids=[r.guest_id], properties=[r.property_id],
                                               pii_fields=["name", "nationality", "address_city"], masked_fields=["phone", "email", "dob"]))
                    if s.role == "front_desk" and rng.random() < 0.25:
                        gen.emit(tick(1, 5), "reservation.check_in", "data_access", actor(t), f"/reservations/{r.id}/check-in", "POST",
                                 resource=Resource(type="reservation", ids=[r.id], guest_ids=[r.guest_id], properties=[r.property_id]))
                        if r.guest_id in foreign or rng.random() < 0.4:
                            gen.emit(t + timedelta(seconds=20), "id_document.upload", "pii", actor(t), f"/reservations/{r.id}/check-in", "POST",
                                     resource=Resource(type="id_document", ids=[str(uuid.uuid4())], guest_ids=[r.guest_id],
                                                       properties=[r.property_id], pii_fields=["passport" if r.guest_id in foreign else "aadhaar"]))
                    if s.role in ("front_desk", "finance") and rng.random() < 0.2:
                        gen.emit(tick(1, 5), "folio.view", "payment", actor(t), f"/reservations/{r.id}/folio",
                                 resource=Resource(type="folio", ids=[r.id], guest_ids=[r.guest_id], properties=[r.property_id]))
                    if s.role == "front_desk" and rng.random() < 0.05:
                        gen.emit(tick(1, 5), "pii.reveal", "pii", actor(t), f"/guests/{r.guest_id}/reveal", "POST",
                                 resource=Resource(type="guest", ids=[r.guest_id], guest_ids=[r.guest_id], pii_fields=["phone"]),
                                 details={"reason": rng.choice(REVEAL_REASONS)})
                if s.role == "property_manager" or (s.role == "regional_manager" and day.weekday() == 0):
                    size = rng.randint(15, 120) if s.role == "property_manager" else rng.randint(80, 300)
                    sample = rng.sample(pool, k=min(len(pool), size))
                    gen.emit(tick(), "reservation.export", "data_access", actor(t), "/reservations/export", "POST",
                             resource=Resource(type="reservation", ids=[r.id for r in sample], guest_ids=[r.guest_id for r in sample],
                                               properties=[r.property_id for r in sample], pii_fields=["name", "nationality", "id_type", "loyalty"],
                                               masked_fields=["phone", "email", "dob", "passport_no", "aadhaar"],
                                               query={"sort": rng.choice(["arrival_asc", "amount_desc"])},
                                               extra={"format": "csv", "bytes": len(sample) * 175}))
                if s.role == "finance" and rng.random() < 0.3:
                    r = rng.choice(pool)
                    amount = round(rng.uniform(300, 3000), 2)
                    gen.emit(tick(), "payment.refund_requested", "payment", actor(t), f"/reservations/{r.id}/refunds", "POST",
                             resource=Resource(type="folio", ids=[r.id], guest_ids=[r.guest_id], properties=[r.property_id]),
                             policy="refund_dual_approval",
                             details={"amount": amount, "new_card": False, "refund_to_new_instrument": False, "reason": "Rate adjustment"})
            if s.role == "loyalty_desk":
                for _ in range(rng.randint(10, 30)):
                    acct = rng.choice(loyalty)
                    gen.emit(tick(2, 15), "loyalty.view", "loyalty", actor(t), f"/loyalty/accounts/{acct.id}",
                             resource=Resource(type="loyalty_account", ids=[acct.id], guest_ids=[acct.guest_id]))
                for _ in range(rng.randint(0, 3)):
                    acct = rng.choice(loyalty)
                    gen.emit(tick(), "loyalty.adjust", "loyalty", actor(t), f"/loyalty/accounts/{acct.id}/adjust", "POST",
                             resource=Resource(type="loyalty_account", ids=[acct.id], guest_ids=[acct.guest_id]),
                             details={"points": rng.choice([500, 1000, 2500, -500]), "reason": "Missing stay credit"})
            logout_at = end - timedelta(minutes=rng.randint(0, 15))
            gen.emit(max(logout_at, t + timedelta(minutes=1)), "auth.logout", "auth", actor(logout_at), "/auth/logout", "POST")

        for p in partners:  # hourly OTA syncs of contracted fields
            for hour in range(0, 24, rng.choice([1, 2])):
                ts = datetime.combine(day, time(hour, rng.randint(0, 59)), IST)
                batch = rng.sample(by_channel[p.id], k=min(len(by_channel[p.id]), rng.randint(20, 100)))
                actor = Actor(type="partner", id=p.id, ip="34.120.18.9", user_agent=f"{p.name}-Sync/3.2", device_id="unknown")
                gen.emit(ts, "partner.reservations_read", "partner", actor, "/partner/v1/reservations", resource=Resource(
                    type="reservation", ids=[r.id for r in batch], guest_ids=[r.guest_id for r in batch],
                    properties=[r.property_id for r in batch], pii_fields=["guest_name"] + (["guest_email"] if "guest_email" in p.allowed_fields else []),
                    query={"limit": 100, "page": 1},
                    extra={"fields_returned": sorted(p.allowed_fields), "fields_beyond_contract": []}))

        for _ in range(rng.randint(20, 60)):  # guest portal activity
            acct = rng.choice(loyalty)
            ts = datetime.combine(day, time(rng.randint(7, 23), rng.randint(0, 59)), IST)
            actor = Actor(type="guest", id=acct.id, ip=f"49.36.{rng.randint(0, 255)}.{rng.randint(1, 254)}",
                          user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)", device_id="unknown")
            gen.emit(ts, "auth.guest_login_success", "auth", actor, "/portal/login", "POST",
                     resource=Resource(type="loyalty_account", ids=[acct.id], guest_ids=[acct.guest_id]))
            if rng.random() < 0.15:
                gen.emit(ts + timedelta(minutes=3), "loyalty.redeem", "loyalty", actor, "/portal/redeem", "POST",
                         resource=Resource(type="loyalty_account", ids=[acct.id], guest_ids=[acct.guest_id]),
                         details={"points": rng.choice([2000, 5000, 8000]), "description": "Dining voucher"})
    gen.events.sort(key=lambda e: e["ts"])
    with out_path.open("w", encoding="utf-8") as fh:
        for event in gen.events:
            if args.format == "v1":
                event = to_v1(event)
                if event is None:
                    continue
            fh.write(json.dumps(event, separators=(",", ":")) + "\n")
    print(f"wrote {gen.count:,} events for {args.days} days to {out_path}")


if __name__ == "__main__":
    main()
