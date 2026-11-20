"""Container start-up: wait for the database, create tables, and seed demo data if the database is empty.

Seeding only runs when SEED_IF_EMPTY=true (set on the demo environment). Used by the Docker CMD before uvicorn.
"""

import os
import subprocess
import sys
import time

from sqlalchemy import inspect, text

from app.db import Base, engine


def wait_for_db(timeout: int = 180) -> None:
    deadline = time.time() + timeout
    while True:
        try:
            with engine.connect() as conn:
                conn.execute(text("select 1"))
            return
        except Exception as exc:  # noqa: BLE001 - keep retrying until the DB is reachable
            if time.time() > deadline:
                raise SystemExit(f"database not reachable after {timeout}s: {exc}")
            print(f"waiting for database: {type(exc).__name__}", flush=True)
            time.sleep(3)


def is_empty() -> bool:
    if not inspect(engine).has_table("properties"):
        return True
    with engine.connect() as conn:
        return conn.execute(text("select count(*) from properties")).scalar() == 0


def main() -> None:
    wait_for_db()
    if is_empty() and os.environ.get("SEED_IF_EMPTY", "false").lower() == "true":
        print("database is empty: seeding demo data", flush=True)
        subprocess.run([sys.executable, "-m", "scripts.seed", "--reset"], check=True)
    else:
        Base.metadata.create_all(engine)
    print("bootstrap complete", flush=True)


if __name__ == "__main__":
    main()
