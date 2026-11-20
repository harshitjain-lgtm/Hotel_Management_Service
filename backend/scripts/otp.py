"""Print the current TOTP code for a staff member (demo convenience; reads the secret from the DB).

Usage (from backend/):  python -m scripts.otp rm_west_01
"""

import sys

import pyotp

from app.db import SessionLocal
from app.models import Staff


def main():
    if len(sys.argv) != 2:
        print("usage: python -m scripts.otp <staff_id>")
        raise SystemExit(2)
    with SessionLocal() as db:
        staff = db.get(Staff, sys.argv[1])
        if staff is None or not staff.mfa_secret:
            print("unknown staff id or MFA not configured")
            raise SystemExit(1)
        print(pyotp.TOTP(staff.mfa_secret).now())


if __name__ == "__main__":
    main()
