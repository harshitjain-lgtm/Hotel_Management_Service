"""Normal hotel activity generator - realistic background noise for the live dashboard and baselines.

Simulates on-shift staff working from their usual front-desk PCs on the property network:
searching today's arrivals, opening reservations and guest profiles, posting charges, and
managers exporting small daily arrival lists. Runs until Ctrl+C.
"""

import random
import time
from datetime import date, datetime, timedelta, timezone

from common import OFFICE_UA, base_args, load_seed, make_client, ok, staff_login, step, warn

IST = timezone(timedelta(hours=5, minutes=30))
PROPERTY_NET = {"MUM": "10.10", "GOA": "10.20", "JAI": "10.30"}


def on_shift(shift: str, now: datetime) -> bool:
    start, end = (datetime.strptime(x, "%H:%M").time() for x in shift.split("-"))
    t = now.time()
    return start <= t < end if start <= end else (t >= start or t < end)


def session(client, staff: dict, rng: random.Random, pace: float) -> int:
    actions = 0
    prop = staff["home_property"]
    today = date.today()
    arrivals = client.get("/reservations", params={"property": prop, "arrival_from": today.isoformat(),
                                                   "arrival_to": (today + timedelta(days=1)).isoformat(),
                                                   "page_size": 25, "sort": "arrival_asc"}).json().get("items", [])
    actions += 1
    for res in rng.sample(arrivals, k=min(len(arrivals), rng.randint(1, 4))):
        time.sleep(rng.uniform(1, 4) * pace)
        client.get(f"/reservations/{res['id']}")
        actions += 1
        if rng.random() < 0.3:
            client.get(f"/guests/{res['guest']['id']}")
            actions += 1
        if staff["role"] in ("front_desk", "finance") and rng.random() < 0.25:
            client.get(f"/reservations/{res['id']}/folio")
            actions += 1
    if staff["role"] == "front_desk" and rng.random() < 0.4:
        client.get("/reservations", params={"property": prop, "q": rng.choice(["sharma", "patel", "singh", "kumar", "STY-"]),
                                            "page_size": 25})
        actions += 1
    if staff["role"] == "property_manager" and rng.random() < 0.5:
        client.post("/reservations/export", json={"property": prop, "arrival_from": today.isoformat(),
                                                   "arrival_to": today.isoformat(), "sort": "arrival_asc"})
        actions += 1
    if staff["role"] == "loyalty_desk":
        client.get("/loyalty/accounts", params={"q": rng.choice(["AR20", "gold", "kumar"]), "sort": "name_asc"})
        actions += 1
    return actions


def main():
    parser = base_args(__doc__)
    parser.add_argument("--pace", type=float, default=1.0, help="multiplier for think time (lower = faster)")
    parser.add_argument("--any-shift", action="store_true", help="ignore shift rosters (use all staff)")
    args = parser.parse_args()
    seed = load_seed(args.seed)
    rng = random.Random()
    clients: dict[str, object] = {}
    step("Generating normal staff activity (Ctrl+C to stop)")
    total = 0
    while True:
        now = datetime.now(IST)
        pool = [s for s in seed["staff"] if s["role"] not in ("corporate_admin", "regional_manager")
                and (args.any_shift or on_shift(s["shift"], now))]
        if not pool:
            warn("no staff on shift right now; use --any-shift")
            time.sleep(30)
            continue
        staff = rng.choice(pool)
        client = clients.get(staff["id"])
        if client is None:
            net = PROPERTY_NET.get(staff["home_property"], "10.0")
            client = make_client(args.base, device_id=staff["known_device_id"], user_agent=OFFICE_UA,
                                 ip=f"{net}.{rng.randint(1, 20)}.{rng.randint(10, 200)}")
            result = staff_login(client, seed, staff["id"])
            if "access_token" not in result:
                warn(f"login failed for {staff['id']}: {result}")
                continue
            clients[staff["id"]] = client
        try:
            n = session(client, staff, rng, args.pace)
        except Exception as exc:  # session may have been revoked in a demo; re-login next time
            warn(f"{staff['id']}: {exc}")
            clients.pop(staff["id"], None)
            continue
        total += n
        ok(f"{staff['id']:<12} {n} actions (total {total})")
        time.sleep(rng.uniform(2, 6) * args.pace)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
