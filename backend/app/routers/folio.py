import re
import secrets
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import security
from ..audit import Resource
from ..deps import Ctx, get_staff_ctx
from ..models import CardToken, FolioItem, Reservation
from ..pii import card_brand, luhn_ok
from ..policy import is_enabled
from .reservations import load_reservation

router = APIRouter(tags=["folio"])


def _item(f: FolioItem) -> dict:
    return {
        "id": f.id, "kind": f.kind, "amount": float(f.amount), "description": f.description,
        "card_token": f.card_token, "status": f.status, "reason": f.reason, "created_by": f.created_by,
        "approved_by": f.approved_by, "created_at": f.created_at.isoformat() if f.created_at else None,
        "approved_at": f.approved_at.isoformat() if f.approved_at else None,
    }


def _tokenize(ctx: Ctx, guest_id: str, card_number: str) -> CardToken:
    """Simulated payment gateway: validates the card and returns a token. The full number is never stored."""
    digits = re.sub(r"\D", "", card_number)
    if not (13 <= len(digits) <= 19 and luhn_ok(digits)):
        raise HTTPException(status_code=422, detail={"error": "invalid_card_number"})
    token = CardToken(token="tok_" + secrets.token_hex(8), guest_id=guest_id, brand=card_brand(digits), last4=digits[-4:])
    ctx.db.add(token)
    return token


def _resolve_card(ctx: Ctx, guest_id: str, card_token: str | None, card_number: str | None) -> tuple[CardToken, bool]:
    if card_number:
        return _tokenize(ctx, guest_id, card_number), True
    if card_token:
        token = ctx.db.get(CardToken, card_token)
        if token is None:
            raise HTTPException(status_code=404, detail={"error": "card_token_not_found"})
        return token, False
    raise HTTPException(status_code=422, detail={"error": "card_token_or_card_number_required"})


def _totals(items: list[FolioItem]) -> dict:
    charges = sum((f.amount for f in items if f.kind == "charge"), Decimal(0))
    paid = sum((f.amount for f in items if f.kind == "payment"), Decimal(0))
    refunded = sum((f.amount for f in items if f.kind == "refund" and f.status == "completed"), Decimal(0))
    pending = sum((f.amount for f in items if f.kind == "refund" and f.status == "pending_approval"), Decimal(0))
    return {"charges": charges, "paid": paid, "refunded": refunded, "pending_refunds": pending,
            "balance": charges - paid + refunded}


