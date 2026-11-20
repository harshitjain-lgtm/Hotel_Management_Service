"""Scenario 5: STAYSEC end-to-end test - compromised front-desk account pages through every reservation.

Mirrors the STAYSEC attack pattern (handoff section 7): a front-desk user, off-shift, from an external IP and a
scripted client, pages GET /api/reservations across all properties and opens details. It keeps going until the
HMS cuts the session off (401 SESSION_REVOKED / 403 ACCOUNT_LOCKED / IP_BLOCKED), then prints how far it got.

Needs property_scope and new_device_mfa OFF (demo_control.py preset vulnerable), otherwise prevention stops it first.
"""

import time

from common import base_args, blocked, contained, detail, load_seed, make_client, ok, staff_login, step, warn


def main():
    parser = base_args(__doc__)
    parser.add_argument("--staff", default="fd_goa_01")
    parser.add_argument("--ip", default="203.0.113.77")
    parser.add_argument("--page-size", type=int, default=200)
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between pages")
    parser.add_argument("--max-seconds", type=int, default=420)
    args = parser.parse_args()
    seed = load_seed(args.seed)

    attacker = make_client(args.base, ip=args.ip, user_agent="python-requests/2.32.3")
    step(f"Logging in as {args.staff} with a stolen password from {args.ip} (new device {attacker.headers['X-Device-Id']})")
    result = staff_login(attacker, seed, args.staff, has_otp=False)
    if result.get("mfa_required"):
        blocked("MFA required for a new device - prevention stopped the attack (run preset vulnerable to test detection)")
        return
    if "error" in result:
        blocked(f"login failed: {result['error']}")
        return
    ok(f"Logged in: {result['staff']['role_label']} at {result['staff']['home_property']}, on shift: {result['staff']['on_shift']}")

    started, records, page, properties = time.time(), 0, 1, set()
    while time.time() - started < args.max_seconds:
        r = attacker.get("/reservations", params={"page": page, "page_size": args.page_size, "sort": "arrival_desc"})
        if r.status_code in (401, 403):
            body = r.json()
            code = body.get("error") or detail(r).get("code") or detail(r).get("reason")
            if r.status_code == 403 and code not in ("ACCOUNT_LOCKED", "IP_BLOCKED"):
                blocked(f"page {page} refused by a prevention control: {detail(r).get('reason')}")
                return
            contained(f"{r.status_code} {code} after {records:,} records in {time.time() - started:.0f}s "
                      f"({len(properties)} properties): {body.get('message') or detail(r).get('reason')}")
            return
        r.raise_for_status()
        data = r.json()
        items = data["items"]
        records += len(items)
        properties.update(i["property_id"] for i in items)
        for item in items[:2]:
            attacker.get(f"/reservations/{item['id']}")
        if page % 5 == 1:
            ok(f"page {page}: {records:,} records so far across {sorted(properties)} (total available {data['total']:,})")
        page = page + 1 if page * args.page_size < data["total"] else 1
        time.sleep(args.delay)
    warn(f"NOT contained after {args.max_seconds}s: {records:,} records harvested")


if __name__ == "__main__":
    main()
