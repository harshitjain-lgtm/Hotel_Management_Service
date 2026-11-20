from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(80))
    rooms: Mapped[int] = mapped_column(Integer, default=100)


class Staff(Base):
    __tablename__ = "staff"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(32))
    home_property_id: Mapped[str] = mapped_column(ForeignKey("properties.id"))
    property_scope: Mapped[list[str]] = mapped_column(ARRAY(String(8)), default=list)
    mfa_secret: Mapped[str | None] = mapped_column(String(64))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(16), default="active")
    shift_start: Mapped[time] = mapped_column(Time)
    shift_end: Mapped[time] = mapped_column(Time)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StaffDevice(Base):
    __tablename__ = "staff_devices"

    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id"), primary_key=True)
    device_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StaffSession(Base):
    __tablename__ = "staff_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id"), index=True)
    device_id: Mapped[str] = mapped_column(String(80))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    mfa_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    step_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(300))
    revoked_by: Mapped[str | None] = mapped_column(String(60))


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(160), index=True)
    phone: Mapped[str] = mapped_column(String(32))
    nationality: Mapped[str] = mapped_column(String(2))
    dob: Mapped[date | None] = mapped_column(Date)
    address_city: Mapped[str | None] = mapped_column(String(80))
    id_type: Mapped[str | None] = mapped_column(String(16))
    # Passport numbers are encrypted at the application layer (Fernet); only the last 4 are stored in clear.
    passport_no_enc: Mapped[str | None] = mapped_column(Text)
    passport_last4: Mapped[str | None] = mapped_column(String(4))
    # Full Aadhaar numbers are never stored; only the last 4 digits.
    aadhaar_last4: Mapped[str | None] = mapped_column(String(4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Reservation(Base):
    __tablename__ = "reservations"
    __table_args__ = (
        Index("ix_reservations_property_arrival", "property_id", "arrival"),
        Index("ix_reservations_guest", "guest_id"),
        Index("ix_reservations_channel", "channel"),
    )

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    guest_id: Mapped[str] = mapped_column(ForeignKey("guests.id"))
    property_id: Mapped[str] = mapped_column(ForeignKey("properties.id"))
    channel: Mapped[str] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(16))
    arrival: Mapped[date] = mapped_column(Date)
    departure: Mapped[date] = mapped_column(Date)
    room_type: Mapped[str] = mapped_column(String(24))
    room_no: Mapped[str | None] = mapped_column(String(8))
    adults: Mapped[int] = mapped_column(Integer, default=1)
    children: Mapped[int] = mapped_column(Integer, default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    special_requests: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[str | None] = mapped_column(String(40))


class IdDocument(Base):
    __tablename__ = "id_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    guest_id: Mapped[str] = mapped_column(ForeignKey("guests.id"), index=True)
    reservation_id: Mapped[str | None] = mapped_column(ForeignKey("reservations.id"))
    doc_type: Mapped[str] = mapped_column(String(24))
    storage_key: Mapped[str] = mapped_column(String(300))
    uploaded_by: Mapped[str | None] = mapped_column(String(40))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    retention_until: Mapped[date] = mapped_column(Date)


class CardToken(Base):
    """Card tokens from the (simulated) payment gateway. Full card numbers are never stored."""

    __tablename__ = "card_tokens"

    token: Mapped[str] = mapped_column(String(40), primary_key=True)
    guest_id: Mapped[str | None] = mapped_column(ForeignKey("guests.id"), index=True)
    brand: Mapped[str] = mapped_column(String(16))
    last4: Mapped[str] = mapped_column(String(4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FolioItem(Base):
    __tablename__ = "folio_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    reservation_id: Mapped[str] = mapped_column(ForeignKey("reservations.id"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # charge | payment | refund
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    description: Mapped[str] = mapped_column(String(200))
    card_token: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="completed")  # completed | pending_approval | rejected
    reason: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[str | None] = mapped_column(String(40))
    approved_by: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LoyaltyAccount(Base):
    __tablename__ = "loyalty_accounts"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    guest_id: Mapped[str] = mapped_column(ForeignKey("guests.id"), unique=True)
    tier: Mapped[str] = mapped_column(String(16))
    points_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    portal_email: Mapped[str] = mapped_column(String(160), unique=True)
    portal_password_hash: Mapped[str] = mapped_column(String(100))
    contact_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    frozen: Mapped[bool] = mapped_column(Boolean, default=False)
    frozen_reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LoyaltyTransaction(Base):
    __tablename__ = "loyalty_transactions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("loyalty_accounts.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # earn | redeem | adjust | transfer_out | transfer_in
    points: Mapped[int] = mapped_column(BigInteger)
    description: Mapped[str] = mapped_column(String(200))
    performed_by_type: Mapped[str] = mapped_column(String(12))  # staff | guest | system
    performed_by: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Partner(Base):
    """Third-party booking platforms (OTAs) integrated through the partner API."""

    __tablename__ = "partners"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    api_key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    key_prefix: Mapped[str] = mapped_column(String(16))
    key_status: Mapped[str] = mapped_column(String(12), default="active")
    allowed_fields: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    key_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PolicySetting(Base):
    """Security controls ("toggles") enforced by the backend."""

    __tablename__ = "policy_settings"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_by: Mapped[str | None] = mapped_column(String(60))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EventOutbox(Base):
    """Transactional outbox: security events are written in the same DB transaction as the action,
    then shipped asynchronously to the monitoring platform."""

    __tablename__ = "event_outbox"
    __table_args__ = (Index("ix_event_outbox_unsent", "sent_at", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(36), unique=True)
    action: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
