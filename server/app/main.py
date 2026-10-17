import asyncio
import contextlib
import shutil
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import jobs, projects, tracks
from app.config import Settings
from app.jobs.executor import DaemonExecutor
from app.jobs.manager import JobManager
from app.storage import Storage
from app.waveform import WaveformCache


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    manager = app.state.job_manager
    for job_id in manager.active_ids():
        manager.cancel(job_id)
    await asyncio.sleep(1.0)
    app.state.job_executor.shutdown(wait=True, cancel_futures=True)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="mutr-web", lifespan=lifespan)
    app.state.settings = settings
    app.state.storage = Storage(settings)
    app.state.waveform_cache = WaveformCache(settings)
    app.state.job_manager = JobManager()
    app.state.job_executor = DaemonExecutor()
    app.state.job_slots = asyncio.Semaphore(2)
    app.state.stems_slot = asyncio.Semaphore(1)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(projects.router, prefix="/api")
    app.include_router(tracks.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")

    @app.get("/api/health")
    def health():
        usage = shutil.disk_usage(settings.data_dir)
        jobs = app.state.job_manager.list()
        return {
            "ok": True,
            "ffmpeg": bool(shutil.which("ffmpeg")),
            "rubberband": bool(shutil.which("rubberband")),
            "demucs": bool(shutil.which("uv")),
            "ytdlp": bool(shutil.which("yt-dlp")),
            "data_dir": str(settings.data_dir),
            "disk_free_gb": round(usage.free / (1024**3), 1),
            "jobs_running": sum(1 for j in jobs if j["status"] == "running"),
            "jobs_queued": sum(1 for j in jobs if j["status"] == "queued"),
        }

    app.mount("/media", StaticFiles(directory=settings.projects_dir), name="media")

    web_dist = Path(__file__).resolve().parent.parent.parent / "web" / "dist"
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")

    return app


app = create_app()
