"""Scenario 3: payment workflow abuse - refunds to a new card by a front-desk insider.

A front-desk agent issues several refunds on already-checked-out reservations to a card that was
never used for payment (the insider's own card).

Control that stops it: refund_dual_approval (refunds stay pending until a different manager approves).
"""

import random

from common import base_args, blocked, detail, load_seed, make_client, ok, staff_login, step, warn

INSIDER_CARD = "4000 0566 5566 5556"  # payment-network test card number


def main():
    parser = base_args(__doc__)
    parser.add_argument("--staff", default=None)
    parser.add_argument("--count", type=int, default=5)
    args = parser.parse_args()
    seed = load_seed(args.seed)
    staff_id = args.staff or seed["demo_targets"]["refund_insider_staff"]
    staff = next(s for s in seed["staff"] if s["id"] == staff_id)

    insider = make_client(args.base, device_id=staff["known_device_id"], ip="10.20.4.21")
    step(f"Insider {staff_id} logs in from their usual front-desk PC")
    staff_login(insider, seed, staff_id)
    ok("logged in")

    r = insider.get("/reservations", params={"status": "checked_out", "property": staff["home_property"],
                                             "page_size": 60, "sort": "amount_desc"})
    candidates = r.json()["items"]
    rng = random.Random(11)
    done = 0
    for res in candidates:
        if done >= args.count:
            break
        folio = insider.get(f"/reservations/{res['id']}/folio").json()
        refundable = folio["totals"]["paid"] - folio["totals"]["refunded"] - folio["totals"]["pending_refunds"]
        if refundable < 2000:
            continue
        amount = round(min(refundable, rng.uniform(2000, 8000)), 2)
        r = insider.post(f"/reservations/{res['id']}/refunds",
                         json={"amount": amount, "reason": "Guest complaint - goodwill", "card_number": INSIDER_CARD})
        if r.status_code != 200:
            blocked(f"{res['id']}: {detail(r).get('reason')}")
            continue
        item = r.json()
        done += 1
        if item["status"] == "pending_approval":
            blocked(f"{res['id']}: INR {amount:,.2f} refund held for second approval (refund_dual_approval)")
        else:
            warn(f"{res['id']}: INR {amount:,.2f} refunded to {item['description']} - no approval needed")
    ok(f"{done} refund attempts made")


if __name__ == "__main__":
    main()
