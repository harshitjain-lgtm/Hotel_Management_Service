# StayDesk security events (schema v0.1)

StayDesk emits one event per security-relevant action, including **reads** (search, view, export) with record counts.
Events are written to a transactional outbox in the same DB transaction as the action, then shipped to the
configured sinks (`file`, `http`, `stdout`). Delivery is **at-least-once**, so de-duplicate on `event_id`.

> **Privacy by design:** events carry pseudonymous IDs (`G1004012`, `STY-…`, `AR2…`) and the *names* of the PII fields
> exposed. They never carry PII values. Use `POST /context/guests/classify` to turn guest IDs into blast-radius counts.

## Envelope

```jsonc
{
  "schema_version": "0.1",
  "event_id": "uuid",                       // de-duplication key
  "ts": "2026-11-20T09:59:14.511+00:00",    // UTC, real clock
  "source": {"system": "staydesk", "component": "hm-backend", "env": "dev"},
  "action": "reservation.export",           // see catalog below
  "category": "data_access",                // auth | data_access | pii | payment | loyalty | partner | admin | control
  "actor": {
    "type": "staff",                        // staff | guest | partner | service | anonymous
    "id": "rm_west_01",
    "role": "regional_manager",
    "home_property": "MUM",
    "property_scope": ["MUM", "GOA", "JAI"],
    "on_shift": false,                      // computed from the staff roster at the hotel's local time
    "local_time": "03:12",                  // hotel local time (IST); demo mode can simulate it via X-Demo-Clock
    "ip": "185.220.101.47",
    "device_id": "dev-3f4263d1a1",
    "device_known": false,                  // a device becomes known only after a successful MFA
    "user_agent": "Mozilla/5.0 …",
    "session_id": "uuid",
    "mfa_verified": false
  },
  "outcome": {"result": "allowed", "reason": "…", "policy": "export_step_up"},  // result: allowed | denied
  "resource": {
    "type": "reservation",
    "count": 4800,
    "ids": ["STY-035VJFA7", "…"],           // capped at 10,000 (then "ids_truncated": true)
    "guest_ids": ["G1004012", "…"],         // distinct
    "distinct_guests": 1740,
    "properties": ["GOA", "JAI", "MUM"],
    "pii_fields": ["name", "nationality", "phone", "email", "dob", "passport_no"],  // exposed in clear
    "masked_fields": ["aadhaar"],                                                  // returned masked
    "query": {"sort": "loyalty_points_desc", "limit": 4800},
    "…": "action-specific extras (total_matching, bytes, fields_beyond_contract, …)"
  },
  "details": {"…": "action-specific"},
  "request": {"request_id": "uuid", "method": "POST", "path": "/reservations/export"}
}
```

Denied actions are events too (`outcome.result = "denied"`, with `reason` and, when a control blocked it, `policy`).
Attempted attacks are signals in their own right.

## Catalog

| Action | Category | Emitted when | Useful fields |
|---|---|---|---|
| `auth.login_success` | auth | staff login completes | `details.mfa_verified`, `details.new_device`, actor ip/device/on_shift |
| `auth.login_failed` / `auth.login_blocked` | auth | bad password / suspended account | `actor.id` is the attempted username |
| `auth.new_device` | auth | login from a device not yet trusted | `details.device_id` |
| `auth.mfa_challenge` / `auth.mfa_success` / `auth.mfa_failed` | auth | new-device MFA flow | |
| `auth.step_up_success` / `auth.step_up_failed` | auth | step-up MFA before bulk export | |
| `auth.logout` | auth | staff logout | |
| `auth.session_rejected` | auth | request with a revoked/expired session or suspended account | `outcome.reason`; shows an attacker still trying after containment |
| `auth.guest_login_success` / `auth.guest_login_failed` | auth | guest loyalty-portal login | failed: `resource.attempted_email_domain` (credential-stuffing bursts) |
| `auth.guest_password_reset_requested` / `auth.guest_password_reset` | auth | portal password reset | |
| `reservation.search` | data_access | reservation list/search | `resource.count`, `query.sort` (e.g. `loyalty_points_desc`), `total_matching`, `properties` |
| `reservation.view` | data_access | reservation detail opened | |
| `reservation.export` | data_access | CSV export (allowed or denied by `export_step_up`) | `count`, `distinct_guests`, `pii_fields`, `bytes`, `query` |
| `reservation.create` / `reservation.update` | data_access | booking created / notes edited | `details.card_number_stored_in_free_text` when scrubbing is OFF |
| `reservation.check_in` / `reservation.check_out` | data_access | front-desk workflow | |
| `guest.search` / `guest.view` | data_access | guest list / profile | `query.sort` |
| `pii.reveal` | pii | a masked field was revealed | `resource.pii_fields`, `details.reason` |
| `pii.card_number_scrubbed` | pii | card number removed from free text | `details.card_numbers_removed` |
| `id_document.upload` / `id_document.download` | pii | ID scan stored / opened | |
| `folio.view` / `folio.charge` | payment | folio opened / charge posted | |
| `payment.capture` | payment | payment taken | `details.new_card`, `details.card_token` |
| `payment.refund_requested` | payment | refund created, pending approval | `details.refund_to_new_instrument`, `amount` |
| `payment.refund_completed` | payment | refund completed **without** approval (control OFF) | same as above, `approved_by: null` |
| `payment.refund_approved` / `payment.refund_rejected` | payment | second user decides | `details.requested_by` |
| `loyalty.search` / `loyalty.view` | loyalty | staff loyalty lookups | `extra.points_visible` |
| `loyalty.adjust` | loyalty | manual points adjustment by staff | `details.points`, `reason` |
| `loyalty.redeem` / `loyalty.transfer` | loyalty | points spent / moved (staff or guest) | `details.points`, `to_account` |
| `loyalty.contact_changed` | loyalty | portal email changed | `details.old_domain`, `new_domain` |
| `partner.reservations_read` / `partner.reservation_read` | partner | OTA API pull | `extra.fields_returned`, `extra.fields_beyond_contract`, `pii_fields` |
| `partner.reservation_created` | partner | OTA pushes a booking | |
| `partner.auth_failed` | partner | invalid or revoked partner key | |
| `admin.policy_changed` | admin | Policy Center toggle changed by a staff admin | `details.before/after`, `details.control_disabled` |
| `admin.staff_updated` / `admin.partner_updated` | admin | role/scope/status or OTA allowlist changed | `details.changes`, `fields_added` |
| `control.*` | control | a response action executed through the control API | `details.incident_id`, `reason`, `approved_by` |

`control.*` actions: `sessions_revoked`, `staff_suspended`, `staff_reinstated`, `loyalty_frozen`, `loyalty_unfrozen`,
`partner_key_rotated`, `policy_changed`.

## Delivery (HTTP sink)

With `EVENT_SINKS=http` (or `file,http`), batches are POSTed every ~1s to `INGEST_URL`:

```
POST {INGEST_URL}
Content-Type: application/json
X-Api-Key: {INGEST_API_KEY}
X-Signature: sha256=<hex HMAC-SHA256 of the raw body using INGEST_HMAC_SECRET>
X-Source: staydesk
X-Event-Count: 37

{"events": [ {...}, {...} ]}
```

Any 2xx marks the batch delivered. Non-2xx responses and timeouts are retried with backoff, and nothing is lost while the receiver is down.
