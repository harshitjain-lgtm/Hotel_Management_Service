"""Loyalty program: staff-side management and the guest self-service portal."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import security
from ..audit import Resource
from ..db import get_db
from ..deps import Ctx, basic_actor, get_guest_ctx, get_staff_ctx
from ..models import Guest, LoyaltyAccount, LoyaltyTransaction
from ..policy import get_policy, is_enabled
from ..queries import count_rows
from ..serializers import guest_name
from .. import pii

router = APIRouter(prefix="/loyalty", tags=["loyalty"])
portal = APIRouter(prefix="/portal", tags=["guest-portal"])

LOYALTY_SORTS = {
    "points_desc": lambda: [LoyaltyAccount.points_balance.desc(), LoyaltyAccount.id],
    "name_asc": lambda: [Guest.last_name.asc(), Guest.first_name.asc(), LoyaltyAccount.id],
    "created_desc": lambda: [LoyaltyAccount.created_at.desc(), LoyaltyAccount.id],
}


def _account_view(a: LoyaltyAccount, g: Guest | None, masking: bool) -> dict:
    return {
        "id": a.id, "guest_id": a.guest_id, "guest_name": guest_name(g) if g else None,
        "tier": a.tier, "points": a.points_balance, "frozen": a.frozen, "frozen_reason": a.frozen_reason,
        "portal_email": pii.mask_email(a.portal_email) if masking else a.portal_email,
        "contact_changed_at": a.contact_changed_at.isoformat() if a.contact_changed_at else None,
    }


def _txn_view(t: LoyaltyTransaction) -> dict:
    return {"id": t.id, "kind": t.kind, "points": t.points, "description": t.description,
            "performed_by_type": t.performed_by_type, "performed_by": t.performed_by,
            "created_at": t.created_at.isoformat() if t.created_at else None}


def _resource(a: LoyaltyAccount) -> Resource:
    return Resource(type="loyalty_account", ids=[a.id], guest_ids=[a.guest_id])


def check_spendable(ctx: Ctx, account: LoyaltyAccount, points: int, action: str) -> None:
    resource = _resource(account)
    if account.frozen:
        ctx.deny(action, "loyalty", 423, "Loyalty account is frozen", resource=resource,
                 extra={"code": "account_frozen", "frozen_reason": account.frozen_reason})
    enabled, params = get_policy(ctx.db, "loyalty_cooling_off")
    hours = int(params.get("hours", 24))
    if enabled and account.contact_changed_at and account.contact_changed_at + timedelta(hours=hours) > security.utcnow():
        ctx.deny(action, "loyalty", 403, f"Redemptions and transfers are blocked for {hours}h after a contact change",
                 policy="loyalty_cooling_off", resource=resource, extra={"code": "cooling_off"})
    if points > account.points_balance:
        raise HTTPException(status_code=422, detail={"error": "insufficient_points", "balance": account.points_balance})


def _record(ctx: Ctx, account: LoyaltyAccount, kind: str, points: int, description: str) -> None:
    by_type = ctx.actor.type
    ctx.db.add(LoyaltyTransaction(account_id=account.id, kind=kind, points=points, description=description,
                                  performed_by_type=by_type, performed_by=ctx.actor.id))


def do_redeem(ctx: Ctx, account: LoyaltyAccount, points: int, description: str) -> dict:
    check_spendable(ctx, account, points, "loyalty.redeem")
    account.points_balance -= points
    _record(ctx, account, "redeem", -points, description)
    ctx.emit("loyalty.redeem", "loyalty", resource=_resource(account),
             details={"points": points, "description": description, "new_balance": account.points_balance})
    ctx.db.commit()
    return {"account_id": account.id, "redeemed": points, "balance": account.points_balance}


def do_transfer(ctx: Ctx, account: LoyaltyAccount, to_account_id: str, points: int) -> dict:
    target = ctx.db.get(LoyaltyAccount, to_account_id)
    if target is None or target.id == account.id:
        raise HTTPException(status_code=422, detail={"error": "invalid_target_account"})
    check_spendable(ctx, account, points, "loyalty.transfer")
    account.points_balance -= points
    target.points_balance += points
    _record(ctx, account, "transfer_out", -points, f"Transfer to {target.id}")
    _record(ctx, target, "transfer_in", points, f"Transfer from {account.id}")
    ctx.emit("loyalty.transfer", "loyalty",
             resource=Resource(type="loyalty_account", ids=[account.id, target.id],
                               guest_ids=[account.guest_id, target.guest_id]),
             details={"points": points, "from_account": account.id, "to_account": target.id,
                      "new_balance": account.points_balance})
    ctx.db.commit()
    return {"account_id": account.id, "transferred": points, "to_account": target.id, "balance": account.points_balance}


# ------------------------------ staff side ------------------------------

@router.get("/accounts")
def list_accounts(
    ctx: Ctx = Depends(get_staff_ctx),
    q: str | None = None,
    sort: str = "points_desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query = {"q": q, "sort": sort, "page": page, "page_size": page_size}
    ctx.require("loyalty.read", "loyalty.search", "loyalty", Resource(type="loyalty_account", query=query))
    stmt = select(LoyaltyAccount, Guest).join(Guest, Guest.id == LoyaltyAccount.guest_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(LoyaltyAccount.id.ilike(like), Guest.first_name.ilike(like), Guest.last_name.ilike(like),
                              LoyaltyAccount.portal_email.ilike(like)))
    stmt = stmt.order_by(*LOYALTY_SORTS.get(sort, LOYALTY_SORTS["points_desc"])())
    total = count_rows(ctx.db, stmt)
    rows = ctx.db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    masking = is_enabled(ctx.db, "pii_masking")
    ctx.emit("loyalty.search", "loyalty", resource=Resource(
        type="loyalty_account", ids=[a.id for a, _ in rows], guest_ids=[a.guest_id for a, _ in rows],
        pii_fields=["name"] + ([] if masking else ["email"]), masked_fields=["email"] if masking else [],
        query=query, extra={"total_matching": total,
                            "points_visible": sum(a.points_balance for a, _ in rows)}))
    ctx.db.commit()
    return {"items": [_account_view(a, g, masking) for a, g in rows], "total": total, "page": page,
            "page_size": page_size}


@router.get("/accounts/{account_id}")
def get_account(account_id: str, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("loyalty.read", "loyalty.view", "loyalty")
    account = ctx.db.get(LoyaltyAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail={"error": "account_not_found"})
    guest = ctx.db.get(Guest, account.guest_id)
    txns = (ctx.db.query(LoyaltyTransaction).filter(LoyaltyTransaction.account_id == account_id)
            .order_by(LoyaltyTransaction.id.desc()).limit(50).all())
    masking = is_enabled(ctx.db, "pii_masking")
    ctx.emit("loyalty.view", "loyalty", resource=_resource(account))
    ctx.db.commit()
    return {**_account_view(account, guest, masking), "transactions": [_txn_view(t) for t in txns]}


class AdjustIn(BaseModel):
    points: int
    reason: str = Field(min_length=3, max_length=200)


@router.post("/accounts/{account_id}/adjust")
def adjust_points(account_id: str, body: AdjustIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("loyalty.adjust", "loyalty.adjust", "loyalty")
    account = ctx.db.get(LoyaltyAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail={"error": "account_not_found"})
    if account.frozen:
        ctx.deny("loyalty.adjust", "loyalty", 423, "Loyalty account is frozen", resource=_resource(account),
                 extra={"code": "account_frozen"})
    if account.points_balance + body.points < 0:
        raise HTTPException(status_code=422, detail={"error": "balance_would_be_negative"})
    account.points_balance += body.points
    _record(ctx, account, "adjust", body.points, body.reason)
    ctx.emit("loyalty.adjust", "loyalty", resource=_resource(account),
             details={"points": body.points, "reason": body.reason, "new_balance": account.points_balance})
    ctx.db.commit()
    return {"account_id": account.id, "balance": account.points_balance}


class RedeemIn(BaseModel):
    points: int = Field(gt=0)
    description: str = Field(default="Reward redemption", max_length=200)


class TransferIn(BaseModel):
    to_account_id: str
    points: int = Field(gt=0)


@router.post("/accounts/{account_id}/redeem")
def staff_redeem(account_id: str, body: RedeemIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("loyalty.redeem", "loyalty.redeem", "loyalty")
    account = ctx.db.get(LoyaltyAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail={"error": "account_not_found"})
    return do_redeem(ctx, account, body.points, body.description)


@router.post("/accounts/{account_id}/transfer")
def staff_transfer(account_id: str, body: TransferIn, ctx: Ctx = Depends(get_staff_ctx)):
    ctx.require("loyalty.redeem", "loyalty.transfer", "loyalty")
    account = ctx.db.get(LoyaltyAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail={"error": "account_not_found"})
    return do_transfer(ctx, account, body.to_account_id, body.points)


# ------------------------------ guest portal ------------------------------

class PortalLoginIn(BaseModel):
    email: str
    password: str


class ResetRequestIn(BaseModel):
    email: str


class ResetConfirmIn(BaseModel):
    reset_token: str
    new_password: str = Field(min_length=8)


class ChangeEmailIn(BaseModel):
    new_email: str


@portal.post("/login")
def portal_login(body: PortalLoginIn, request: Request, db: Session = Depends(get_db)):
    account = db.query(LoyaltyAccount).filter(LoyaltyAccount.portal_email == body.email.strip().lower()).first()
    if account is None or not security.verify_password(body.password, account.portal_password_hash):
        ctx = Ctx(db, request, basic_actor(request, "guest", account.id if account else None))
        ctx.deny("auth.guest_login_failed", "auth", 401, "Invalid credentials",
                 extra={"code": "invalid_credentials"},
                 resource={"type": "loyalty_account", "attempted_email_domain": body.email.partition("@")[2][:80]})
    ctx = Ctx(db, request, basic_actor(request, "guest", account.id), account=account)
    ctx.emit("auth.guest_login_success", "auth", resource=_resource(account))
    db.commit()
    return {"access_token": security.create_token(account.id, "guest", 120), "token_type": "bearer"}


@portal.post("/password-reset")
def portal_reset_request(body: ResetRequestIn, request: Request, db: Session = Depends(get_db)):
    account = db.query(LoyaltyAccount).filter(LoyaltyAccount.portal_email == body.email.strip().lower()).first()
    if account is None:
        return {"ok": True}  # do not reveal whether the email exists
    ctx = Ctx(db, request, basic_actor(request, "guest", account.id), account=account)
    ctx.emit("auth.guest_password_reset_requested", "auth", resource=_resource(account))
    db.commit()
    # Demo shortcut: in production this token would only be emailed to the account holder.
    return {"ok": True, "reset_token": security.create_token(account.id, "guest_reset", 15)}


@portal.post("/password-reset/confirm")
def portal_reset_confirm(body: ResetConfirmIn, request: Request, db: Session = Depends(get_db)):
    try:
        claims = security.decode_token(body.reset_token, expected_type="guest_reset")
    except security.TokenError:
        raise HTTPException(status_code=401, detail={"error": "invalid_reset_token"})
    account = db.get(LoyaltyAccount, claims["sub"])
    if account is None:
        raise HTTPException(status_code=401, detail={"error": "invalid_reset_token"})
    account.portal_password_hash = security.hash_password(body.new_password)
    ctx = Ctx(db, request, basic_actor(request, "guest", account.id), account=account)
    ctx.emit("auth.guest_password_reset", "auth", resource=_resource(account))
    db.commit()
    return {"ok": True}


@portal.get("/me")
def portal_me(ctx: Ctx = Depends(get_guest_ctx)):
    account = ctx.account
    guest = ctx.db.get(Guest, account.guest_id)
    txns = (ctx.db.query(LoyaltyTransaction).filter(LoyaltyTransaction.account_id == account.id)
            .order_by(LoyaltyTransaction.id.desc()).limit(20).all())
    return {**_account_view(account, guest, masking=False), "transactions": [_txn_view(t) for t in txns]}


@portal.post("/change-email")
def portal_change_email(body: ChangeEmailIn, ctx: Ctx = Depends(get_guest_ctx)):
    new_email = body.new_email.strip().lower()
    if "@" not in new_email:
        raise HTTPException(status_code=422, detail={"error": "invalid_email"})
    if ctx.db.query(LoyaltyAccount).filter(LoyaltyAccount.portal_email == new_email).first():
        raise HTTPException(status_code=409, detail={"error": "email_in_use"})
    account = ctx.account
    old_domain = account.portal_email.partition("@")[2]
    account.portal_email = new_email
    account.contact_changed_at = security.utcnow()
    ctx.emit("loyalty.contact_changed", "loyalty", resource=_resource(account),
             details={"field": "email", "old_domain": old_domain, "new_domain": new_email.partition("@")[2]})
    ctx.db.commit()
    return {"ok": True, "portal_email": new_email}


@portal.post("/redeem")
def portal_redeem(body: RedeemIn, ctx: Ctx = Depends(get_guest_ctx)):
    return do_redeem(ctx, ctx.account, body.points, body.description)


@portal.post("/transfer")
def portal_transfer(body: TransferIn, ctx: Ctx = Depends(get_guest_ctx)):
    return do_transfer(ctx, ctx.account, body.to_account_id, body.points)
