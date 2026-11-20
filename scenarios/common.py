"""Shared helpers for demo scenarios (attack simulations and normal traffic).

Run scenarios with the backend virtualenv, e.g. from the repo root:
    backend/.venv/Scripts/python scenarios/s1_bulk_export.py          (Windows)
    backend/.venv/bin/python scenarios/s1_bulk_export.py              (macOS/Linux)
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path

import httpx
import pyotp

ROOT = Path(__file__).resolve().parent
# STAYDESK_SEED: seed output to use (e.g. backend/data/seed_output.cloud.json for the deployed environment)
DEFAULT_SEED = Path(os.environ.get("STAYDESK_SEED", ROOT.parent / "backend" / "data" / "seed_output.json"))
# STAYDESK_URL = service root (e.g. https://<id>.cloudfront.net); the application API lives under /api
DEFAULT_ROOT = os.environ.get("STAYDESK_URL", "http://127.0.0.1:8000").rstrip("/")
DEFAULT_BASE = os.environ.get("STAYDESK_API", DEFAULT_ROOT + "/api")
SERVICE_KEY = os.environ.get("STAYDESK_SERVICE_KEY", "dev-service-key")

ATTACKER_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
OFFICE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"

if os.name == "nt":
    os.system("")  # enable ANSI colours in Windows consoles

RED, GREEN, YELLOW, CYAN, BOLD, RESET = "\033[91m", "\033[92m", "\033[93m", "\033[96m", "\033[1m", "\033[0m"


def log(tag: str, message: str, colour: str = "") -> None:
    print(f"{datetime.now():%H:%M:%S} {colour}{tag:<11}{RESET} {message}", flush=True)


def step(message: str) -> None:
    log("[*]", message, CYAN)


def ok(message: str) -> None:
    log("[+]", message, GREEN)


def blocked(message: str) -> None:
    log("[BLOCKED]", message, YELLOW + BOLD)


def contained(message: str) -> None:
    log("[CONTAINED]", message, RED + BOLD)


def warn(message: str) -> None:
    log("[!]", message, RED)


def base_args(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--base", default=DEFAULT_BASE, help="StayDesk API base URL")
    parser.add_argument("--seed", default=str(DEFAULT_SEED), help="path to backend/data/seed_output.json")
    return parser


def load_seed(path: str) -> dict:
    p = Path(path)
    if not p.is_file():
        sys.exit(f"seed output not found at {p} - run `python -m scripts.seed --reset` in backend/ first")
    return json.loads(p.read_text(encoding="utf-8"))


def make_client(base: str, *, device_id: str | None = None, ip: str | None = None, user_agent: str = OFFICE_UA,
                demo_clock: str | None = None) -> httpx.Client:
    headers = {"X-Device-Id": device_id or f"dev-{uuid.uuid4().hex[:10]}", "User-Agent": user_agent}
    if ip:
        headers["X-Forwarded-For"] = ip
    if demo_clock:
        headers["X-Demo-Clock"] = demo_clock
    return httpx.Client(base_url=base, headers=headers, timeout=60)


def staff_login(client: httpx.Client, seed: dict, staff_id: str, *, has_otp: bool = True) -> dict:
    """Log in as a staff member. Returns the login response, or {'mfa_required': True} if MFA is needed but
    the caller has no OTP (i.e. an attacker holding only the password)."""
    response = client.post("/auth/login", json={"username": staff_id, "password": seed["staff_password"]})
    body = response.json()
    if response.status_code != 200:
        return {"error": body}
    if body.get("mfa_required"):
        if not has_otp:
            return body
        secret = next(s["mfa_secret"] for s in seed["staff"] if s["id"] == staff_id)
        response = client.post("/auth/mfa", json={"challenge_token": body["challenge_token"],
                                                  "code": pyotp.TOTP(secret).now()})
        body = response.json()
    client.headers["Authorization"] = f"Bearer {body['access_token']}"
    return body


def detail(response: httpx.Response) -> dict:
    try:
        return response.json().get("detail", {}) or {}
    except ValueError:
        return {}
