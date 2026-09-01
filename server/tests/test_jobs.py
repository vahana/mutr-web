import shutil
import subprocess
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


def _make_wav(path, seconds=1.0):
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
         "-ar", "44100", str(path)],
        check=True, capture_output=True,
    )


def _wait_job(client, job_id, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.05)
    raise TimeoutError(job_id)


def _upload(client, name, filename, path):
    with open(path, "rb") as f:
        r = client.post(f"/api/projects/{name}/tracks/upload",
                        files=[("files", (filename, f, "audio/mpeg"))])
    assert r.status_code == 200, r.text


needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("rubberband") is None,
    reason="ffmpeg/rubberband not installed",
)


@needs_ffmpeg
def test_pitch_job_end_to_end(tmp_path, client):
    name = _project(client)
    src = tmp_path / "song.mp3"
    _make_wav(src)
    _upload(client, name, "song.mp3", src)

    r = client.post(f"/api/projects/{name}/tracks/0/pitch", json={"semitones": 3})
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    job = _wait_job(client, job_id)
    assert job["status"] == "done", job
    assert len(job["added_tracks"]) == 1
    assert job["added_tracks"][0]["name"] == "song +3 st"

    project = client.get(f"/api/projects/{name}").json()
    assert len(project["tracks"]) == 2
    assert project["tracks"][1]["file"] == "song_pitch+3.wav"

    r = client.get(f"/api/projects/{name}/waveforms/1")
    assert r.status_code == 200
    assert len(r.json()["peaks"]) > 100


@needs_ffmpeg
def test_pitch_job_events_sse(tmp_path, client):
    name = _project(client)
    src = tmp_path / "song.mp3"
    _make_wav(src)
    _upload(client, name, "song.mp3", src)

    r = client.post(f"/api/projects/{name}/tracks/0/pitch", json={"semitones": -2})
    job_id = r.json()["job_id"]

    events = []
    with client.stream("GET", f"/api/jobs/{job_id}/events") as resp:
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
    kinds = [e["event"] for e in events]
    assert "progress" in kinds
    assert kinds[-1] == "done"
    ids = [e["id"] for e in events]
    assert ids == sorted(ids)


def test_pitch_validation(client):
    name = _project(client)
    r = client.post(f"/api/projects/{name}/tracks/0/pitch", json={"semitones": 3})
    assert r.status_code == 404
    r = client.post(f"/api/projects/{name}/tracks/0/pitch", json={"semitones": 0})
    assert r.status_code == 404 or r.status_code == 400
    d = client.app.state.settings.projects_dir / name
    (d / "a.mp3").write_bytes(b"data")
    client.app.state.storage.add_tracks(name, ["a.mp3"])
    r = client.post(f"/api/projects/{name}/tracks/0/pitch", json={"semitones": 13})
    assert r.status_code == 400
    r = client.post(f"/api/projects/{name}/tracks/0/pitch", json={"semitones": 0})
    assert r.status_code == 400


@needs_ffmpeg
def test_pitch_missing_file_job_errors(client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    client.app.state.storage.add_tracks(name, ["ghost.mp3"])
    r = client.post(f"/api/projects/{name}/tracks/0/pitch", json={"semitones": 3})
    assert r.status_code == 200
    job = _wait_job(client, r.json()["job_id"])
    assert job["status"] == "error"
    assert job["error"]
    assert len(client.get(f"/api/projects/{name}").json()["tracks"]) == 1


@needs_ffmpeg
def test_merge_job_end_to_end(tmp_path, client):
    name = _project(client)
    a = tmp_path / "a.wav"
    b = tmp_path / "b.wav"
    _make_wav(a)
    _make_wav(b, seconds=1.5)
    _upload(client, name, "a.wav", a)
    _upload(client, name, "b.wav", b)
    r = client.post(f"/api/projects/{name}/tracks/merge", json={"indices": [0, 1]})
    assert r.status_code == 200
    job = _wait_job(client, r.json()["job_id"])
    assert job["status"] == "done", job
    assert len(job["added_tracks"]) == 1
    assert job["added_tracks"][0]["name"] == "a mix"
    project = client.get(f"/api/projects/{name}").json()
    assert len(project["tracks"]) == 3
    d = client.app.state.settings.projects_dir / name
    assert (d / "a mix.wav").exists()


def test_merge_validation(client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    (d / "a.mp3").write_bytes(b"data")
    client.app.state.storage.add_tracks(name, ["a.mp3"])
    r = client.post(f"/api/projects/{name}/tracks/merge", json={"indices": [0]})
    assert r.status_code == 400
    r = client.post(f"/api/projects/{name}/tracks/merge", json={"indices": [0, 9]})
    assert r.status_code == 404


def test_bulk_delete(client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    for f in ("a.mp3", "b.mp3", "c.mp3"):
        (d / f).write_bytes(b"data")
    client.app.state.storage.add_tracks(name, ["a.mp3", "b.mp3", "c.mp3"])
    r = client.post(f"/api/projects/{name}/tracks/delete",
                    json={"indices": [2, 0], "delete_files": True})
    assert r.status_code == 204
    project = client.get(f"/api/projects/{name}").json()
    assert [t["file"] for t in project["tracks"]] == ["b.mp3"]
    assert not (d / "a.mp3").exists()
    assert not (d / "c.mp3").exists()


def test_stems_validation(client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    (d / "a.mp3").write_bytes(b"data")
    client.app.state.storage.add_tracks(name, ["a.mp3"])
    r = client.post(f"/api/projects/{name}/tracks/0/stems", json={"model": "bogus"})
    assert r.status_code == 400
    r = client.post(f"/api/projects/{name}/tracks/0/stems", json={"shifts": 99})
    assert r.status_code == 400


def test_ytdl_validation(client):
    name = _project(client)
    r = client.post(f"/api/projects/{name}/tracks/ytdl", json={"url": "not-a-url"})
    assert r.status_code == 400
    r = client.get("/api/projects/nope/tracks/ytdl")
    assert r.status_code in (404, 405)


def test_jobs_list_and_cancel_unknown(client):
    r = client.get("/api/jobs")
    assert r.status_code == 200
    assert r.json() == []
    r = client.post("/api/jobs/nope/cancel")
    assert r.status_code == 404
    r = client.get("/api/jobs/nope/events")
    assert r.status_code == 404
