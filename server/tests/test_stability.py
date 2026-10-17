import itertools
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    settings = Settings(tmp_path)
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def _project(client, name=None):
    r = client.post("/api/projects", json={"name": name} if name else {})
    assert r.status_code == 200, r.text
    return r.json()["name"]


def _wait_until(fn, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(0.05)
    raise TimeoutError("condition not met in time")


def _wait_status(client, job_id, status, timeout=10):
    return _wait_until(
        lambda: client.get(f"/api/jobs/{job_id}").json()["status"] == status
        and client.get(f"/api/jobs/{job_id}").json(),
        timeout,
    )


def _add_dummy_tracks(client, name, count):
    d = client.app.state.settings.projects_dir / name
    names = [f"t{i}.wav" for i in range(count)]
    for f in names:
        (d / f).write_bytes(b"x")
    client.app.state.storage.add_tracks(name, names)
    return d, names


def _fake_result(app, job, params, counter):
    base, _ = app.state.storage.require(job.project)
    fname = f"out{next(counter)}.wav"
    (base / fname).write_bytes(b"x")
    return {"files": [fname], "names": [fname]}


def _job_statuses(client):
    return {j["id"]: j["status"] for j in client.get("/api/jobs").json()}


def test_global_job_cap_two_running_one_queued(client, monkeypatch):
    name = _project(client)
    _add_dummy_tracks(client, name, 3)
    gate = threading.Event()
    counter = itertools.count()

    def blocked_pitch(app, job, params):
        gate.wait(10)
        return _fake_result(app, job, params, counter)

    monkeypatch.setattr("app.jobs.runner._pitch_job", blocked_pitch)

    job_ids = []
    for i in range(3):
        r = client.post(f"/api/projects/{name}/tracks/{i}/pitch", json={"semitones": 1})
        assert r.status_code == 200
        job_ids.append(r.json()["job_id"])

    _wait_until(lambda: sorted(_job_statuses(client).values()) == ["queued", "running", "running"])

    manager = client.app.state.job_manager
    queued = [jid for jid in job_ids if manager.get(jid).status == "queued"]
    assert len(queued) == 1
    events = [e["event"] for e in manager.get(queued[0]).events]
    assert "waiting" in events

    gate.set()
    for jid in job_ids:
        _wait_status(client, jid, "done")


def test_cancel_while_waiting_for_slot(client, monkeypatch):
    name = _project(client)
    _add_dummy_tracks(client, name, 3)
    gate = threading.Event()
    counter = itertools.count()

    def blocked_pitch(app, job, params):
        gate.wait(10)
        return _fake_result(app, job, params, counter)

    monkeypatch.setattr("app.jobs.runner._pitch_job", blocked_pitch)

    job_ids = []
    for i in range(3):
        r = client.post(f"/api/projects/{name}/tracks/{i}/pitch", json={"semitones": 1})
        job_ids.append(r.json()["job_id"])

    _wait_until(lambda: sorted(_job_statuses(client).values()) == ["queued", "running", "running"])
    manager = client.app.state.job_manager
    queued = next(jid for jid in job_ids if manager.get(jid).status == "queued")

    r = client.post(f"/api/jobs/{queued}/cancel")
    assert r.status_code == 204
    _wait_status(client, queued, "cancelled")

    gate.set()
    for jid in job_ids:
        _wait_status(client, jid, "done" if jid != queued else "cancelled")


def test_stems_cap_does_not_block_other_kinds(client, monkeypatch):
    name = _project(client)
    _add_dummy_tracks(client, name, 2)
    gate = threading.Event()
    pitch_gate = threading.Event()
    counter = itertools.count()

    def blocked_stems(app, job, params):
        gate.wait(10)
        base, _ = app.state.storage.require(job.project)
        fname = f"stem{next(counter)}.wav"
        (base / fname).write_bytes(b"x")
        return {"files": [fname], "names": [fname]}

    def blocked_pitch(app, job, params):
        pitch_gate.wait(10)
        return _fake_result(app, job, params, counter)

    monkeypatch.setattr("app.jobs.runner._stems_job", blocked_stems)
    monkeypatch.setattr("app.jobs.runner._pitch_job", blocked_pitch)

    r1 = client.post(f"/api/projects/{name}/tracks/0/stems", json={})
    r2 = client.post(f"/api/projects/{name}/tracks/1/stems", json={})
    r3 = client.post(f"/api/projects/{name}/tracks/0/pitch", json={"semitones": 2})
    stems_ids = [r1.json()["job_id"], r2.json()["job_id"]]
    pitch_id = r3.json()["job_id"]

    _wait_until(
        lambda: sorted(_job_statuses(client).values()) == ["queued", "running", "running"]
    )

    manager = client.app.state.job_manager
    running_stems = [j for j in stems_ids if manager.get(j).status == "running"]
    assert len(running_stems) == 1
    assert manager.get(pitch_id).status == "running"

    pitch_gate.set()
    _wait_status(client, pitch_id, "done")

    gate.set()
    for jid in stems_ids:
        _wait_status(client, jid, "done")


def test_sse_replay_last_event_id(client):
    manager = client.app.state.job_manager
    job = manager.create("pitch", "Proj", 0, "")
    ids = []
    for i in range(5):
        ids.append(manager.emit(job, "progress", message=f"step {i}"))
    manager.set_status(job, "done")
    manager.emit(job, "done", added_tracks=[])

    def collect(stream_kwargs):
        events = []
        with client.stream("GET", f"/api/jobs/{job.id}/events", **stream_kwargs) as resp:
            assert resp.status_code == 200
            buffer = ""
            for chunk in resp.iter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    raw, buffer = buffer.split("\n\n", 1)
                    ev = {}
                    for line in raw.splitlines():
                        if line.startswith("id: "):
                            ev["id"] = int(line[4:])
                        elif line.startswith("event: "):
                            ev["event"] = line[7:]
                        elif line.startswith("data: "):
                            ev["data"] = line[6:]
                    events.append(ev)
        return events

    by_header = collect({"headers": {"Last-Event-ID": str(ids[2])}})
    assert [e["id"] for e in by_header] == ids[3:] + [ids[-1] + 1]

    by_query = collect({"params": {"last_id": str(ids[1])}})
    assert [e["id"] for e in by_query] == ids[2:] + [ids[-1] + 1]


def test_health_extended_keys(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert "disk_free_gb" in data
    assert "jobs_running" in data
    assert "jobs_queued" in data
    assert data["jobs_running"] == 0
    assert data["jobs_queued"] == 0


def test_ytdl_fails_fast_on_low_disk(client, monkeypatch):
    name = _project(client)

    def fake_disk_usage(path):
        return type("usage", (), {"total": 100, "used": 99, "free": 1024})()

    def fail_download(*args, **kwargs):
        raise AssertionError("download must not run")

    monkeypatch.setattr("shutil.disk_usage", fake_disk_usage)
    monkeypatch.setattr("app.jobs.runner.download", fail_download)

    r = client.post(
        f"/api/projects/{name}/tracks/ytdl",
        json={"url": "http://example.com/v", "quality": 144},
    )
    assert r.status_code == 200
    job = _wait_status(client, r.json()["job_id"], "error")
    assert "disk space" in job["error"]


def test_job_executor_threads_are_daemon(client):
    future = client.app.state.job_executor.submit(
        lambda: threading.current_thread().daemon
    )
    assert future.result(timeout=5) is True
