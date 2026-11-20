"""Scenario 4: excessive data sharing with a third-party booking platform (OTA).

The partner integration bulk-pulls its reservations. With the allowlist OFF, responses include
fields beyond the contract (passport number, DOB, phone, loyalty data).

Control that stops it: ota_field_allowlist. Response action: /control/partners/{id}/rotate-key.
"""

from common import base_args, blocked, detail, load_seed, make_client, ok, step, warn


def main():
    parser = base_args(__doc__)
    parser.add_argument("--partner", default=None)
    parser.add_argument("--pages", type=int, default=8)
    args = parser.parse_args()
    seed = load_seed(args.seed)
    partner_id = args.partner or seed["demo_targets"]["ota_partner"]
    partner = next(p for p in seed["partners"] if p["id"] == partner_id)

    client = make_client(args.base, ip="34.120.18.9", user_agent="TripNest-Sync/3.2")
    client.headers["X-Partner-Key"] = partner["api_key"]
    step(f"{partner['name']} integration bulk-syncing reservations ({args.pages} pages x 500)")
    records = []
    for page in range(1, args.pages + 1):
        r = client.get("/partner/v1/reservations", params={"limit": 500, "page": page})
        if r.status_code == 401:
            blocked(f"partner key rejected: {detail(r).get('reason')}")
            return
        items = r.json()["items"]
        if not items:
            break
        records.extend(items)
    fields = sorted({k for rec in records for k, v in rec.items() if v is not None})
    beyond = sorted(set(fields) - set(partner["allowed_fields"]))
    ok(f"pulled {len(records):,} reservations")
    if beyond:
        with_passport = sum(1 for rec in records if rec.get("passport_no"))
        warn(f"fields beyond contract: {beyond}")
        warn(f"{with_passport:,} records include full passport numbers")
    else:
        blocked(f"ota_field_allowlist: partner received only contracted fields {fields}")


if __name__ == "__main__":
    main()
