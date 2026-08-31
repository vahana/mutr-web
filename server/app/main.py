import shutil
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import jobs, projects, tracks
from app.config import Settings
from app.jobs.manager import JobManager
from app.storage import Storage
from app.waveform import WaveformCache


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="mutr-web")
    app.state.settings = settings
    app.state.storage = Storage(settings)
    app.state.waveform_cache = WaveformCache(settings)
    app.state.job_manager = JobManager()
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
        return {
            "ok": True,
            "ffmpeg": bool(shutil.which("ffmpeg")),
            "rubberband": bool(shutil.which("rubberband")),
            "demucs": bool(shutil.which("uv")),
            "ytdlp": bool(shutil.which("yt-dlp")),
            "data_dir": str(settings.data_dir),
        }

    app.mount("/media", StaticFiles(directory=settings.projects_dir), name="media")

    web_dist = Path(__file__).resolve().parent.parent.parent / "web" / "dist"
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")

    return app


app = create_app()
