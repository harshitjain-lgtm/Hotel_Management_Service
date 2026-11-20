import logging
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import replace

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select, text
from starlette.concurrency import run_in_threadpool

from . import audit, security
from .config import get_settings
from .db import Base, SessionLocal, engine
from .deps import CONTRACT_MESSAGES, ApiError, basic_actor, client_ip, request_meta
from .hms_events import emit_all_reference
from .models import BlockedIp, EventOutbox
from .policy import ensure_policies
from .routers import admin, auth, folio, guests, loyalty, partner, reservations, security_actions, service
from .shipper import OutboxShipper

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()
log = logging.getLogger("staydesk")

# Paths that are never subject to IP blocking (STAYSEC must always reach its action endpoint).
IP_BLOCK_EXEMPT = ("/internal/security/actions", "/health", "/docs", "/openapi.json", "/redoc")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        ensure_policies(db)
        sent = emit_all_reference(db)  # contract: reference.* at startup
        db.commit()
    log.info("queued %s reference events", sent)
    shipper = OutboxShipper()
    shipper.start()
    yield
    shipper.stop()


app = FastAPI(
    title="StayDesk HM Service",
    version="0.2.0",
    description="Hotel management backend with built-in security controls, STAYSEC v1.0 event publishing "
                "and the STAYSEC action endpoint.",
    lifespan=lifespan,
)


def _blocked_ip_response(request: Request, ip: str) -> JSONResponse | None:
    with SessionLocal() as db:
        now = security.utcnow()
        blocked = db.execute(select(BlockedIp).where(BlockedIp.ip == ip, or_(BlockedIp.until.is_(None), BlockedIp.until > now))).scalar()
        if blocked is None:
            return None
        audit.emit(db, action="network.ip_blocked", category="auth", actor=basic_actor(request, "anonymous", None),
                   request=replace(request_meta(request), status_code=403),
                   outcome="denied", reason="Request from blocked IP", code="IP_BLOCKED",
                   details={"revoked_by": f"staysec:{blocked.action_id}" if blocked.action_id else None})
        db.commit()
    return JSONResponse(status_code=403, content={"error": "IP_BLOCKED", "message": CONTRACT_MESSAGES["IP_BLOCKED"],
                                                  "detail": {"code": "ip_blocked", "reason": "Request from blocked IP"}})


# Registered before CORS so CORS stays the outermost middleware (403s still carry CORS headers).
@app.middleware("http")
async def guard_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.started = time.perf_counter()
    if request.method != "OPTIONS" and not request.url.path.startswith(IP_BLOCK_EXEMPT):
        ip = client_ip(request)
        if ip:
            blocked = await run_in_threadpool(_blocked_ip_response, request, ip)
            if blocked is not None:
                blocked.headers["X-Request-Id"] = request.state.request_id
                return blocked
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Request-Id", "X-Export-Count"],
)


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status_code, content=exc.body)


for module_router in (
    auth.router, reservations.router, guests.router, guests.docs_router, folio.router, loyalty.router,
    loyalty.portal, partner.router, admin.router, service.context, service.control, security_actions.router,
):
    app.include_router(module_router)


@app.get("/health", tags=["ops"])
def health():
    with SessionLocal() as db:
        db.execute(text("select 1"))
        backlog = db.execute(select(func.count()).select_from(EventOutbox).where(EventOutbox.sent_at.is_(None))).scalar()
    return {"status": "ok", "env": settings.env, "event_format": settings.event_format,
            "event_sinks": settings.sink_list, "outbox_backlog": backlog}
