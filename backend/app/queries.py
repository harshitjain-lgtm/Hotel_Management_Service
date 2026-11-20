from dataclasses import asdict, dataclass
from datetime import date

from sqlalchemy import Select, func, or_, select

from .models import Guest, LoyaltyAccount, Reservation

RESERVATION_SORTS = {
    "arrival_desc": lambda: [Reservation.arrival.desc(), Reservation.id],
    "arrival_asc": lambda: [Reservation.arrival.asc(), Reservation.id],
    "amount_desc": lambda: [Reservation.total_amount.desc(), Reservation.id],
    "created_desc": lambda: [Reservation.created_at.desc(), Reservation.id],
    "loyalty_points_desc": lambda: [func.coalesce(LoyaltyAccount.points_balance, 0).desc(), Reservation.id],
}


@dataclass
class ReservationFilters:
    property: str | None = None
    status: str | None = None
    q: str | None = None
    arrival_from: date | None = None
    arrival_to: date | None = None
    channel: str | None = None
    sort: str = "arrival_desc"

    def as_query(self) -> dict:
        return {k: (v.isoformat() if isinstance(v, date) else v) for k, v in asdict(self).items() if v is not None}


def reservation_query(filters: ReservationFilters, scope: list[str] | None) -> Select:
    stmt = (
        select(Reservation, Guest, LoyaltyAccount)
        .join(Guest, Guest.id == Reservation.guest_id)
        .outerjoin(LoyaltyAccount, LoyaltyAccount.guest_id == Guest.id)
    )
    if scope is not None:
        stmt = stmt.where(Reservation.property_id.in_(scope))
    if filters.property:
        stmt = stmt.where(Reservation.property_id == filters.property)
    if filters.status:
        stmt = stmt.where(Reservation.status == filters.status)
    if filters.channel:
        stmt = stmt.where(Reservation.channel == filters.channel)
    if filters.arrival_from:
        stmt = stmt.where(Reservation.arrival >= filters.arrival_from)
    if filters.arrival_to:
        stmt = stmt.where(Reservation.arrival <= filters.arrival_to)
    if filters.q:
        like = f"%{filters.q.strip()}%"
        stmt = stmt.where(or_(
            Reservation.id.ilike(like),
            Guest.first_name.ilike(like),
            Guest.last_name.ilike(like),
            (Guest.first_name + " " + Guest.last_name).ilike(like),
            Guest.email.ilike(like),
            Guest.phone.ilike(like),
        ))
    order = RESERVATION_SORTS.get(filters.sort, RESERVATION_SORTS["arrival_desc"])()
    return stmt.order_by(*order)


def count_rows(db, stmt: Select) -> int:
    return db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()
