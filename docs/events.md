# StayDesk ↔ STAYSEC integration (contract v1.0)

StayDesk implements the **STAYSEC x HMS integration handoff, contract v1.0**:

1. **Events in:** every security-relevant action is published to the STAYSEC SQS queue (`staysec-hms-events`) in the
   v1.0 envelope. That includes logins, failures, guest-data reads with record counts, denials and changes.
2. **Actions out:** `POST /internal/security/actions` lets STAYSEC end sessions, lock users, block IPs and more,
   with HMAC-signed, idempotent requests.

Run `python -m scripts.check_contract` (in `backend/`, API running) to verify the section 8 conformance checklist.
It runs 30 checks.

## How events flow

```
request ─► auth → RBAC → policy checks → handler
                                   └─► internal audit event ─► event_outbox (same DB transaction as the action)
shipper thread (every ~1s) ─► app/contract_v1.py: internal event → v1.0 envelope ─► SQS SendMessageBatch (10/call)
                          └─► system.heartbeat every 30 s with queue_backlog
```

* **Asynchronous:** a user request never waits for SQS. The outbox is durable, so events survive restarts and SQS
  outages and are retried with the same `event_id` (at-least-once delivery).
* **Privacy:** guest IDs become `guest_refs = "h_" + HMAC_SHA256(GUEST_REF_KEY, guest_id)[:32]`. Responses are described
  by field **names** (`fields_returned`), never values. The unknown usernames in failed logins are never sent.
  The checker verifies no guest names, phones, emails, passport numbers or raw guest IDs appear in any event.
* **Config:** `EVENT_FORMAT=v1`, `EVENT_SINKS=sqs` (plus `file` for local replay), `SQS_QUEUE_URL`, `AWS_REGION`,
  `GUEST_REF_KEY`, `STAYSEC_SIGNING_SECRET`, `STAYSEC_KEY_ID`. See `backend/.env.example`.

## Event types published

| `event_type` | Published when | StayDesk source |
|---|---|---|
| `reference.property` | startup | 3 properties (MUM, GOA, JAI) |
| `reference.staff` | startup, and on any role/scope/status/lock change | every staff user, with `assigned_property_ids` and `shift` (start, end, timezone, days); OTA integrations as `role: INTEGRATION` service accounts |
| `reference.field_catalog` | startup | every field name we report, with its category (`IDENTITY_DOC`, `PAYMENT`, `CONTACT`, `STAY`, `LOYALTY`, `IDENTITY`) |
| `auth.login.succeeded` | staff login (and guest-portal login, `data.realm = "guest_portal"`) | |
| `auth.login.failed` | `BAD_PASSWORD`, `UNKNOWN_USER`, `ACCOUNT_LOCKED`, `MFA_FAILED`, `OTHER` | includes the MFA step (`data.stage = "mfa"`) and step-up MFA before bulk export (`"step_up"`) |
| `data.access` | every response returning guest, reservation, payment, loyalty or ID-document data | search/list, detail, **export**, PII reveal, ID-document download, folio, loyalty, OTA partner API pulls |
| `access.denied` | every 401/403 | `SESSION_REVOKED` (with `staysec_action_id`), `SESSION_EXPIRED`, `ACCOUNT_LOCKED`, `IP_BLOCKED`, `UNAUTHENTICATED`, `FORBIDDEN` (RBAC, property scope, or a security control, named in `data.policy`) |
| `session.terminated` | a session ends other than by logout | `STAYSEC_ACTION` (with `staysec_action_id`), `ADMIN`, `PASSWORD_CHANGED` |
| `auth.logout` | logout | |
| `data.change` | create/update of reservations, ID documents, payments/refunds, loyalty points and contact details | `fields_changed` plus safe extras in `data.details` (e.g. `refund_to_new_instrument`, `points`, `new_domain`) |
| `security.action.applied` | after applying a STAYSEC action | action, status, applied_at, details |
| `system.heartbeat` | every 30 s | `queue_backlog` = unsent outbox events |
| `security.control.changed` *(extension)* | a security control in the Policy Center is turned on/off (admin UI, StaySec action, or demo tooling) | `control`, `enabled_before/after`, `control_disabled` |
| `security.control.triggered` *(extension)* | a control acted on its own (card numbers removed from free text) | `control`, `guest_refs` |

### Optional fields StayDesk adds (additive within 1.x)

* `actor.assigned_property_ids`, `actor.on_shift`, `actor.local_time`: our own roster check, so STAYSEC gets
  out-of-scope and off-shift signals directly.
* `client.device_known`: `false` until the device has passed MFA once.
* `data.distinct_guests`, `data.sort` (e.g. `loyalty_points_desc`, the Marriott-2020 tell), `data.masked_fields`,
  `data.export_bytes`, and `data.fields_beyond_contract` (OTA pulls that received fields outside their contract).
