import io
import shutil
import subprocess
import zipfile

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


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_create_list_get(client):
    name = _project(client)
    r = client.get("/api/projects")
    assert any(p["name"] == name and p["track_count"] == 0 for p in r.json())
    r = client.get(f"/api/projects/{name}")
    assert r.status_code == 200
    assert r.json()["tracks"] == []
    assert r.json()["speed"] == 100


def test_create_conflict(client):
    _project(client, "Foo")
    r = client.post("/api/projects", json={"name": "Foo"})
    assert r.status_code == 409


def test_create_auto_name(client):
    n1 = _project(client)
    n2 = _project(client)
    assert n1 == "New Project"
    assert n2 == "New Project 1"


def test_update_clamps(client):
    name = _project(client)
    r = client.put(f"/api/projects/{name}", json={
        "version": 1, "tracks": [], "markers": [5000.0, 1000.0], "active_segment": 0,
        "loop_enabled": True, "speed": 500, "master_volume": -5,
        "position_ms": 0.0, "expanded_video_track": -1,
    })
    assert r.status_code == 200
    data = r.json()["project"]
    assert data["speed"] == 100
    assert data["master_volume"] == 0
    assert data["markers"] == [1000.0, 5000.0]
    assert client.get(f"/api/projects/{name}").json()["markers"] == [1000.0, 5000.0]


def test_update_ignores_incoming_tracks(client):
    name = _project(client)
    client.app.state.storage.add_tracks(name, ["a.mp3", "b.mp3"])
    r = client.put(f"/api/projects/{name}", json={
        "version": 1, "tracks": [{"name": "Ghost", "file": "gone.mp3",
                                  "source_file": "gone.mp3", "volume": 1.0,
                                  "muted": False, "pitch_baked": 0}],
        "markers": [1000.0], "active_segment": 0, "loop_enabled": True, "speed": 50,
        "master_volume": 0, "position_ms": 1234.0, "expanded_video_track": -1,
    })
    assert r.status_code == 200
    data = r.json()["project"]
    assert [t["file"] for t in data["tracks"]] == ["a.mp3", "b.mp3"]
    assert data["markers"] == [1000.0]
    assert data["speed"] == 50
    assert data["master_volume"] == 0
    assert data["position_ms"] == 1234.0
    assert client.get(f"/api/projects/{name}").json()["tracks"][0]["file"] == "a.mp3"


def _make_wav(path):
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
         "-ar", "44100", str(path)],
        check=True, capture_output=True,
    )


needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@needs_ffmpeg
def test_upload_waveform_media(tmp_path, client):
    name = _project(client)
    src = tmp_path / "song.mp3"
    _make_wav(src)
    with open(src, "rb") as f:
        r = client.post(
            f"/api/projects/{name}/tracks/upload",
            files=[("files", ("song.mp3", f, "audio/mpeg"))],
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tracks"][0]["name"] == "song"
    assert body["tracks"][0]["file"] == "song.mp3"
    assert body["tracks"][0]["color"] == [60, 110, 170]
    peaks = body["waveforms"]["song.mp3"]["peaks"]
    assert 300 <= len(peaks) <= 400

    r = client.get(f"/api/projects/{name}/waveforms/0")
    assert r.status_code == 200
    assert len(r.json()["peaks"]) == len(peaks)
    assert r.json()["duration_ms"] is not None

    media_path = client.app.state.settings.projects_dir / name / "song.mp3"
    size = media_path.stat().st_size
    r = client.get(f"/api/projects/{name}/media/song.mp3", headers={"Range": "bytes=100-199"})
    assert r.status_code == 206
    assert r.headers["content-range"] == f"bytes 100-199/{size}"
    assert len(r.content) == 100
    r = client.get(f"/api/projects/{name}/media/song.mp3")
    assert r.status_code == 200
    assert len(r.content) == size


def test_upload_bad_ext(tmp_path, client):
    name = _project(client)
    bad = tmp_path / "x.txt"
    bad.write_text("hi")
    with open(bad, "rb") as f:
        r = client.post(f"/api/projects/{name}/tracks/upload",
                        files=[("files", ("x.txt", f, "text/plain"))])
    assert r.status_code == 400


def test_media_static_mount_range(tmp_path, client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    (d / "a.mp3").write_bytes(b"0123456789" * 100)
    r = client.get(f"/media/{name}/a.mp3")
    assert r.status_code == 200
    assert len(r.content) == 1000
    r = client.get(f"/media/{name}/a.mp3", headers={"Range": "bytes=10-19"})
    assert r.status_code == 206
    assert r.content == b"0123456789"


def test_media_traversal(client):
    name = _project(client)
    r = client.get(f"/api/projects/{name}/media/..%2F..%2Fetc%2Fpasswd")
    assert r.status_code in (403, 404)


def test_patch_track_rename(client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    (d / "a.mp3").write_bytes(b"data")
    client.app.state.storage.add_tracks(name, ["a.mp3"])
    r = client.patch(f"/api/projects/{name}/tracks/0", json={"name": "renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "renamed"
    assert r.json()["file"] == "renamed.mp3"
    assert (d / "renamed.mp3").exists()
    assert not (d / "a.mp3").exists()


def test_patch_track_volume_mute(client):
    name = _project(client)
    client.app.state.storage.add_tracks(name, ["a.mp3"])
    r = client.patch(f"/api/projects/{name}/tracks/0", json={"volume": 0.25, "muted": True})
    assert r.status_code == 200
    assert r.json()["volume"] == 0.25
    assert r.json()["muted"] is True
    assert r.json()["file"] == "a.mp3"
    project = client.get(f"/api/projects/{name}").json()
    project["tracks"][0]["muted"] = False
    r = client.put(f"/api/projects/{name}", json=project)
    assert r.status_code == 200, r.text


def test_delete_track_with_file(client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    (d / "a.mp3").write_bytes(b"data")
    client.app.state.storage.add_tracks(name, ["a.mp3"])
    r = client.request("DELETE", f"/api/projects/{name}/tracks/0", json={"delete_file": True})
    assert r.status_code == 204
    assert not (d / "a.mp3").exists()
    assert client.get(f"/api/projects/{name}").json()["tracks"] == []


def test_rename_project(client):
    name = _project(client)
    r = client.post(f"/api/projects/{name}/rename", json={"new_name": "Bar"})
    assert r.status_code == 200
    assert r.json()["name"] == "Bar"
    assert client.get(f"/api/projects/{name}").status_code == 404
    assert client.get("/api/projects/Bar").status_code == 200


def test_export(client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    (d / "a.mp3").write_bytes(b"data")
    client.app.state.storage.add_tracks(name, ["a.mp3"])
    r = client.get(f"/api/projects/{name}/export")
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert f"{name}/{name}.mutrproj" in z.namelist()
    assert f"{name}/a.mp3" in z.namelist()


def test_delete_project(client):
    name = _project(client)
    assert client.delete(f"/api/projects/{name}").status_code == 204
    assert client.get(f"/api/projects/{name}").status_code == 404


def test_delete_project_keep_files(client):
    name = _project(client)
    d = client.app.state.settings.projects_dir / name
    (d / "a.mp3").write_bytes(b"data")
    client.app.state.storage.add_tracks(name, ["a.mp3"])
    r = client.delete(f"/api/projects/{name}", params={"delete_files": "false"})
    assert r.status_code == 204
    assert client.get(f"/api/projects/{name}").status_code == 404
    assert (d / "a.mp3").exists()
    assert not (d / f"{name}.mutrproj").exists()
