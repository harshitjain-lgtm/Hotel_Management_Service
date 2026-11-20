"""Demo control panel.

Toggles and resets use the service API; `action` sends a signed request to the STAYSEC action endpoint
exactly as STAYSEC does (contract v1.0, section 6), which is handy for testing without the monitoring stack.

Usage:
    python scenarios/demo_control.py preset secure       # all controls ON
    python scenarios/demo_control.py preset vulnerable   # realistic misconfigurations for the attack demo
    python scenarios/demo_control.py status
    python scenarios/demo_control.py contain rm_west_01  # suspend + end sessions (manual containment)
    python scenarios/demo_control.py reinstate rm_west_01
    python scenarios/demo_control.py unfreeze AR2001234 [AR...]

    python scenarios/demo_control.py action PING
    python scenarios/demo_control.py action REVOKE_USER_SESSIONS user_id=rm_west_01
    python scenarios/demo_control.py action LOCK_USER user_id=rm_west_01 duration_minutes=30
    python scenarios/demo_control.py action BLOCK_IP ip=185.220.101.47 duration_minutes=60
    python scenarios/demo_control.py action SET_DATA_MASKING user_id=rm_west_01 mode=MASKED
    python scenarios/demo_control.py action SET_SECURITY_CONTROL control=export_step_up enabled=true
    (add dry_run=true to validate without changing anything)
"""

import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone

import httpx

from common import DEFAULT_BASE, SERVICE_KEY, ok, step, warn

SIGNING_SECRET = os.environ.get("STAYSEC_SIGNING_SECRET", "dev-staysec-signing-secret")
KEY_ID = os.environ.get("STAYSEC_KEY_ID", "staysec-1")
TARGET_KEYS = {"session_id", "user_id", "ip", "partner_id", "account_ids", "guest_refs"}

ALL_CONTROLS = ("property_scope", "new_device_mfa", "export_step_up", "pii_masking", "refund_dual_approval",
                "loyalty_cooling_off", "ota_field_allowlist", "card_number_scrubbing")
PRESETS = {
    "secure": {key: True for key in ALL_CONTROLS},
    # Plausible real-world gaps: scope checks off "during a PMS migration", MFA and export step-up off after
    # staff complaints, masking off "for faster check-in", partner allowlist off during an integration change.
    # (STAYSEC's own attack script logs in as a front-desk user and pages across ALL properties, which needs
    # property_scope OFF.)
    "vulnerable": {key: False for key in ALL_CONTROLS},
}


def api() -> httpx.Client:
    return httpx.Client(base_url=DEFAULT_BASE, headers={"X-Service-Key": SERVICE_KEY, "X-Service-Name": "demo-control"},
                        timeout=30)


def _value(raw: str):
    if raw.lower() in ("true", "false"):
        return raw.lower() == "true"
    if raw.isdigit():
        return int(raw)
    if "," in raw:
        return raw.split(",")
    return raw


def send_action(action: str, pairs: list[str]) -> dict:
    target, params, dry_run = {}, {}, False
    for pair in pairs:
        key, _, raw = pair.partition("=")
        value = _value(raw)
        if key == "dry_run":
            dry_run = bool(value)
        elif key in TARGET_KEYS:
            target[key] = value if key not in ("account_ids", "guest_refs") or isinstance(value, list) else [value]
        else:
            params[key] = value
    body = json.dumps({
        "action_id": "act_" + uuid.uuid4().hex, "action": action, "target": target, "params": params,
        "reason": {"code": "MANUAL_TEST", "risk_score": 0, "incident_id": None, "message": "demo_control.py"},
        "requested_by": "soc:demo-control",
        "requested_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "dry_run": dry_run,
    }).encode()
    ts = str(int(time.time()))
    signature = "v1=" + hmac.new(SIGNING_SECRET.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    response = httpx.post(f"{DEFAULT_BASE}/internal/security/actions", content=body, timeout=10, headers={
        "Content-Type": "application/json", "X-Staysec-Key-Id": KEY_ID, "X-Staysec-Timestamp": ts,
        "X-Staysec-Signature": signature, "Idempotency-Key": json.loads(body)["action_id"]})
    return {"http_status": response.status_code, **response.json()}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd, args = sys.argv[1], sys.argv[2:]
    c = api()
    if cmd == "preset":
        for key, enabled in PRESETS[args[0]].items():
            c.put(f"/control/policies/{key}", json={"enabled": enabled, "reason": f"demo preset {args[0]}"}).raise_for_status()
        ok(f"preset '{args[0]}' applied")
        cmd = "status"
    if cmd == "status":
        for p in c.get("/context/policies").json()["items"]:
            (ok if p["enabled"] else warn)(f"{p['key']:<24} {'ON ' if p['enabled'] else 'OFF'}  {p['title']}")
    elif cmd == "contain":
        step(f"containing {args[0]}")
        ok(str(c.post(f"/control/staff/{args[0]}/suspend", json={"reason": "manual containment (demo)"}).json()))
    elif cmd == "reinstate":
        ok(str(c.post(f"/control/staff/{args[0]}/reinstate", json={"reason": "demo reset"}).json()))
        ok(str(send_action("UNLOCK_USER", [f"user_id={args[0]}"])))
    elif cmd == "unfreeze":
        ok(str(c.post("/control/loyalty/unfreeze", json={"account_ids": args, "reason": "demo reset"}).json()))
    elif cmd == "action":
        result = send_action(args[0].upper(), args[1:])
        (ok if result.get("status") in ("APPLIED", "ALREADY_APPLIED") else warn)(json.dumps(result))
    elif cmd != "preset":
        print(__doc__)


if __name__ == "__main__":
    main()
