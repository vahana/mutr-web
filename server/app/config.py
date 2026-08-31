import os
from pathlib import Path

_DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


class Settings:
    def __init__(self, data_dir: str | Path | None = None):
        self.data_dir = Path(data_dir) if data_dir is not None else Path(
            os.environ.get("MUTR_DATA_DIR", _DEFAULT_DATA_DIR)
        )
        self.projects_dir = self.data_dir / "projects"
        self.cache_dir = self.data_dir / "cache" / "waveforms"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
