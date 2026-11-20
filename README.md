# StayDesk: Hotel Management Service (HM)

StayDesk is the hotel-management half of **STAYSEC AI** (AI FORGE 2026, Team 08). It is a small property-management
system for a fictional 3-property chain, **Aranya Hotels** (Mumbai, Goa, Jaipur). It is **secure by design**, and
every security control can be toggled to demonstrate what happens before, during and after an attack.

It does two jobs:
1. **Prevention:** backend-enforced controls (the *Policy Center*) for the five priority risks in the problem statement.
2. **Telemetry:** a security event for every sensitive action, **including reads**, with *who / which property /
   on shift or not / which device / how many records / which PII fields*. Events are pushed in near real time to the
   StaySec monitoring platform, which owns detection, dashboards, reports and Slack alerts.

```
React UI ──► StayDesk API (FastAPI) ──► PostgreSQL (RDS)
                 │  every request: auth → RBAC → policy checks → audit event (same DB transaction)
                 │
                 ├── event_outbox ──(shipper, ~1s)──► file / HTTP ingest ──► StaySec monitoring
                 ├── /context/*  ◄── StaySec reads business context (staff, shifts, partners, blast radius)
                 └── /control/*  ◄── StaySec response actions (revoke sessions, suspend, freeze, re-enable controls)
```

## Repository layout

| Path | What |
|---|---|
| `backend/app/` | FastAPI service: models, policy engine, audit/outbox, routers |
| `backend/scripts/seed.py` | Synthetic data: 10k guests, 25k reservations, loyalty, folios, ID docs, honeytokens |
| `frontend/` | React + Vite + TypeScript staff app and guest loyalty portal |
| `scenarios/` | Attack simulations, normal traffic generator, demo control |
| `docs/events.md` | Security event schema and catalog (for the monitoring team) |
| `docker-compose.yml` | Local PostgreSQL 16 |

## Quick start (local)

Prerequisites: Docker, Python 3.11+, Node 20+.

```bash
# 1. database
docker compose up -d

# 2. backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # macOS/Linux: .venv/bin/pip
cp .env.example .env                               # optional; defaults work locally
.venv/Scripts/python -m scripts.seed --reset       # ~30s; writes data/seed_output.json
.venv/Scripts/python -m uvicorn app.main:app --reload --reload-dir app --port 8000
# API docs: http://127.0.0.1:8000/docs

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                                        # http://localhost:5173
```

### Demo accounts

All staff passwords are `StayDesk@2026`. MFA secrets (and `otpauth://` URIs for an authenticator app) are in
`backend/data/seed_output.json`. That file is gitignored and regenerated on every seed. To get a current code quickly:
`.venv/Scripts/python -m scripts.otp <staff_id>`. Logging in from a staff member's registered device needs no MFA; a new
device does when `new_device_mfa` is ON.

| Staff ID | Role | Scope | Shift (IST) |
|---|---|---|---|
| `fd_mum_01..03`, `fd_goa_01..03`, `fd_jai_01..03` | Front desk | own property | 07-15 / 15-23 / 23-07 |
| `pm_mum_01`, `pm_goa_01`, `pm_jai_01` | Property manager | own property | 09-18 |
| `fin_mum_01`, `fin_goa_01`, `fin_jai_01` | Finance | own property | 09-18 |
| `rm_west_01` | Regional revenue manager (**headline demo target**) | all | 10-19 |
| `loy_desk_01` | Loyalty desk | all | 09-18 |
| `admin_01` | Corporate admin (Policy Center) | all | 09-18 |

The guest loyalty portal password is `Guest@2026` for every seeded loyalty account (email = guest email).

## Policy Center (security controls)

All controls are enforced **in the backend**, so scripts calling the API directly hit the same checks as the UI.
Turning one OFF models a realistic misconfiguration. Every change emits `admin.policy_changed` (or `control.policy_changed`).

