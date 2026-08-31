import json
import shutil
import threading
from pathlib import Path

from mutr_core.color import track_color
from mutr_core.paths import sanitize_name, unique_name
from mutr_core.project import load_project, save_project


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


def _to_rel(abs_path: str, base: Path) -> str:
    p = Path(abs_path)
    if not p.is_absolute():
        return abs_path
    try:
        return str(p.resolve().relative_to(base.resolve()))
    except ValueError:
        return abs_path


def _relativize(data: dict, base: Path) -> dict:
    for t in data["tracks"]:
        t["file"] = _to_rel(t["file"], base)
        t["source_file"] = _to_rel(t["source_file"], base)
    return data


def _with_colors(data: dict) -> dict:
    for i, t in enumerate(data["tracks"]):
        t["color"] = list(track_color(i))
    return data


_EMPTY_PROJECT = {
    "version": 1, "tracks": [], "markers": [], "active_segment": -1,
    "loop_enabled": False, "speed": 100, "master_volume": 80,
    "position_ms": 0.0, "expanded_video_track": -1,
}


class Storage:
    def __init__(self, settings):
        self._settings = settings
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def lock(self, name: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(name, threading.Lock())

    def project_dir(self, name: str) -> Path:
        return self._settings.projects_dir / name

    def project_file(self, name: str) -> Path:
        return self.project_dir(name) / f"{name}.mutrproj"

    def require(self, name: str) -> tuple[Path, Path]:
        d = self.project_dir(name)
        f = self.project_file(name)
        if not d.is_dir() or not f.is_file():
            raise NotFoundError(name)
        return d, f

    def list_projects(self) -> list[dict]:
        out = []
        for d in sorted(self._settings.projects_dir.iterdir()):
            if not d.is_dir():
                continue
            f = d / f"{d.name}.mutrproj"
            if not f.is_file():
                continue
            try:
                track_count = len(json.loads(f.read_text()).get("tracks", []))
            except Exception:
                continue
            out.append({
                "name": d.name,
                "mtime": max(d.stat().st_mtime, f.stat().st_mtime),
                "track_count": track_count,
            })
        out.sort(key=lambda p: p["mtime"], reverse=True)
        return out

    def create_project(self, name: str | None = None) -> tuple[str, dict]:
        existing = {p.name for p in self._settings.projects_dir.iterdir() if p.is_dir()}
        if name:
            cleaned = sanitize_name(name)
            if cleaned in existing:
                raise ConflictError(f"Project '{cleaned}' already exists")
        else:
            cleaned = unique_name("New Project", existing)
        d = self.project_dir(cleaned)
        d.mkdir(parents=True)
        save_project(self.project_file(cleaned), dict(_EMPTY_PROJECT))
        return cleaned, dict(_EMPTY_PROJECT)

    def get_project(self, name: str) -> dict:
        d, f = self.require(name)
        data = load_project(f)
        return _with_colors(_relativize(data, d))

    def update_project(self, name: str, data: dict) -> dict:
        d, f = self.require(name)
        with self.lock(name):
            out = load_project(f)
            out["markers"] = sorted(float(m) for m in data.get("markers", []))
            out["active_segment"] = int(data.get("active_segment", out.get("active_segment", -1)))
            out["loop_enabled"] = bool(data.get("loop_enabled", out.get("loop_enabled", False)))
            speed = data.get("speed")
            mv = data.get("master_volume")
            pos = data.get("position_ms")
            out["speed"] = min(100, max(10, int(speed if speed is not None else out.get("speed", 100))))
            out["master_volume"] = min(100, max(0, int(mv if mv is not None else out.get("master_volume", 80))))
            out["position_ms"] = float(pos if pos is not None else out.get("position_ms", 0.0))
            expanded = int(data.get("expanded_video_track", out.get("expanded_video_track", -1)))
            out["expanded_video_track"] = (
                expanded if 0 <= expanded < len(out["tracks"]) else -1
            )
            save_project(f, out)
        return _with_colors(_relativize(dict(out), d))

    def delete_project(self, name: str, delete_files: bool = True) -> None:
        d, f = self.require(name)
        if delete_files:
            shutil.rmtree(d)
        else:
            f.unlink(missing_ok=True)
        shutil.rmtree(self._settings.cache_dir / name, ignore_errors=True)

    def rename_project(self, name: str, new_name: str) -> str:
        cleaned = sanitize_name(new_name)
        d, f = self.require(name)
        if cleaned == name:
            return name
        target = self.project_dir(cleaned)
        if target.exists():
            raise ConflictError(f"Project '{cleaned}' already exists")
        with self.lock(name):
            d.rename(target)
            old_file = target / f"{name}.mutrproj"
            new_file = target / f"{cleaned}.mutrproj"
            if old_file.exists() and old_file != new_file:
                old_file.rename(new_file)
            cache_old = self._settings.cache_dir / name
            cache_new = self._settings.cache_dir / cleaned
            if cache_old.exists() and not cache_new.exists():
                cache_old.rename(cache_new)
        return cleaned

    def track(self, name: str, idx: int) -> dict:
        data = self.get_project(name)
        if idx < 0 or idx >= len(data["tracks"]):
            raise NotFoundError(f"track {idx}")
        return data["tracks"][idx]

    def add_tracks(self, name: str, filenames: list[str], names: list[str] | None = None) -> list[dict]:
        d, f = self.require(name)
        with self.lock(name):
            data = load_project(f)
            added = []
            for i, filename in enumerate(filenames):
                t = {
                    "name": (names[i] if names else None) or Path(filename).stem,
                    "file": filename,
                    "source_file": filename,
                    "volume": 1.0, "muted": False, "pitch_baked": 0,
                }
                data["tracks"].append(t)
                added.append(dict(t, color=list(track_color(len(data["tracks"]) - 1))))
            save_project(f, data)
        return added

    def find_track(self, name: str, filename: str) -> int | None:
        d, f = self.require(name)
        data = load_project(f)
        for i, t in enumerate(data["tracks"]):
            if t["file"] == filename or Path(t["file"]).name == filename:
                return i
        return None

    def update_track(self, name: str, idx: int, patch: dict) -> dict:
        d, f = self.require(name)
        with self.lock(name):
            data = load_project(f)
            if idx < 0 or idx >= len(data["tracks"]):
                raise NotFoundError(f"track {idx}")
            t = data["tracks"][idx]
            if "volume" in patch:
                t["volume"] = min(1.0, max(0.0, float(patch["volume"])))
            if "muted" in patch:
                t["muted"] = bool(patch["muted"])
            if "name" in patch:
                new_name = sanitize_name(str(patch["name"]))
                if not new_name:
                    raise ValueError("empty track name")
                old_file = (d / t["file"]).resolve()
                if not old_file.is_relative_to(d.resolve()):
                    raise ConflictError("track file outside project")
                new_file = d / (new_name + old_file.suffix)
                if old_file.exists() and new_file != old_file:
                    if new_file.exists():
                        raise ConflictError("file already exists")
                    old_file.rename(new_file)
                old_name = Path(t["file"]).name
                t["name"] = new_name
                t["file"] = new_file.name
                if Path(t["source_file"]).name == old_name:
                    t["source_file"] = new_file.name
                (self._settings.cache_dir / name / f"{old_name}.json").unlink(missing_ok=True)
            save_project(f, data)
            t_out = dict(t)
            t_out["file"] = _to_rel(t["file"], d)
            t_out["source_file"] = _to_rel(t["source_file"], d)
            return dict(t_out, color=list(track_color(idx)))

    def remove_track(self, name: str, idx: int, delete_file: bool = False) -> None:
        d, f = self.require(name)
        with self.lock(name):
            data = load_project(f)
            if idx < 0 or idx >= len(data["tracks"]):
                raise NotFoundError(f"track {idx}")
            t = data["tracks"].pop(idx)
            save_project(f, data)
        if delete_file:
            file_path = d / t["file"]
            if file_path.exists():
                file_path.unlink()
        (self._settings.cache_dir / name / f"{Path(t['file']).name}.json").unlink(missing_ok=True)
