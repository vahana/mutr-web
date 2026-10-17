import asyncio
import contextlib
import shutil

from mutr_core.media import is_video
from mutr_core.merge import merge_tracks
from mutr_core.pitch import pitch_path, pitch_shift
from mutr_core.paths import ensure_unique_file
from mutr_core.process import CancelledError
from mutr_core.stems import (
    DEFAULT_MODEL, DEFAULT_SHIFTS, STEM_ORDER, parse_demucs_progress, split_stems,
)
from mutr_core.ytdl import download, parse_ytdlp_progress


@contextlib.asynccontextmanager
async def _acquire(sem, job, manager, message):
    if sem.locked():
        manager.emit(job, "waiting", message=message)
    acquired = False
    try:
        while not acquired:
            if manager.cancel_event(job.id).is_set():
                raise CancelledError()
            try:
                await asyncio.wait_for(sem.acquire(), timeout=0.5)
                acquired = True
            except asyncio.TimeoutError:
                continue
        yield
    finally:
        if acquired:
            sem.release()


def _emit_progress(manager, job, line, parse=None):
    progress = parse(line) if parse is not None else None
    manager.emit(job, "progress", progress=progress, message=line)


def _pitch_job(app, job, params):
    storage = app.state.storage
    manager = app.state.job_manager
    cancel = manager.cancel_event(job.id)
    base, _ = storage.require(job.project)
    src = (base / job.track_filename).resolve()
    if not src.is_file():
        raise RuntimeError("track file not found")
    semitones = int(params["semitones"])
    out = pitch_path(src, semitones)
    try:
        pitch_shift(src, out, semitones,
                    on_line=lambda line: _emit_progress(manager, job, line),
                    cancel=cancel)
    except CancelledError:
        out.unlink(missing_ok=True)
        raise
    data = storage.get_project(job.project)
    src_track = next((t for t in data["tracks"] if t["file"] == job.track_filename), None)
    if src_track is None:
        out.unlink(missing_ok=True)
        raise RuntimeError("source track no longer exists")
    sign = "+" if semitones > 0 else ""
    return {"files": [out.name], "names": [f"{src_track['name']} {sign}{semitones} st"]}


def _stems_job(app, job, params):
    storage = app.state.storage
    manager = app.state.job_manager
    cancel = manager.cancel_event(job.id)
    base, _ = storage.require(job.project)
    src = (base / job.track_filename).resolve()
    if not src.is_file():
        raise RuntimeError("track file not found")
    stems = split_stems(
        src, base,
        model=params["model"], shifts=params["shifts"],
        on_line=lambda line: _emit_progress(manager, job, line, parse_demucs_progress),
        cancel=cancel,
    )
    ordered = sorted(
        stems.items(),
        key=lambda kv: STEM_ORDER.index(kv[0]) if kv[0] in STEM_ORDER else len(STEM_ORDER),
    )
    return {"files": [p.name for _, p in ordered], "names": [n.capitalize() for n, _ in ordered]}


def _ytdl_job(app, job, params):
    storage = app.state.storage
    manager = app.state.job_manager
    cancel = manager.cancel_event(job.id)
    base, _ = storage.require(job.project)
    free_gb = shutil.disk_usage(base).free / (1024**3)
    if free_gb < 2:
        raise RuntimeError(f"not enough free disk space: {free_gb:.1f} GB free (2 GB required)")
    path = download(
        params["url"], base,
        quality=params["quality"], audio_only=params["audio_only"],
        container=params.get("container", "mp4"),
        on_line=lambda line: _emit_progress(manager, job, line, parse_ytdlp_progress),
        cancel=cancel,
    )
    return {"files": [path.name], "names": [path.stem]}


def _merge_job(app, job, params):
    storage = app.state.storage
    manager = app.state.job_manager
    cancel = manager.cancel_event(job.id)
    base, _ = storage.require(job.project)
    indices = params["indices"]
    if len(indices) < 2:
        raise RuntimeError("select at least two tracks to merge")
    data = storage.get_project(job.project)
    tracks = [data["tracks"][i] for i in indices]
    files = [base / t["file"] for t in tracks]
    for p in files:
        if not p.is_file():
            raise RuntimeError(f"track file not found: {p.name}")
    video_file = next((p for p, t in zip(files, tracks) if is_video(p)), None)
    audio_files = [p for p, t in zip(files, tracks) if not is_video(p)]
    if video_file is not None and not audio_files:
        raise RuntimeError("no audio tracks selected for the mix")
    first = tracks[0]
    ext = ".mp4" if video_file is not None else ".wav"
    out = ensure_unique_file(base, f"{first['name']} mix{ext}")
    merge_tracks(
        audio_files, out,
        on_line=lambda line: _emit_progress(manager, job, line),
        cancel=cancel,
        video=video_file,
    )
    return {"files": [out.name], "names": [f"{first['name']} mix"]}


async def _apply_result(app, job, result):
    manager = app.state.job_manager
    storage = app.state.storage
    files = result["files"]
    names = result["names"]
    added = storage.add_tracks(job.project, files, names)
    base, _ = storage.require(job.project)
    waveforms = {}
    for t, fname in zip(added, files):
        data = await asyncio.to_thread(app.state.waveform_cache.get, job.project, base / fname)
        waveforms[fname] = {"peaks": data["peaks"], "duration_ms": data["duration_ms"]}
    manager.set_status(job, "done")
    manager.emit(job, "done", added_tracks=added, waveforms=waveforms)


async def _run_guarded(app, job, params):
    manager = app.state.job_manager
    manager.set_status(job, "running")
    loop = asyncio.get_running_loop()
    if job.kind == "stems":
        return await loop.run_in_executor(app.state.job_executor, _stems_job, app, job, params)
    if job.kind == "ytdl":
        return await loop.run_in_executor(app.state.job_executor, _ytdl_job, app, job, params)
    if job.kind == "merge":
        return await loop.run_in_executor(app.state.job_executor, _merge_job, app, job, params)
    return await loop.run_in_executor(app.state.job_executor, _pitch_job, app, job, params)


async def run_job(app, job, params):
    manager = app.state.job_manager
    try:
        if job.kind == "stems":
            async with _acquire(app.state.stems_slot, job, manager, "waiting for the stem-split slot…"):
                async with _acquire(app.state.job_slots, job, manager, "waiting for a free slot…"):
                    result = await _run_guarded(app, job, params)
        else:
            async with _acquire(app.state.job_slots, job, manager, "waiting for a free slot…"):
                result = await _run_guarded(app, job, params)
    except CancelledError:
        manager.set_status(job, "cancelled")
        manager.emit(job, "cancelled", message="cancelled")
        return
    except Exception as e:
        manager.set_status(job, "error")
        manager.emit(job, "error", message=str(e))
        return
    await _apply_result(app, job, result)
