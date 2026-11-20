"""Outbox shipper: delivers security events from the event_outbox table to the configured sinks.

Delivery is at-least-once; consumers should de-duplicate on event_id.
Sinks:
  file   - append JSON lines to EVENT_FILE (sample data for the monitoring team / offline replay)
  http   - POST {"events": [...]} to INGEST_URL with X-Api-Key and an HMAC-SHA256 X-Signature header
  stdout - print one line per event
"""

import json
import logging
import threading
from pathlib import Path

import httpx
from sqlalchemy import select

from . import security
from .config import get_settings
from .db import SessionLocal
from .models import EventOutbox

log = logging.getLogger("staydesk.shipper")


class FileSink:
    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def send(self, events: list[dict]) -> None:
        with self.path.open("a", encoding="utf-8") as fh:
            for event in events:
                fh.write(json.dumps(event, separators=(",", ":")) + "\n")


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
            print(f"[event] {event['ts']} {event['action']} {event['outcome']['result']} actor={event['actor'].get('id')}",
                  flush=True)


def build_sinks() -> list:
    settings = get_settings()
    sinks = []
    for name in settings.sink_list:
        if name == "file":
            sinks.append(FileSink(settings.event_file))
        elif name == "http" and settings.ingest_url:
            sinks.append(HttpSink(settings.ingest_url, settings.ingest_api_key, settings.ingest_hmac_secret))
        elif name == "stdout":
            sinks.append(StdoutSink())
    return sinks


class OutboxShipper(threading.Thread):
    def __init__(self):
        super().__init__(name="outbox-shipper", daemon=True)
        self.settings = get_settings()
        self.sinks = build_sinks()
        self._stop_event = threading.Event()
        self._failures = 0

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        log.info("outbox shipper started with sinks=%s", [type(s).__name__ for s in self.sinks])
        while not self._stop_event.is_set():
            shipped = 0
            try:
                shipped = self.ship_once()
            except Exception:  # keep the loop alive no matter what
                log.exception("outbox shipping failed")
                self._failures += 1
            if shipped == 0:
                backoff = min(30.0, self.settings.shipper_interval_seconds * (2 ** min(self._failures, 5)))
                self._stop_event.wait(backoff)

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
            payloads = [row.payload for row in rows]
            try:
                for sink in self.sinks:
                    sink.send(payloads)
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
