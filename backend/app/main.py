import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, text

from .config import get_settings
from .db import Base, SessionLocal, engine
from .models import EventOutbox
from .policy import ensure_policies
from .routers import admin, auth, folio, guests, loyalty, partner, reservations, service
from .shipper import OutboxShipper

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        ensure_policies(db)
        db.commit()
    shipper = OutboxShipper()
    shipper.start()
    yield
    shipper.stop()


app = FastAPI(
    title="StayDesk HM Service",
    version="0.1.0",
    description="Hotel management backend with built-in security controls and security event emission.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Request-Id", "X-Export-Count"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    return response


for module_router in (
    auth.router, reservations.router, guests.router, guests.docs_router, folio.router, loyalty.router,
    loyalty.portal, partner.router, admin.router, service.context, service.control,
):
    app.include_router(module_router)


@app.get("/health", tags=["ops"])
def health():
    with SessionLocal() as db:
        db.execute(text("select 1"))
        backlog = db.execute(select(func.count()).select_from(EventOutbox).where(EventOutbox.sent_at.is_(None))).scalar()
    return {"status": "ok", "env": settings.env, "event_sinks": settings.sink_list, "outbox_backlog": backlog}
