"""Outbox shipper: delivers security events from the event_outbox table to the configured sinks.

* EVENT_FORMAT=v1 (default) converts internal events to the STAYSEC HMS contract v1.0 envelope
  (app.contract_v1). EVENT_FORMAT=internal ships raw StayDesk audit events.
* Delivery is at-least-once with the same event_id on retry; STAYSEC de-duplicates on event_id.
* Publishing is asynchronous (never blocks a user request). The outbox is durable, so events survive
  restarts and SQS outages, retried with backoff.
* Sends system.heartbeat every HEARTBEAT_SECONDS with the current outbox backlog.

Sinks: sqs (SendMessageBatch, 10 per call, message attribute event_type), file (JSON lines), http, stdout.
"""

import json
import logging
import re
import threading
import time
import uuid
from pathlib import Path

import httpx
from sqlalchemy import func, select

from . import contract_v1, security
from .config import get_settings
from .db import SessionLocal
from .models import EventOutbox

log = logging.getLogger("staydesk.shipper")
SQS_MAX_BYTES = 256 * 1024


def _event_type(event: dict) -> str:
    return event.get("event_type") or event.get("action") or "unknown"


class FileSink:
    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def send(self, events: list[dict]) -> None:
        with self.path.open("a", encoding="utf-8") as fh:
            for event in events:
                fh.write(json.dumps(event, separators=(",", ":")) + "\n")


class SqsSink:
    def __init__(self, queue_url: str, region: str):
        import boto3  # imported lazily so local dev without AWS deps still works

        self.queue_url = queue_url
        # The queue may live in another region than the app (STAYSEC: us-east-1, HMS: ap-south-1).
        match = re.match(r"https://sqs\.([a-z0-9-]+)\.amazonaws\.com/", queue_url)
        self.client = boto3.client("sqs", region_name=match.group(1) if match else region)

    def send(self, events: list[dict]) -> None:
        for i in range(0, len(events), 10):
            entries = []
            for n, event in enumerate(events[i:i + 10]):
                body = json.dumps(event, separators=(",", ":"))
                if len(body.encode()) > SQS_MAX_BYTES:
                    log.error("dropping oversize event %s (%s bytes)", event.get("event_id"), len(body))
                    continue
                entries.append({"Id": str(n), "MessageBody": body, "MessageAttributes": {
                    "event_type": {"DataType": "String", "StringValue": _event_type(event)}}})
            if not entries:
                continue
            result = self.client.send_message_batch(QueueUrl=self.queue_url, Entries=entries)
            if result.get("Failed"):
                raise RuntimeError(f"SQS rejected {len(result['Failed'])} messages: {result['Failed'][0]}")


class HttpSink:
    def __init__(self, url: str, api_key: str, hmac_secret: str):
        self.url, self.api_key, self.hmac_secret = url, api_key, hmac_secret
        self.client = httpx.Client(timeout=5.0)

    def send(self, events: list[dict]) -> None:
        body = json.dumps({"events": events}, separators=(",", ":")).encode()
        headers = {"Content-Type": "application/json", "X-Source": "staydesk", "X-Event-Count": str(len(events))}
        if self.api_key:
            headers["X-Api-Key"] = self.api_key
        if self.hmac_secret:
            headers["X-Signature"] = "sha256=" + security.sign_body(self.hmac_secret, body)
        response = self.client.post(self.url, content=body, headers=headers)
        response.raise_for_status()


class StdoutSink:
    def send(self, events: list[dict]) -> None:
        for event in events:
            who = (event.get("actor") or {}).get("user_id") or (event.get("actor") or {}).get("id")
            print(f"[event] {event.get('occurred_at') or event.get('ts')} {_event_type(event)} actor={who}", flush=True)


def build_sinks() -> list:
    settings = get_settings()
    sinks = []
    for name in settings.sink_list:
        if name == "file":
            sinks.append(FileSink(settings.event_file))
        elif name == "sqs":
            if settings.sqs_queue_url:
                sinks.append(SqsSink(settings.sqs_queue_url, settings.aws_region))
            else:
                log.warning("EVENT_SINKS includes sqs but SQS_QUEUE_URL is empty; sqs sink disabled")
        elif name == "http" and settings.ingest_url:
            sinks.append(HttpSink(settings.ingest_url, settings.ingest_api_key, settings.ingest_hmac_secret))
        elif name == "stdout":
            sinks.append(StdoutSink())
    return sinks


def transform(payloads: list[dict]) -> list[dict]:
    if get_settings().event_format != "v1":
        return payloads
    out = []
    for payload in payloads:
        try:
            converted = contract_v1.to_v1(payload)
        except Exception:
            log.exception("could not convert event %s (%s)", payload.get("event_id"), payload.get("action"))
            continue
        if converted is not None:
            out.append(converted)
    return out


class OutboxShipper(threading.Thread):
    def __init__(self):
        super().__init__(name="outbox-shipper", daemon=True)
        self.settings = get_settings()
        self.sinks = build_sinks()
        self._stop_event = threading.Event()
        self._failures = 0
        self._last_heartbeat = 0.0

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        log.info("outbox shipper started: format=%s sinks=%s", self.settings.event_format,
                 [type(s).__name__ for s in self.sinks])
        while not self._stop_event.is_set():
            shipped = 0
            try:
                self.maybe_heartbeat()
                shipped = self.ship_once()
            except Exception:  # keep the loop alive no matter what
                log.exception("outbox shipping failed")
                self._failures += 1
            if shipped == 0:
                backoff = min(30.0, self.settings.shipper_interval_seconds * (2 ** min(self._failures, 5)))
                self._stop_event.wait(backoff)

    def maybe_heartbeat(self) -> None:
        if not self.sinks or time.monotonic() - self._last_heartbeat < self.settings.heartbeat_seconds:
            return
        with SessionLocal() as db:
            backlog = db.execute(select(func.count()).select_from(EventOutbox).where(EventOutbox.sent_at.is_(None))).scalar()
        if self.settings.event_format == "v1":
            event = contract_v1.envelope("system.heartbeat", security.utcnow(), str(uuid.uuid4()),
                                         data={"queue_backlog": backlog})
        else:
            event = {"action": "system.heartbeat", "event_id": str(uuid.uuid4()), "ts": security.utcnow().isoformat(),
                     "details": {"queue_backlog": backlog}}
        try:
            for sink in self.sinks:
                sink.send([event])
            self._last_heartbeat = time.monotonic()
        except Exception as exc:
            log.warning("heartbeat failed: %s", exc)
            self._last_heartbeat = time.monotonic() - self.settings.heartbeat_seconds + 5  # retry in ~5s

    def ship_once(self) -> int:
        if not self.sinks:
            return 0
        with SessionLocal() as db:
            rows = db.execute(
                select(EventOutbox)
                .where(EventOutbox.sent_at.is_(None))
                .order_by(EventOutbox.id)
                .limit(self.settings.shipper_batch_size)
                .with_for_update(skip_locked=True)
            ).scalars().all()
            if not rows:
                self._failures = 0
                return 0
            events = transform([row.payload for row in rows])
            try:
                if events:
                    for sink in self.sinks:
                        sink.send(events)
            except Exception as exc:
                for row in rows:
                    row.attempts += 1
                    row.last_error = str(exc)[:500]
                db.commit()
                self._failures += 1
                log.warning("event delivery failed (%s events): %s", len(rows), exc)
                return 0
            now = security.utcnow()
            for row in rows:
                row.sent_at = now
            db.commit()
            self._failures = 0
            return len(rows)
