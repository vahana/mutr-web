import itertools
import threading
import time
import uuid
from dataclasses import dataclass, field

TERMINAL = ("done", "error", "cancelled")
_MAX_EVENTS = 500


@dataclass
class Job:
    id: str
    kind: str
    project: str
    track_index: int
    track_filename: str
    status: str = "queued"
    progress: float | None = None
    message: str = ""
    error: str = ""
    added_tracks: list = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    events: list = field(default_factory=list)


def to_dict(job: Job) -> dict:
    return {
        "id": job.id,
        "kind": job.kind,
        "project": job.project,
        "track_index": job.track_index,
        "track_filename": job.track_filename,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
        "added_tracks": job.added_tracks,
        "created_at": job.created_at,
    }


class JobManager:
    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._event_counter = itertools.count(1)

    def create(self, kind: str, project: str, track_index: int, track_filename: str) -> Job:
        job = Job(
            id=uuid.uuid4().hex[:8], kind=kind, project=project,
            track_index=track_index, track_filename=track_filename,
        )
        with self._lock:
            self._jobs[job.id] = job
            self._cancel_events[job.id] = threading.Event()
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[dict]:
        with self._lock:
            jobs = list(self._jobs.values())
        return [to_dict(j) for j in jobs]

    def cancel_event(self, job_id: str) -> threading.Event | None:
        with self._lock:
            return self._cancel_events.get(job_id)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            ev = self._cancel_events.get(job_id)
            if ev is None:
                return False
            ev.set()
            return True

    def set_status(self, job: Job, status: str) -> None:
        with self._lock:
            job.status = status

    def emit(self, job: Job, event: str, **data) -> int:
        with self._lock:
            ev = {"id": next(self._event_counter), "event": event, "data": data}
            job.events.append(ev)
            del job.events[:-_MAX_EVENTS]
            if event == "progress":
                job.message = data.get("message", job.message)
                if "progress" in data:
                    job.progress = data["progress"]
            elif event == "error":
                job.error = data.get("message", "")
            elif event == "done":
                job.added_tracks = data.get("added_tracks", [])
            return ev["id"]
