# StayDesk: Hotel Management Service (HM)

StayDesk is the hotel-management half of **STAYSEC AI** (AI FORGE 2026, Team 08). It is a small property-management
system for a fictional 3-property chain, **Aranya Hotels** (Mumbai, Goa, Jaipur). It is **secure by design**, and
every security control can be toggled to demonstrate what happens before, during and after an attack.

It does two jobs:
1. **Prevention:** backend-enforced controls (the *Policy Center*) for the five priority risks in the problem statement.
2. **Telemetry:** a security event for every sensitive action, **including reads**, with *who / which property /
   on shift or not / which device / how many records / which PII fields*. Events are published in near real time to
   the STAYSEC monitoring platform, which owns detection, dashboards, reports and Slack alerts. They follow the
   **STAYSEC x HMS integration contract v1.0** (SQS + signed action endpoint); see [`docs/events.md`](docs/events.md).

```
React UI ──► StayDesk API (FastAPI) ──► PostgreSQL (RDS)
                 │  every request: auth → RBAC → policy checks → audit event (same DB transaction)
                 │
                 ├── event_outbox ──(shipper ~1s, v1.0 envelope)──► SQS staysec-hms-events ──► STAYSEC
                 │                    └── system.heartbeat every 30 s; reference.* at startup
                 ├── POST /internal/security/actions ◄── STAYSEC (HMAC-signed, idempotent): revoke, lock, block IP, mask…
                 └── /context/* · /control/*  ◄── extended APIs (blast-radius counts, demo tooling)
```

## Deployed environment

**https://d8retztu3ojgt.cloudfront.net**: AWS ap-south-1, behind CloudFront (CDN + TLS). The React app is on S3,
the API runs on ECS Fargate, the database is RDS PostgreSQL, and events go to STAYSEC's SQS queue. Architecture,
deploy/ops scripts, resource inventory and teardown are in [`infra/README.md`](infra/README.md).

## Repository layout

| Path | What |
|---|---|
| `backend/app/` | FastAPI service: models, policy engine, audit/outbox, routers |
| `backend/app/contract_v1.py` | Internal events → STAYSEC contract v1.0 envelope (guest_refs, field catalog, event types) |
| `backend/app/routers/security_actions.py` | STAYSEC action endpoint `POST /internal/security/actions` |
| `backend/scripts/check_contract.py` | 30-check conformance test against the handoff's checklist |
| `backend/scripts/seed.py` | Synthetic data: 10k guests, 25k reservations, loyalty, folios, ID docs, honeytokens |
| `frontend/` | React + Vite + TypeScript staff app and guest loyalty portal |
| `scenarios/` | Attack simulations, normal traffic generator, demo control |
| `docs/events.md` | STAYSEC integration: published events, extensions, action endpoint |
| `infra/` | AWS deploy and ops scripts, resource inventory, teardown |
| `backend/Dockerfile` | API image (seeds an empty database on first boot when `SEED_IF_EMPTY=true`) |
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
.venv/Scripts/python -m uvicorn app.main:app --port 8000
# API docs: http://127.0.0.1:8000/docs   (application API under /api, STAYSEC actions at /internal/security/actions)   (on Windows avoid --reload: orphaned reload workers can keep port 8000)
.venv/Scripts/python -m scripts.check_contract     # optional: STAYSEC contract conformance (30 checks)

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                                        # http://localhost:5173 (use localhost, not 127.0.0.1: CORS)
```

The staff app covers reservations (search, sort, export), reservation detail (reveal-with-reason, check-in with ID
upload, folio, payments, refunds), guests, loyalty, refund approvals and the admin **Policy Center**. Guest
loyalty portal: `/portal`. If security monitoring ends the session, the app logs out and shows a red
"terminated by security monitoring" banner. A blocked bulk export opens a step-up MFA prompt. The gear icon
in the header sets the demo clock.

### Demo accounts

**Local only:** all staff passwords are `StayDesk@2026`. The **deployed** environment uses private passwords
(`SEED_PASSWORD` / `SEED_GUEST_PASSWORD` in Secrets Manager); fetch them with `bash infra/ops.sh seed-output`. MFA secrets (and `otpauth://` URIs for an authenticator app) are in
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
Turning one OFF models a realistic misconfiguration. Every change is published as `security.control.changed`.

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
python scenarios/demo_control.py preset vulnerable   # realistic misconfigurations (all controls OFF)
python scenarios/s1_bulk_export.py                    # HEADLINE: compromised manager account bulk-exports guests
python scenarios/s2_loyalty_takeover.py               # credential stuffing → email change → points drained
python scenarios/s3_refund_fraud.py                   # insider refunds to a new card
python scenarios/s4_ota_oversharing.py                # OTA pulls fields beyond its contract
python scenarios/normal_traffic.py --any-shift        # realistic background activity (Ctrl+C to stop)
python scenarios/demo_control.py preset secure        # all controls ON → re-run: attacks are blocked
python scenarios/demo_control.py reinstate rm_west_01 # reset after a containment
```

`s1` keeps scraping guest profiles after the export until its session is revoked. When STAYSEC sends `REVOKE_SESSION`
(or you do: `python scenarios/demo_control.py action REVOKE_USER_SESSIONS user_id=rm_west_01`), the script prints
`[CONTAINED]` and the UI logs the user out with a "terminated by security monitoring" banner.

STAYSEC's own attack script logs in as a **front-desk user and pages reservations across all properties**, which needs
`property_scope` OFF (the `vulnerable` preset). Login: `POST /api/auth/login {"username","password"}` →
`{"access_token"}`; list: `GET /api/reservations?page=N&page_size=200` with `Authorization: Bearer <token>`.

All tools take `STAYDESK_URL` (service root, default `http://127.0.0.1:8000`) and `STAYDESK_SEED` (seed output file),
so they run against the deployed environment too. See `infra/README.md`.

