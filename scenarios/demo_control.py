"""Demo control panel (uses the service API, same as the monitoring platform would).

Usage:
    python scenarios/demo_control.py preset secure       # all controls ON
    python scenarios/demo_control.py preset vulnerable   # realistic misconfigurations ON for the attack demo
    python scenarios/demo_control.py status
    python scenarios/demo_control.py contain rm_west_01  # revoke sessions + suspend (manual containment)
    python scenarios/demo_control.py reinstate rm_west_01
    python scenarios/demo_control.py unfreeze AR2001234 [AR...]
"""

import sys

import httpx

from common import DEFAULT_BASE, SERVICE_KEY, ok, step, warn

PRESETS = {
    "secure": {key: True for key in (
        "property_scope", "new_device_mfa", "export_step_up", "pii_masking", "refund_dual_approval",
        "loyalty_cooling_off", "ota_field_allowlist", "card_number_scrubbing")},
    # The gaps a hotel plausibly has: MFA and export step-up switched off after staff complaints,
    # masking off "for faster check-in", partner allowlist off during an integration migration, etc.
    "vulnerable": {
        "property_scope": True, "new_device_mfa": False, "export_step_up": False, "pii_masking": False,
        "refund_dual_approval": False, "loyalty_cooling_off": False, "ota_field_allowlist": False,
        "card_number_scrubbing": False,
    },
}


def api() -> httpx.Client:
    return httpx.Client(base_url=DEFAULT_BASE, headers={"X-Service-Key": SERVICE_KEY, "X-Service-Name": "demo-control"},
                        timeout=30)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd, args = sys.argv[1], sys.argv[2:]
    c = api()
    if cmd == "preset":
        preset = PRESETS[args[0]]
        for key, enabled in preset.items():
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
    elif cmd == "unfreeze":
        ok(str(c.post("/control/loyalty/unfreeze", json={"account_ids": args, "reason": "demo reset"}).json()))
    elif cmd != "preset":
        print(__doc__)


if __name__ == "__main__":
    main()
