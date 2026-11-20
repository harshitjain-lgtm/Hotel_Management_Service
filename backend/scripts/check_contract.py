"""Conformance check against the STAYSEC x HMS integration contract v1.0 (handoff section 8).

Runs against a live StayDesk API with EVENT_FORMAT=v1 and the `file` sink enabled (the default),
reading the events it publishes from EVENT_FILE.

Usage (from backend/, API running on :8000):
    python -m scripts.check_contract
"""

import hashlib
import hmac
import json
import time
import uuid
from pathlib import Path

import httpx
import pyotp

from app.config import get_settings
from app.contract_v1 import guest_ref
from app.db import SessionLocal
from app.models import Guest
from app.security import decrypt_str

BASE = "http://127.0.0.1:8000"
settings = get_settings()
seed = json.loads(Path("data/seed_output.json").read_text(encoding="utf-8"))
events_path = Path(settings.event_file)
results: list[tuple[bool, str, str]] = []


def check(ok: bool, label: str, extra: str = "") -> bool:
    results.append((ok, label, extra))
    print(("PASS " if ok else "FAIL ") + label + (f"  ({extra})" if extra else ""), flush=True)
    return ok


def events() -> list[dict]:
    if not events_path.is_file():
        return []
    return [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]


def wait_for(predicate, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = [e for e in events() if predicate(e)]
        if found:
            return found
        time.sleep(0.5)
    return []


def signed(body: dict, *, secret=None, ts=None) -> httpx.Response:
    raw = json.dumps(body).encode()
    ts = str(ts if ts is not None else int(time.time()))
    sig = "v1=" + hmac.new((secret or settings.staysec_signing_secret).encode(), ts.encode() + b"." + raw,
                           hashlib.sha256).hexdigest()
    return httpx.post(f"{BASE}/internal/security/actions", content=raw, timeout=10, headers={
        "Content-Type": "application/json", "X-Staysec-Key-Id": settings.staysec_key_id,
        "X-Staysec-Timestamp": ts, "X-Staysec-Signature": sig})


def action(name: str, target: dict | None = None, params: dict | None = None, action_id: str | None = None,
           **extra) -> httpx.Response:
    return signed({"action_id": action_id or f"act_{uuid.uuid4().hex}", "action": name, "target": target or {},
                   "params": params or {}, "reason": {"code": "TEST", "message": "contract check"},
                   "requested_by": "soc:contract-check", **extra})


def staff_client(staff_id: str, *, ip: str, device: str | None = None) -> tuple[httpx.Client, dict]:
    staff = next(s for s in seed["staff"] if s["id"] == staff_id)
    c = httpx.Client(base_url=BASE, timeout=30, headers={
        "X-Device-Id": device or staff["known_device_id"], "X-Forwarded-For": ip, "User-Agent": "contract-check/1.0"})
    body = c.post("/auth/login", json={"username": staff_id, "password": seed["staff_password"]}).json()
    if body.get("mfa_required"):
        body = c.post("/auth/mfa", json={"challenge_token": body["challenge_token"],
                                         "code": pyotp.TOTP(staff["mfa_secret"]).now()}).json()
    if "access_token" in body:
        c.headers["Authorization"] = f"Bearer {body['access_token']}"
    return c, body


def main():
    print(f"events file: {events_path}  format: {settings.event_format}")
    # 1. heartbeat + reference data
    hb = wait_for(lambda e: e.get("event_type") == "system.heartbeat", timeout=65)
    check(bool(hb), "system.heartbeat published within 60 s of start", f"backlog={hb[0]['data'] if hb else None}")
    evs = events()
    types = {e.get("event_type") for e in evs}
    check({"reference.staff", "reference.property", "reference.field_catalog"} <= types, "reference.* sent at startup")
    staff_refs = [e for e in evs if e.get("event_type") == "reference.staff"]
    check(any(e["data"].get("shift", {}) and e["data"].get("assigned_property_ids") for e in staff_refs),
          "reference.staff carries shifts and assigned_property_ids", f"{len(staff_refs)} staff refs")

    # 2. data.access with required fields + guest_ref correctness
    fd, _ = staff_client("fd_goa_01", ip="10.20.1.15")
    page = fd.get("/reservations", params={"page_size": 25, "page": 2}).json()
    first_guest = page["items"][0]["guest"]["id"]
    da = wait_for(lambda e: e.get("event_type") == "data.access" and e["actor"].get("user_id") == "fd_goa_01")
    if check(bool(da), "data.access emitted for a reservations list"):
        d = da[-1]["data"]
        check(all(k in d for k in ("record_count", "guest_refs", "property_ids", "fields_returned")),
              "data.access has record_count, guest_refs, property_ids, fields_returned",
              f"count={d.get('record_count')} page={d.get('page')} total={d.get('total_available')}")
        check(guest_ref(first_guest) in d["guest_refs"], "guest_refs = h_ + HMAC_SHA256(key, guest_id)[:32]")
        check(all(r.startswith("h_") and len(r) == 34 for r in d["guest_refs"]), "guest_ref format")
        env = da[-1]
        check(all(k in env for k in ("schema_version", "event_id", "event_type", "occurred_at", "producer", "actor",
                                     "session", "client", "request")) and env["occurred_at"].endswith("Z"),
              "envelope blocks + occurred_at UTC 'Z'", env["request"].get("route"))

    # 3. failed logins and denials
    httpx.post(f"{BASE}/auth/login", json={"username": "no_such_user", "password": "x"}, headers={"X-Forwarded-For": "198.51.100.9"})
    httpx.post(f"{BASE}/auth/login", json={"username": "fd_mum_01", "password": "wrong"}, headers={"X-Forwarded-For": "198.51.100.9"})
    failed = wait_for(lambda e: e.get("event_type") == "auth.login.failed" and e["client"].get("ip") == "198.51.100.9")
    reasons = {e["data"]["failure_reason"] for e in failed}
    check({"UNKNOWN_USER", "BAD_PASSWORD"} <= reasons, "auth.login.failed with failure_reason", str(sorted(reasons)))
    check(not any("no_such_user" in json.dumps(e) for e in failed), "unknown username is never sent")
    r = fd.get("/reservations", params={"property": "MUM"})
    denied = wait_for(lambda e: e.get("event_type") == "access.denied" and e["data"].get("user_id") == "fd_goa_01")
    check(r.status_code == 403 and bool(denied), "403 emits access.denied", denied[-1]["data"].get("reason") if denied else "")

    # 4. action endpoint: signatures, PING, idempotency
    check(httpx.post(f"{BASE}/internal/security/actions", json={"action_id": "a", "action": "PING"}).status_code == 401,
          "unsigned action rejected with 401")
    check(signed({"action_id": "act_stale", "action": "PING"}, ts=int(time.time()) - 900).status_code == 401,
          "stale timestamp rejected with 401")
    check(signed({"action_id": "act_bad", "action": "PING"}, secret="wrong").status_code == 401, "bad signature rejected")
    r = action("PING")
    check(r.status_code == 200 and r.json()["status"] == "APPLIED", "PING returns 200 APPLIED")
    r = httpx.post(f"{BASE}/internal/security/actions", content=b"{not json", headers={
        "X-Staysec-Timestamp": str(int(time.time())), "X-Staysec-Signature": "v1=" + hmac.new(
            settings.staysec_signing_secret.encode(), str(int(time.time())).encode() + b".{not json", hashlib.sha256).hexdigest()})
    check(r.status_code == 400, "malformed body returns 400")
    check(action("SELF_DESTRUCT").json()["status"] == "UNSUPPORTED", "unknown action -> UNSUPPORTED")

    # 5. REVOKE_SESSION on the very next request
    pm, login = staff_client("pm_goa_01", ip="10.20.2.20")
    pm.get("/reservations", params={"page_size": 5})
    session_id = pm.get("/auth/me").json()["session"]["id"]
    aid = f"act_{uuid.uuid4().hex}"
    r1 = action("REVOKE_SESSION", {"session_id": session_id, "user_id": "pm_goa_01"}, action_id=aid)
    check(r1.json()["status"] == "APPLIED" and r1.json()["details"]["sessions_terminated"] == 1, "REVOKE_SESSION applied")
    r = pm.get("/reservations")
    check(r.status_code == 401 and r.json().get("error") == "SESSION_REVOKED", "revoked session gets 401 SESSION_REVOKED",
          r.json().get("message"))
    r2 = action("REVOKE_SESSION", {"session_id": session_id, "user_id": "pm_goa_01"}, action_id=aid)
    check(r2.json()["status"] == "ALREADY_APPLIED" and r2.json()["action_id"] == aid,
          "same action_id twice: applied once, answered consistently")
    term = wait_for(lambda e: e.get("event_type") == "session.terminated" and e["session"]["session_id"] == session_id)
    check(bool(term) and term[-1]["data"].get("staysec_action_id") == aid, "session.terminated with STAYSEC_ACTION + action id")
    den = wait_for(lambda e: e.get("event_type") == "access.denied" and e["data"].get("reason") == "SESSION_REVOKED"
                   and e["data"].get("staysec_action_id") == aid)
    check(bool(den), "access.denied SESSION_REVOKED carries staysec_action_id")

    # 6. LOCK_USER blocks new logins
    r = action("LOCK_USER", {"user_id": "fin_goa_01"}, {"duration_minutes": 10})
    check(r.json()["status"] == "APPLIED", "LOCK_USER applied", str(r.json()["details"]))
    resp = httpx.post(f"{BASE}/auth/login", json={"username": "fin_goa_01", "password": seed["staff_password"]},
                      headers={"X-Device-Id": "dev-fin_goa_01-desk"})
    check(resp.status_code == 403 and resp.json().get("error") == "ACCOUNT_LOCKED", "locked user login -> 403 ACCOUNT_LOCKED")
    locked = wait_for(lambda e: e.get("event_type") == "auth.login.failed" and e["data"].get("failure_reason") == "ACCOUNT_LOCKED")
    check(bool(locked), "auth.login.failed ACCOUNT_LOCKED published")
    action("UNLOCK_USER", {"user_id": "fin_goa_01"})

    # 7. BLOCK_IP
    action("BLOCK_IP", {"ip": "203.0.113.77"}, {"duration_minutes": 5})
    resp = httpx.get(f"{BASE}/reservations", headers={"X-Forwarded-For": "203.0.113.77"})
    check(resp.status_code == 403 and resp.json().get("error") == "IP_BLOCKED", "blocked IP -> 403 IP_BLOCKED")
    check(bool(wait_for(lambda e: e.get("event_type") == "access.denied" and e["data"].get("reason") == "IP_BLOCKED")),
          "access.denied IP_BLOCKED published")
    action("UNBLOCK_IP", {"ip": "203.0.113.77"})

    # 8. SET_DATA_MASKING
    action("SET_SECURITY_CONTROL", params={"control": "pii_masking", "enabled": False})
    fd2, _ = staff_client("fd_goa_02", ip="10.20.1.16")
    unmasked = fd2.get("/reservations", params={"page_size": 1}).json()["items"][0]["guest"]["phone"]
    action("SET_DATA_MASKING", {"user_id": "fd_goa_02"}, {"mode": "MASKED"})
    masked = fd2.get("/reservations", params={"page_size": 1}).json()["items"][0]["guest"]["phone"]
    check("*" not in unmasked and "*" in masked, "SET_DATA_MASKING masks the user's responses", f"{unmasked} -> {masked}")
    action("SET_SECURITY_CONTROL", params={"control": "pii_masking", "enabled": True})

    # 9. no PII values anywhere in published events
    time.sleep(2)
    blob = events_path.read_text(encoding="utf-8")
    with SessionLocal() as db:
        sample = db.query(Guest).filter(Guest.passport_no_enc.isnot(None)).limit(400).all()
        leaks = [g.id for g in sample if g.email in blob or g.phone in blob or f"{g.first_name} {g.last_name}" in blob
                 or (decrypt_str(g.passport_no_enc) or "~~") in blob]
    check(not leaks, "no guest names/phones/emails/passport numbers in events", f"checked {len(sample)} guests")
    check('"G1' not in blob, "no raw internal guest IDs in events (only guest_refs)")

    passed = sum(1 for ok, *_ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
