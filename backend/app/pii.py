"""PII helpers: masking and payment-card detection."""

import re

_CARD_CANDIDATE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")


def luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def find_card_numbers(text: str | None) -> list[str]:
    """Return substrings that look like real payment card numbers (13-19 digits, Luhn-valid)."""
    found = []
    for match in _CARD_CANDIDATE.finditer(text or ""):
        digits = re.sub(r"\D", "", match.group())
        if 13 <= len(digits) <= 19 and luhn_ok(digits):
            found.append(match.group())
    return found


def scrub_card_numbers(text: str) -> str:
    for candidate in find_card_numbers(text):
        text = text.replace(candidate, "[card number removed]")
    return text


def card_brand(digits: str) -> str:
    if digits.startswith("4"):
        return "visa"
    if digits[:2] in {"34", "37"}:
        return "amex"
    if digits[:2] in {"51", "52", "53", "54", "55"} or 2221 <= int(digits[:4]) <= 2720:
        return "mastercard"
    if digits[:2] in {"60", "65", "81", "82"} or digits.startswith("508"):
        return "rupay"
    return "card"


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return phone
    digits = re.sub(r"\D", "", phone)
    return "*" * max(len(digits) - 4, 0) + digits[-4:]


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return email
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


def mask_passport(last4: str | None) -> str | None:
    return f"****{last4}" if last4 else None


def mask_aadhaar(last4: str | None) -> str | None:
    return f"XXXX XXXX {last4}" if last4 else None
