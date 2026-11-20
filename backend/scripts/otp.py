"""Print the current TOTP code for a staff member (demo convenience).

Usage:
    python -m scripts.otp rm_west_01                                         (from backend/, reads the local DB)
    python backend/scripts/otp.py --seed backend/data/seed_output.cloud.json admin_01   (cloud: reads the seed file)
"""

import json
import sys
import time

import pyotp


def secret_from_seed(path: str, staff_id: str) -> str | None:
    with open(path, encoding="utf-8") as fh:
        staff = {s["id"]: s for s in json.load(fh)["staff"]}
    return staff.get(staff_id, {}).get("mfa_secret")


def secret_from_db(staff_id: str) -> str | None:
    from app.db import SessionLocal  # imported lazily so --seed mode works without the app package
    from app.models import Staff

    with SessionLocal() as db:
        staff = db.get(Staff, staff_id)
        return staff.mfa_secret if staff else None


def main():
    args = sys.argv[1:]
    seed = None
    if len(args) >= 2 and args[0] == "--seed":
        seed, args = args[1], args[2:]
    if len(args) != 1:
        print(__doc__)
        raise SystemExit(2)
    secret = secret_from_seed(seed, args[0]) if seed else secret_from_db(args[0])
    if not secret:
        print("unknown staff id or MFA not configured")
        raise SystemExit(1)
    print(f"{pyotp.TOTP(secret).now()}  (valid {30 - int(time.time()) % 30}s)")


if __name__ == "__main__":
    main()
