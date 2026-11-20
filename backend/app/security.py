import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import pyotp
from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


class TokenError(Exception):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---- passwords ----

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


# ---- tokens ----

def create_token(sub: str, typ: str, ttl_minutes: int, **claims) -> str:
    now = utcnow()
    payload = {
        "sub": sub,
        "typ": typ,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ttl_minutes)).timestamp()),
        **claims,
    }
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


def decode_token(token: str, expected_type: str) -> dict:
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc
    if claims.get("typ") != expected_type:
        raise TokenError("wrong token type")
    return claims


# ---- TOTP (MFA) ----

def new_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str | None, code: str | None) -> bool:
    if not secret or not code:
        return False
    return pyotp.TOTP(secret).verify(str(code).strip(), valid_window=1)


def totp_uri(secret: str, account: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name="StayDesk")


# ---- field encryption (passport numbers) ----

def _fernet() -> Fernet:
    settings = get_settings()
    key = settings.pii_encryption_key
    if not key:
        # Dev fallback only: derive a stable key from the JWT secret.
        key = base64.urlsafe_b64encode(hashlib.sha256(("dev-pii:" + settings.jwt_secret).encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt_str(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_str(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None


# ---- API keys / signatures ----

def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_api_key(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(24)}"


def const_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def sign_body(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
