"""Real-browser end-to-end check of the deployed StayDesk app (headless browser, no screenshots).

Logs in as admin_01 with MFA, opens reservations, a reservation detail, the Policy Center, guests and the guest
portal, and fails on any failed API call or browser error.

Setup (once):  pip install playwright pyotp      (uses installed Microsoft Edge; or: playwright install chromium
               and set E2E_CHANNEL=chromium)
Run:           python infra/e2e_check.py backend/data/seed_output.cloud.json
               (fetch that file first with: bash infra/ops.sh seed-output)
"""
import json
import os
import re
import sys

import pyotp
from playwright.sync_api import sync_playwright

URL = os.environ.get("STAYDESK_URL", "https://d8retztu3ojgt.cloudfront.net").rstrip("/")
seed = json.load(open(sys.argv[1], encoding="utf-8"))
staff = {s["id"]: s for s in seed["staff"]}
results, problems, api_calls = [], [], []


def check(ok, label, extra=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + label + (f"  ({extra})" if extra else ""), flush=True)


with sync_playwright() as p:
    channel = os.environ.get("E2E_CHANNEL", "msedge")
    browser = p.chromium.launch(channel=None if channel == "chromium" else channel, headless=True)
    page = browser.new_context().new_page()
    page.on("console", lambda m: problems.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
    # ERR_ABORTED = request cancelled because the test navigated away; not an application failure.
    page.on("requestfailed", lambda r: None if "ERR_ABORTED" in (r.failure or "") else problems.append(f"request failed: {r.url} ({r.failure})"))
    page.on("response", lambda r: api_calls.append((r.status, r.request.method, r.url.replace(URL, ""))) if "/api/" in r.url else None)

    page.goto(URL + "/login", wait_until="networkidle")
    check(page.get_by_text("Staff sign in").is_visible(), "login page renders")

    page.get_by_placeholder("e.g. fd_goa_01").fill("admin_01")
    page.locator('input[type="password"]').fill(seed["staff_password"])
    page.locator('button[type="submit"]').click()
    page.get_by_text("Verify it's you").wait_for(timeout=15000)
    check(True, "password accepted, MFA step shown (new device)")

    page.get_by_placeholder("••••••").fill(pyotp.TOTP(staff["admin_01"]["mfa_secret"]).now())
    page.locator('button[type="submit"]').click()
    page.wait_for_selector("table tbody tr", timeout=20000)
    rows = page.locator("table tbody tr").count()
    check(rows > 0, "logged in and reservations table loaded", f"{rows} rows, url={page.url.replace(URL, '')}")

    is_detail = lambda r: r.request.method == "GET" and re.search(r"/api/reservations/STY-[A-Z0-9]+$", r.url.split("?")[0])
    with page.expect_response(is_detail, timeout=20000) as detail:
        page.locator('table tbody a[href^="/reservations/"]').first.click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)  # let the page's follow-up requests (folio etc.) finish before navigating away
    check(detail.value.status == 200 and "/reservations/STY-" in page.url, "reservation detail opens and loads its data",
          page.url.replace(URL, ""))

    page.goto(URL + "/admin", wait_until="networkidle")
    page.wait_for_timeout(1500)
    check(page.get_by_text("Property-scoped access").first.is_visible(), "Policy Center loads with controls")

    page.goto(URL + "/guests", wait_until="networkidle")
    page.wait_for_selector("table tbody tr", timeout=15000)
    check(page.locator("table tbody tr").count() > 0, "guests list loads")

    page.reload(wait_until="networkidle")
    page.wait_for_selector("table tbody tr", timeout=15000)
    check(True, "session survives a page reload (deep link /guests)")

    page.goto(URL + "/portal", wait_until="networkidle")
    check(page.locator("input").count() > 0, "guest portal page renders")
    browser.close()

bad = [c for c in api_calls if c[0] >= 400]
check(not bad, "no failed API responses", f"{len(api_calls)} API calls" + (f"; failures: {bad[:5]}" if bad else ""))
check(not problems, "no browser errors (console / page / network)", "; ".join(problems[:5]))
print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