For a clean slate between rehearsals, re-run the seed: `python -m scripts.seed --reset` in `backend/`.

## Integration with the monitoring platform

* **Events (contract v1.0):** set `EVENT_SINKS=sqs,file`, `SQS_QUEUE_URL`, `AWS_REGION` and the shared
  `GUEST_REF_KEY`. Locally (default `EVENT_SINKS=file`) the same v1 events go to `backend/data/events.jsonl`.
* **Action endpoint:** `POST /internal/security/actions`, verified with `STAYSEC_SIGNING_SECRET` / `STAYSEC_KEY_ID`.
  Supports every contract action plus `SET_SECURITY_CONTROL`, `FREEZE_LOYALTY` and `ROTATE_PARTNER_KEY`.
* **Context API** (`X-Service-Key` header): `GET /api/context/staff` (roles, scope, shift roster, known devices),
  `/api/context/properties`, `/api/context/partners`, `/api/context/policies`, and `POST /api/context/guests/classify` (blast radius: counts of
  passports, Aadhaar, minors, foreign nationals, loyalty points … for a list of guest IDs, never values).
* **Control API** (`X-Service-Key`): `POST /api/control/sessions/revoke`, `/api/control/staff/{id}/suspend|reinstate`,
  `/api/control/loyalty/freeze|unfreeze`, `/api/control/partners/{id}/rotate-key`, `PUT /api/control/policies/{key}`.
  Each accepts `reason`, `incident_id` and `approved_by`, all recorded in the resulting `control.*` event.
* **Baseline history:** `python -m scripts.generate_history --days 30` (in `backend/`) writes ~21k *normal* v1 events
  for the last 30 days to `backend/data/history_events.jsonl`, matching each staff member's real roster, so detection
  can learn per-user baselines before the live demo.
* **Honeytokens:** `backend/data/honeytokens.json` lists 5 decoy VIP guests: their guest IDs, loyalty accounts and
  **guest_refs** (what STAYSEC sees). No legitimate workflow should touch them, so any event containing them is high-confidence.

## Configuration

See `backend/.env.example`. Key settings: `DATABASE_URL`, `JWT_SECRET`, `PII_ENCRYPTION_KEY`, `EVENT_FORMAT`,
`EVENT_SINKS`, `SQS_QUEUE_URL`, `GUEST_REF_KEY`, `STAYSEC_SIGNING_SECRET`, `SERVICE_API_KEY`, `DEMO_MODE` (enables `X-Demo-Clock: HH:MM` to simulate the hotel's local time for
off-shift demos; event timestamps always use the real clock).

## AWS deployment

Live in ap-south-1. See [`infra/README.md`](infra/README.md). Stack: CloudFront → S3 (web) + ALB → ECS Fargate (API,
SQS publisher, heartbeat) → RDS PostgreSQL 16 (private, encrypted), with secrets in Secrets Manager and logs in CloudWatch.
App Runner (suggested in the build spec) was not used because it throttles CPU between requests, which would stall
the background SQS flush and heartbeat.
Events go to STAYSEC's SQS queue, published by the task role with `sqs:SendMessage`. The action endpoint is exposed
only to STAYSEC's egress IP, enforced by the security group or ALB rule.