| Control | ON | OFF (the gap) | Priority risk |
|---|---|---|---|
| `property_scope` | Staff see only their properties | Any account can query every property | Unauthorized booking access |
| `new_device_mfa` | Unknown device ⇒ TOTP required | Stolen password is enough | Account compromise |
| `export_step_up` | Export > 500 rows ⇒ fresh TOTP | Silent bulk export | Unauthorized booking access |
| `pii_masking` | Phone/email/passport masked; reveal needs a reason | Full passport numbers in lists & exports | Guest identity exposure |
| `refund_dual_approval` | Refund pending until a different user approves | One user refunds to any card | Compromised payment workflows |
| `loyalty_cooling_off` | No redemption/transfer for 24h after contact change | Hijacked account drained instantly | Loyalty-account misuse |
| `ota_field_allowlist` | OTA gets only contracted fields | OTA receives passport, DOB, phone | Excessive third-party sharing |
| `card_number_scrubbing` | Card numbers in notes detected (Luhn) and removed | Card numbers stored in plain text | Compromised payment workflows (PCI) |

Baseline protections that are always on: RBAC per role, bcrypt passwords, TOTP MFA, passport numbers encrypted at rest
(Fernet; KMS in AWS), only the last 4 digits of Aadhaar stored, card numbers tokenized (never stored), and every
action audited.

## Demo scenarios

Run from the repo root with the backend venv (`backend/.venv/Scripts/python` on Windows, `backend/.venv/bin/python` elsewhere):

```bash
python scenarios/demo_control.py preset vulnerable   # realistic misconfigurations
python scenarios/s1_bulk_export.py                    # HEADLINE: compromised manager account bulk-exports guests
python scenarios/s2_loyalty_takeover.py               # credential stuffing → email change → points drained
python scenarios/s3_refund_fraud.py                   # insider refunds to a new card
python scenarios/s4_ota_oversharing.py                # OTA pulls fields beyond its contract
python scenarios/normal_traffic.py --any-shift        # realistic background activity (Ctrl+C to stop)
python scenarios/demo_control.py preset secure        # all controls ON → re-run: attacks are blocked
python scenarios/demo_control.py reinstate rm_west_01 # reset after a containment
```

`s1` keeps scraping guest profiles after the export until its session is revoked. When StaySec (or
`demo_control.py contain rm_west_01`) calls the control API, the script prints `[CONTAINED]` and the UI logs the user out
with a "terminated by security monitoring" banner.

For a clean slate between rehearsals, re-run the seed: `python -m scripts.seed --reset` in `backend/`.

## Integration with the monitoring platform

* **Events:** see [`docs/events.md`](docs/events.md). Configure `EVENT_SINKS=file,http` plus `INGEST_URL`,
  `INGEST_API_KEY` and `INGEST_HMAC_SECRET`. Until the ingest endpoint exists, events are appended to `backend/data/events.jsonl`.
* **Context API** (`X-Service-Key` header): `GET /context/staff` (roles, scope, shift roster, known devices),
  `/context/properties`, `/context/partners`, `/context/policies`, and `POST /context/guests/classify` (blast radius: counts of
  passports, Aadhaar, minors, foreign nationals, loyalty points … for a list of guest IDs, never values).
* **Control API** (`X-Service-Key`): `POST /control/sessions/revoke`, `/control/staff/{id}/suspend|reinstate`,
  `/control/loyalty/freeze|unfreeze`, `/control/partners/{id}/rotate-key`, `PUT /control/policies/{key}`.
  Each accepts `reason`, `incident_id` and `approved_by`, all recorded in the resulting `control.*` event.
* **Baseline history:** `python -m scripts.generate_history --days 30` (in `backend/`) writes ~21k *normal* events for
  the last 30 days to `backend/data/history_events.jsonl`, in the same schema and with real seeded IDs, so detection can learn
  per-user baselines before the live demo.
* **Honeytokens:** `backend/data/honeytokens.json` lists 5 decoy VIP guests (and their loyalty accounts). No legitimate
  workflow should touch them, so any event containing those guest IDs is high-confidence.

## Configuration

See `backend/.env.example`. Key settings: `DATABASE_URL`, `JWT_SECRET`, `PII_ENCRYPTION_KEY`, `EVENT_SINKS`,
`INGEST_URL`, `SERVICE_API_KEY`, `DEMO_MODE` (enables `X-Demo-Clock: HH:MM` to simulate the hotel's local time for
off-shift demos; event timestamps always use the real clock).

## AWS deployment (planned)

API on ECS Fargate (or Lambda), **RDS PostgreSQL** (GuardDuty RDS Protection anomaly detection works on PostgreSQL),
Cognito for staff auth/MFA, S3 + KMS for ID documents, Secrets Manager for keys, and the React build on S3 + CloudFront.
Events go to the monitoring team's API Gateway `/ingest` endpoint, backed by SQS.
