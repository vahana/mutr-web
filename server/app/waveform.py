import json
import threading
from pathlib import Path

from mutr_core.waveform import extract_peaks, probe_duration_ms


class WaveformCache:
    def __init__(self, settings):
        self._dir = settings.cache_dir
        self._locks: dict[Path, threading.Lock] = {}
        self._guard = threading.Lock()

    def _cache_path(self, project: str, filename: str) -> Path:
        return self._dir / project / f"{filename}.json"

    def get(self, project: str, file_path: Path) -> dict:
        stat = file_path.stat()
        cache_path = self._cache_path(project, file_path.name)
        with self._guard:
            lock = self._locks.setdefault(cache_path, threading.Lock())
        with lock:
            data = self._read(cache_path, stat)
            if data is not None:
                return data
            data = {
                "mtime_s": stat.st_mtime,
                "size": stat.st_size,
                "duration_ms": probe_duration_ms(file_path),
                "peaks": extract_peaks(file_path) or [],
            }
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(data))
            return data

    def _read(self, cache_path: Path, stat) -> dict | None:
        try:
            data = json.loads(cache_path.read_text())
            if data.get("mtime_s") == stat.st_mtime and data.get("size") == stat.st_size:
                return data
        except Exception:
            pass
        return None
