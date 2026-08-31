import asyncio

from mutr_core.pitch import pitch_path, pitch_shift
from mutr_core.process import CancelledError
from mutr_core.stems import (
    DEFAULT_MODEL, DEFAULT_SHIFTS, STEM_ORDER, parse_demucs_progress, split_stems,
)
from mutr_core.ytdl import download, parse_ytdlp_progress

_stems_sem = asyncio.Semaphore(2)


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
    path = download(
        params["url"], base,
        quality=params["quality"], audio_only=params["audio_only"],
        on_line=lambda line: _emit_progress(manager, job, line, parse_ytdlp_progress),
        cancel=cancel,
    )
    return {"files": [path.name], "names": [path.stem]}


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


async def run_job(app, job, params):
    manager = app.state.job_manager
    manager.set_status(job, "running")
    try:
        if job.kind == "stems":
            async with _stems_sem:
                result = await asyncio.to_thread(_stems_job, app, job, params)
        elif job.kind == "ytdl":
            result = await asyncio.to_thread(_ytdl_job, app, job, params)
        else:
            result = await asyncio.to_thread(_pitch_job, app, job, params)
    except CancelledError:
        manager.set_status(job, "cancelled")
        manager.emit(job, "cancelled", message="cancelled")
        return
    except Exception as e:
        manager.set_status(job, "error")
        manager.emit(job, "error", message=str(e))
        return
    await _apply_result(app, job, result)
