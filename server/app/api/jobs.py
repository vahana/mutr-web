import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.jobs.manager import TERMINAL, to_dict

router = APIRouter()


def _parse_last_event_id(header: str | None) -> int:
    if not header:
        return 0
    try:
        return int(header)
    except ValueError:
        return 0


def _sse(ev: dict) -> str:
    return f"id: {ev['id']}\nevent: {ev['event']}\ndata: {json.dumps(ev['data'])}\n\n"


@router.get("/jobs")
def list_jobs(request: Request):
    return request.app.state.job_manager.list()


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request):
    job = request.app.state.job_manager.get(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return to_dict(job)


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request):
    manager = request.app.state.job_manager
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    last_id = _parse_last_event_id(request.headers.get("last-event-id"))

    async def gen():
        nonlocal last_id
        ticks = 0
        while True:
            with manager._lock:
                events = [e for e in job.events if e["id"] > last_id]
                terminal = job.status in TERMINAL
            for ev in events:
                yield _sse(ev)
                last_id = ev["id"]
            if terminal:
                break
            ticks += 1
            if ticks % 60 == 0:
                yield ": ping\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/jobs/{job_id}/cancel", status_code=204)
def cancel_job(job_id: str, request: Request):
    manager = request.app.state.job_manager
    if not manager.cancel(job_id):
        raise HTTPException(404, "job not found")
