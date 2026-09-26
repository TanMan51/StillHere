"""App setup: routers, CORS, startup, and the built dashboard. Owner: Person A.

Run locally from backend/:  uvicorn app.main:app --reload
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import checker, config
from .api import contacts, demo, devices, events
from .db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    checker.start()
    yield
    checker.stop()


app = FastAPI(title="StillHere", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(contacts.router, prefix="/api")
app.include_router(demo.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True}


def mount_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built dashboard. Unknown paths get index.html so React Router's
    client-side routes (like /demo) survive a reload."""
    root = dist.resolve()
    app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        file = (root / path).resolve()
        if path and file.is_file() and file.is_relative_to(root):
            return FileResponse(file)
        return FileResponse(root / "index.html")


# Must stay last: the catch-all route answers everything the API routes above don't.
if (config.FRONTEND_DIST / "index.html").is_file():
    mount_frontend(app, config.FRONTEND_DIST)
