from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "dev"
    demo_mode: bool = True

    database_url: str = "postgresql+psycopg://staydesk:staydesk@127.0.0.1:5433/staydesk"

    jwt_secret: str = "dev-only-change-me"
    jwt_ttl_minutes: int = 480
    pii_encryption_key: str = ""

    cors_origins: str = "http://localhost:5173"
    trust_forwarded_for: bool = True

    # Security event delivery (transactional outbox -> sinks)
    # EVENT_FORMAT: "v1" = STAYSEC HMS integration contract v1.0 (default), "internal" = raw StayDesk audit events
    event_format: str = "v1"
    event_sinks: str = "file"  # comma-separated: file, sqs, http, stdout
    event_file: str = "data/events.jsonl"
    sqs_queue_url: str = ""
    aws_region: str = "ap-south-1"
    ingest_url: str = ""
    ingest_api_key: str = ""
    ingest_hmac_secret: str = ""
    shipper_interval_seconds: float = 1.0
    shipper_batch_size: int = 200
    heartbeat_seconds: int = 30
    producer_service: str = "staydesk-api"
    producer_instance: str = ""  # defaults to hostname

    # STAYSEC contract secrets (shared privately by the STAYSEC team)
    guest_ref_key: str = "dev-guest-ref-key"
    staysec_signing_secret: str = "dev-staysec-signing-secret"
    staysec_key_id: str = "staysec-1"
    # Optional: only accept action calls from this IP (STAYSEC's fixed egress IP). Empty = signature check only.
    staysec_egress_ip: str = ""

    # Service-to-service key for the extended /context and /control APIs
    service_api_key: str = "dev-service-key"

    id_doc_dir: str = "data/id_docs"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sink_list(self) -> list[str]:
        return [s.strip().lower() for s in self.event_sinks.split(",") if s.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
