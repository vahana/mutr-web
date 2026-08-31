import aiofiles

MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
}


async def iter_bytes(path, start: int, end: int):
    async with aiofiles.open(path, "rb") as f:
        await f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = await f.read(min(256 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def parse_range(value: str, size: int) -> tuple[int, int] | None:
    if not value.startswith("bytes="):
        return None
    spec = value[6:].split(",")[0].strip()
    if "-" not in spec:
        return None
    a, b = spec.split("-", 1)
    try:
        if a == "":
            length = int(b)
            if length <= 0:
                return None
            start = max(0, size - length)
            end = size - 1
        else:
            start = int(a)
            end = int(b) if b != "" else size - 1
            if start >= size:
                return None
            end = min(end, size - 1)
    except ValueError:
        return None
    if start > end:
        return None
    return start, end