@router.get("/reservations/{rid}/folio")
def get_folio(rid: str, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("folio.read", "folio.view", "payment")
    r, g, _ = load_reservation(ctx, rid, "folio.view")
    items = ctx.db.query(FolioItem).filter(FolioItem.reservation_id == rid).order_by(FolioItem.id).all()
    cards = ctx.db.query(CardToken).filter(CardToken.guest_id == g.id).all()
    ctx.emit("folio.view", "payment", resource=Resource(type="folio", ids=[rid], guest_ids=[g.id],
                                                        properties=[r.property_id]))
    ctx.db.commit()
    totals = {k: float(v) for k, v in _totals(items).items()}
    return {"reservation_id": rid, "items": [_item(f) for f in items], "totals": totals,
            "cards_on_file": [{"token": c.token, "brand": c.brand, "last4": c.last4} for c in cards]}


class ChargeIn(BaseModel):
    amount: Decimal = Field(gt=0)
    description: str = Field(max_length=200)


@router.post("/reservations/{rid}/charges")
def add_charge(rid: str, body: ChargeIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("folio.write", "folio.charge", "payment")
    r, g, _ = load_reservation(ctx, rid, "folio.charge")
    item = FolioItem(reservation_id=rid, kind="charge", amount=body.amount, description=body.description,
                     created_by=ctx.staff.id)
    ctx.db.add(item)
    ctx.emit("folio.charge", "payment", resource=Resource(type="folio", ids=[rid], guest_ids=[g.id],
                                                          properties=[r.property_id]),
             details={"amount": body.amount})
    ctx.db.commit()
    return _item(item)


class PaymentIn(BaseModel):
    amount: Decimal = Field(gt=0)
    card_token: str | None = None
    card_number: str | None = None  # tokenized immediately, never stored


@router.post("/reservations/{rid}/payments")
def capture_payment(rid: str, body: PaymentIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("folio.write", "payment.capture", "payment")
    r, g, _ = load_reservation(ctx, rid, "payment.capture")
    card, new_card = _resolve_card(ctx, g.id, body.card_token, body.card_number)
    item = FolioItem(reservation_id=rid, kind="payment", amount=body.amount, description=f"Card payment {card.brand} ****{card.last4}",
                     card_token=card.token, created_by=ctx.staff.id)
    ctx.db.add(item)
    ctx.emit("payment.capture", "payment", resource=Resource(type="folio", ids=[rid], guest_ids=[g.id],
                                                             properties=[r.property_id]),
             details={"amount": body.amount, "card_token": card.token, "new_card": new_card})
    ctx.db.commit()
    return _item(item)


class RefundIn(BaseModel):
    amount: Decimal = Field(gt=0)
    reason: str = Field(min_length=3, max_length=300)
    card_token: str | None = None
    card_number: str | None = None


@router.post("/reservations/{rid}/refunds")
def request_refund(rid: str, body: RefundIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("refund.create", "payment.refund_requested", "payment")
    r, g, _ = load_reservation(ctx, rid, "payment.refund_requested")
    items = ctx.db.query(FolioItem).filter(FolioItem.reservation_id == rid).all()
    totals = _totals(items)
    refundable = totals["paid"] - totals["refunded"] - totals["pending_refunds"]
    if body.amount > refundable:
        raise HTTPException(status_code=422, detail={"error": "amount_exceeds_refundable", "refundable": float(refundable)})
    card, new_card = _resolve_card(ctx, g.id, body.card_token, body.card_number)
    paid_with = {f.card_token for f in items if f.kind == "payment" and f.card_token}
    to_new_instrument = card.token not in paid_with

    dual = is_enabled(ctx.db, "refund_dual_approval")
    item = FolioItem(reservation_id=rid, kind="refund", amount=body.amount, reason=body.reason,
                     description=f"Refund to {card.brand} ****{card.last4}", card_token=card.token,
                     status="pending_approval" if dual else "completed", created_by=ctx.staff.id)
    if not dual:
        item.approved_at = security.utcnow()
    ctx.db.add(item)
    ctx.db.flush()
    details = {"amount": body.amount, "card_token": card.token, "new_card": new_card,
               "refund_to_new_instrument": to_new_instrument, "refund_item_id": item.id, "reason": body.reason}
    resource = Resource(type="folio", ids=[rid], guest_ids=[g.id], properties=[r.property_id])
    if dual:
        ctx.emit("payment.refund_requested", "payment", resource=resource, policy="refund_dual_approval", details=details)
    else:
        ctx.emit("payment.refund_completed", "payment", resource=resource, details={**details, "approved_by": None})
    ctx.db.commit()
    return _item(item)


@router.get("/refunds")
def list_refunds(status: str = "pending_approval", ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("refund.approve", "payment.refund_list", "payment")
    stmt = (select(FolioItem, Reservation).join(Reservation, Reservation.id == FolioItem.reservation_id)
            .where(FolioItem.kind == "refund", FolioItem.status == status).order_by(FolioItem.id.desc()).limit(200))
    scope = ctx.scope()
    if scope is not None:
        stmt = stmt.where(Reservation.property_id.in_(scope))
    rows = ctx.db.execute(stmt).all()
    return {"items": [{**_item(f), "reservation_id": r.id, "property_id": r.property_id} for f, r in rows]}


def _decide(item_id: int, ctx: Ctx, approve: bool):
    action = "payment.refund_approved" if approve else "payment.refund_rejected"
    ctx.require("refund.approve", action, "payment")
    item = ctx.db.get(FolioItem, item_id)
    if item is None or item.kind != "refund":
        raise HTTPException(status_code=404, detail={"error": "refund_not_found"})
    r, g, _ = load_reservation(ctx, item.reservation_id, action)
    resource = Resource(type="folio", ids=[r.id], guest_ids=[g.id], properties=[r.property_id])
    if item.status != "pending_approval":
        raise HTTPException(status_code=409, detail={"error": f"refund_is_{item.status}"})
    if item.created_by == ctx.staff.id:
        ctx.deny(action, "payment", 403, "Refunds cannot be approved by the user who requested them",
                 policy="refund_dual_approval", resource=resource, extra={"code": "self_approval"})
    item.status = "completed" if approve else "rejected"
    item.approved_by = ctx.staff.id
    item.approved_at = security.utcnow()
    ctx.emit(action, "payment", resource=resource,
             details={"amount": item.amount, "refund_item_id": item.id, "requested_by": item.created_by})
    ctx.db.commit()
    return _item(item)


@router.post("/refunds/{item_id}/approve")
def approve_refund(item_id: int, ctx: Ctx = Depends(get_staff_ctx)):
    return _decide(item_id, ctx, approve=True)


@router.post("/refunds/{item_id}/reject")
def reject_refund(item_id: int, ctx: Ctx = Depends(get_staff_ctx)):
    return _decide(item_id, ctx, approve=False)