* On `access.denied`: `data.attempted_action`, `data.policy`, `data.message`, `data.requested_record_count`.

### Example: the headline attack's export

```json
{
  "schema_version": "1.0", "event_id": "622654b3-…", "event_type": "data.access",
  "occurred_at": "2026-11-20T10:21:08.446Z",
  "producer": {"system": "hms", "service": "staydesk-api", "instance": "hms-1", "environment": "dev"},
  "actor": {"user_id": "rm_west_01", "role": "REVENUE_MANAGER", "home_property_id": "MUM", "is_service_account": false,
            "assigned_property_ids": ["MUM", "GOA", "JAI"], "on_shift": false, "local_time": "03:12"},
  "session": {"session_id": "d3f51fea-…", "auth_method": "password", "mfa_verified": false, "issued_at": "2026-11-20T10:21:07.710Z"},
  "client": {"ip": "185.220.101.47", "user_agent": "Mozilla/5.0 (X11; Linux x86_64; …) Firefox/128.0",
             "device_id": "dev-b6e85b6812", "device_known": false},
  "request": {"request_id": "12eb86e5-…", "method": "POST", "route": "/reservations/export", "status_code": 200, "latency_ms": 405},
  "data": {"resource_type": "reservation", "operation": "export", "record_count": 4800,
           "guest_refs": ["h_dab1e81f98df66a4fb904eb877bb0491", "… 1,763 distinct (first 2,000 max)"],
           "property_ids": ["GOA", "JAI", "MUM"],
           "fields_returned": ["reservation_id", "guest_name", "phone", "email", "dob", "passport_no", "…"],
           "vip_record_count": 157, "export_format": "csv", "masked": false,
           "distinct_guests": 1763, "sort": "loyalty_points_desc", "export_bytes": 965083}
}
```

## Action endpoint

`POST /internal/security/actions`, implemented in `app/routers/security_actions.py`:

* Signature `v1=` + hex HMAC-SHA256 of `X-Staysec-Timestamp + "." + raw body`, verified over the raw bytes in
  constant time. Missing headers, a timestamp more than 300 s off, an unknown `X-Staysec-Key-Id` or a mismatch return **401**.
  A malformed body returns **400**.
* Idempotent on `action_id`, stored in `security_actions`. A repeat returns the original response with status
  `ALREADY_APPLIED`. `dry_run: true` validates and answers without changing anything.
* Always **200** once processed: `APPLIED`, `ALREADY_APPLIED`, `NOT_FOUND`, `UNSUPPORTED`, `REJECTED` or `FAILED`.
* The endpoint is exempt from IP blocking, so STAYSEC can always reach it. In AWS, restrict it to STAYSEC's
  egress IP with the load balancer or security group.

| `action` | `target` / `params` | Effect in StayDesk |
|---|---|---|
| `PING` | | `APPLIED` |
| `REVOKE_SESSION` | `session_id` | next request gets `401 {"error":"SESSION_REVOKED","message":"Your session was ended by hotel security."}`; `session.terminated` + `access.denied` published |
| `REVOKE_USER_SESSIONS` | `user_id` | all active sessions ended |
| `LOCK_USER` / `UNLOCK_USER` | `user_id`, `duration_minutes` (null = indefinite) | logins get `403 {"error":"ACCOUNT_LOCKED"}`; existing sessions ended |
| `BLOCK_IP` / `UNBLOCK_IP` | `ip`, `duration_minutes` | every request from that IP gets `403 {"error":"IP_BLOCKED"}` |
| `SET_DATA_MASKING` | `session_id` or `user_id`, `mode` `MASKED`/`FULL` | per-session or per-user override of the masking control |
| `FORCE_PASSWORD_RESET` | `user_id` | sessions ended; login refused until reset |
| `SET_SECURITY_CONTROL` *(extension)* | `params.control`, `params.enabled` | turns a Policy Center control on/off (post-incident hardening) |
| `FREEZE_LOYALTY` / `UNFREEZE_LOYALTY` *(extension)* | `target.guest_refs` or `target.account_ids` | blocks redemptions/transfers on affected loyalty accounts |
| `ROTATE_PARTNER_KEY` *(extension)* | `target.partner_id` | revokes an OTA's API key (new key delivered out of band) |

Test any action with signed requests from the command line, e.g.:
`python scenarios/demo_control.py action REVOKE_USER_SESSIONS user_id=rm_west_01`

## Blast radius after an incident

STAYSEC holds only `guest_refs`. StayDesk can recompute refs over its guest table:
`POST /context/guests/classify {"guest_refs": [...]}` (`X-Service-Key`) returns **counts only**: passports,
Aadhaar, minors, foreign nationals, loyalty members and points, card tokens, ID scans, and nationality breakdown.
The hotel uses the same mapping to build the DPDP Rule 7 notification list.
