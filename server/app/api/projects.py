import os
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from app.storage import ConflictError, NotFoundError

router = APIRouter()


class CreateProjectBody(BaseModel):
    name: str | None = None


class RenameProjectBody(BaseModel):
    new_name: str


@router.get("/projects")
def list_projects(request: Request):
    return request.app.state.storage.list_projects()


@router.post("/projects")
def create_project(body: CreateProjectBody, request: Request):
    try:
        name, project = request.app.state.storage.create_project(body.name)
    except ConflictError as e:
        raise HTTPException(409, str(e))
    return {"name": name, "project": project}


@router.get("/projects/{name}")
def get_project(name: str, request: Request):
    try:
        return request.app.state.storage.get_project(name)
    except NotFoundError:
        raise HTTPException(404, "project not found")


@router.put("/projects/{name}")
def update_project(name: str, body: dict, request: Request):
    try:
        return {"saved": True, "project": request.app.state.storage.update_project(name, body)}
    except NotFoundError:
        raise HTTPException(404, "project not found")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/projects/{name}", status_code=204)
def delete_project(name: str, request: Request, delete_files: bool = True):
    try:
        request.app.state.storage.delete_project(name, delete_files=delete_files)
    except NotFoundError:
        raise HTTPException(404, "project not found")


@router.post("/projects/{name}/rename")
def rename_project(name: str, body: RenameProjectBody, request: Request):
    try:
        new_name = request.app.state.storage.rename_project(name, body.new_name)
    except NotFoundError:
        raise HTTPException(404, "project not found")
    except ConflictError as e:
        raise HTTPException(409, str(e))
    return {"name": new_name}


@router.get("/projects/{name}/export")
def export_project(name: str, request: Request):
    storage = request.app.state.storage
    try:
        d, _ = storage.require(name)
    except NotFoundError:
        raise HTTPException(404, "project not found")
    fd, tmp = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        for path in d.rglob("*"):
            if path.is_file():
                z.write(path, Path(name) / path.relative_to(d))
    return FileResponse(
        tmp, media_type="application/zip", filename=f"{name}.zip",
        background=BackgroundTask(os.unlink, tmp),
    )
