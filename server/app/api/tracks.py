import asyncio
from pathlib import Path

import aiofiles
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.jobs.runner import run_job
from app.media import MEDIA_TYPES, iter_bytes, parse_range
from app.storage import ConflictError, NotFoundError
from mutr_core.media import ALLOWED_EXTS
from mutr_core.paths import ensure_unique_file
from mutr_core.stems import DEFAULT_MODEL, DEFAULT_SHIFTS, MODELS

router = APIRouter()


class TrackPatch(BaseModel):
    volume: float | None = None
    muted: bool | None = None
    name: str | None = None


class RemoveTrackBody(BaseModel):
    delete_file: bool = False


class PitchBody(BaseModel):
    semitones: float


class StemsBody(BaseModel):
    model: str | None = None
    shifts: int | None = None


class YtdlBody(BaseModel):
    url: str
    quality: int = 1080
    audio_only: bool = False
    container: str = "mp4"


class MergeBody(BaseModel):
    indices: list[int]


class BulkDeleteBody(BaseModel):
    indices: list[int]
    delete_files: bool = False


@router.post("/projects/{name}/tracks/upload")
async def upload_tracks(name: str, request: Request, files: list[UploadFile] = File(...)):
    storage = request.app.state.storage
    try:
        project_dir, _ = storage.require(name)
    except NotFoundError:
        raise HTTPException(404, "project not found")
    saved: list[Path] = []
    for up in files:
        filename = Path(up.filename or "").name
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTS:
            raise HTTPException(400, f"Unsupported file type: {ext or '(none)'}")
        dest = ensure_unique_file(project_dir, filename)
        async with aiofiles.open(dest, "wb") as f:
            while chunk := await up.read(1024 * 1024):
                await f.write(chunk)
        saved.append(dest)
    tracks = storage.add_tracks(name, [p.name for p in saved])
    waveforms = {}
    for path in saved:
        data = await asyncio.to_thread(request.app.state.waveform_cache.get, name, path)
        waveforms[path.name] = {"peaks": data["peaks"], "duration_ms": data["duration_ms"]}
    return {"tracks": tracks, "waveforms": waveforms}


@router.patch("/projects/{name}/tracks/{idx}")
def patch_track(name: str, idx: int, body: TrackPatch, request: Request):
    storage = request.app.state.storage
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        return storage.update_track(name, idx, patch)
    except NotFoundError as e:
        raise HTTPException(404, str(e))
    except ConflictError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/projects/{name}/tracks/{idx}", status_code=204)
def delete_track(name: str, idx: int, body: RemoveTrackBody, request: Request):
    storage = request.app.state.storage
    try:
        storage.remove_track(name, idx, body.delete_file)
    except NotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/projects/{name}/media/{filename:path}")
async def media(name: str, filename: str, request: Request):
    storage = request.app.state.storage
    try:
        base, _ = storage.require(name)
    except NotFoundError:
        raise HTTPException(404, "project not found")
    path = (base / filename).resolve()
    if not path.is_relative_to(base.resolve()):
        raise HTTPException(403, "forbidden")
    if not path.is_file():
        raise HTTPException(404, "file not found")
    size = path.stat().st_size
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    headers = {"Accept-Ranges": "bytes", "Content-Disposition": "inline"}
    range_header = request.headers.get("range")
    if range_header is not None:
        parsed = parse_range(range_header, size)
        if parsed is None:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        start, end = parsed
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return StreamingResponse(
            iter_bytes(path, start, end), status_code=206,
            headers=headers, media_type=media_type,
        )
    return StreamingResponse(
        iter_bytes(path, 0, size - 1), headers=headers, media_type=media_type,
    )


@router.post("/projects/{name}/tracks/merge")
def merge_tracks_endpoint(name: str, body: MergeBody, request: Request, background_tasks: BackgroundTasks):
    storage = request.app.state.storage
    indices = sorted(set(body.indices))
    if len(indices) < 2:
        raise HTTPException(400, "select at least two tracks")
    try:
        for i in indices:
            storage.track(name, i)
    except NotFoundError as e:
        raise HTTPException(404, str(e))
    track0 = storage.track(name, indices[0])
    job = request.app.state.job_manager.create("merge", name, indices[0], track0["file"])
    background_tasks.add_task(run_job, request.app, job, {"indices": indices})
    return {"job_id": job.id}


@router.post("/projects/{name}/tracks/delete", status_code=204)
def bulk_delete_tracks(name: str, body: BulkDeleteBody, request: Request):
    storage = request.app.state.storage
    try:
        storage.require(name)
        storage.remove_tracks(name, body.indices, body.delete_files)
    except NotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/projects/{name}/waveforms/{idx}")
async def waveform(name: str, idx: int, request: Request):
    storage = request.app.state.storage
    try:
        track = storage.track(name, idx)
        base, _ = storage.require(name)
    except NotFoundError as e:
        raise HTTPException(404, str(e))
    file_path = (base / track["file"]).resolve()
    if not file_path.is_file():
        raise HTTPException(404, "track file not found")
    data = await asyncio.to_thread(request.app.state.waveform_cache.get, name, file_path)
    return {"peaks": data["peaks"], "duration_ms": data["duration_ms"]}


@router.post("/projects/{name}/tracks/{idx}/pitch")
def pitch_track(name: str, idx: int, body: PitchBody, request: Request, background_tasks: BackgroundTasks):
    storage = request.app.state.storage
    try:
        track = storage.track(name, idx)
    except NotFoundError as e:
        raise HTTPException(404, str(e))
    if body.semitones == 0 or not -12 <= body.semitones <= 12:
        raise HTTPException(400, "semitones must be within ±12 and non-zero")
    job = request.app.state.job_manager.create("pitch", name, idx, track["file"])
    background_tasks.add_task(run_job, request.app, job, {"semitones": body.semitones})
    return {"job_id": job.id}


@router.post("/projects/{name}/tracks/{idx}/stems")
def stems_track(name: str, idx: int, body: StemsBody, request: Request, background_tasks: BackgroundTasks):
    storage = request.app.state.storage
    try:
        track = storage.track(name, idx)
    except NotFoundError as e:
        raise HTTPException(404, str(e))
    model = body.model or DEFAULT_MODEL
    if model not in [m[0] for m in MODELS]:
        raise HTTPException(400, "unknown model")
    shifts = body.shifts if body.shifts is not None else DEFAULT_SHIFTS
    if not 0 <= shifts <= 20:
        raise HTTPException(400, "shifts must be 0-20")
    job = request.app.state.job_manager.create("stems", name, idx, track["file"])
    background_tasks.add_task(run_job, request.app, job, {"model": model, "shifts": shifts})
    return {"job_id": job.id}


@router.post("/projects/{name}/tracks/ytdl")
def ytdl_track(name: str, body: YtdlBody, request: Request, background_tasks: BackgroundTasks):
    storage = request.app.state.storage
    try:
        storage.require(name)
    except NotFoundError:
        raise HTTPException(404, "project not found")
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, "invalid url")
    if body.container not in ("mkv", "mp4"):
        raise HTTPException(400, "container must be mkv or mp4")
    job = request.app.state.job_manager.create("ytdl", name, -1, "")
    background_tasks.add_task(
        run_job, request.app, job,
        {"url": body.url, "quality": body.quality, "audio_only": body.audio_only,
         "container": body.container},
    )
    return {"job_id": job.id}
