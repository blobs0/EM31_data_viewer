from __future__ import annotations

import abc
import shutil
import sys
import tempfile
import typing
from dataclasses import asdict
from pathlib import Path

# Allow execution as a top-level script (PyInstaller onefile) by fixing imports.
# We extend sys.path so absolute imports like `backend.*` work consistently.
if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parent.parent))

if getattr(sys, "frozen", False):
    _original_abc_instancecheck = abc.ABCMeta.__instancecheck__

    def _safe_abc_instancecheck(cls, instance):
        try:
            return _original_abc_instancecheck(cls, instance)
        except TypeError:
            return False

    typing._abc_instancecheck = _safe_abc_instancecheck

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.em31.geojson import build_feature_collection
from backend.em31.parser import parse_em31_file
from backend.em31.thickness import COEFF_PRESETS


def get_base_dir():
    """
    Resolve the project root, whether running from sources or a PyInstaller bundle.
    """
    if getattr(sys, "frozen", False):
        bundle_dir = getattr(sys, "_MEIPASS", None)
        if bundle_dir:
            return Path(bundle_dir)
    return Path(__file__).resolve().parent.parent


BASE_DIR = get_base_dir()
FRONTEND_DIR = BASE_DIR / "frontend"
TILES_DIR = BASE_DIR / "tiles"

app = FastAPI(title="EM31 Parser")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

if TILES_DIR.exists():
    app.mount("/tiles", StaticFiles(directory=TILES_DIR), name="tiles")


@app.get("/")
async def root():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "EM31 backend ready"}


@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    max_delta_ms: int = 1000,
    inst_height: float = 0.15,
    coeff_profile: str = "winter",
    coeff_a: typing.Optional[float] = None,
    coeff_b: typing.Optional[float] = None,
    coeff_c: typing.Optional[float] = None,
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".r31", ".txt"}:
        raise HTTPException(status_code=400, detail="Expected a .R31 file")
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)
    coeff_key = (coeff_profile or "winter").strip().lower()
    if coeff_key == "custom":
        if coeff_a is None or coeff_b is None or coeff_c is None:
            raise HTTPException(status_code=400, detail="Custom coefficients require coeff_a, coeff_b, coeff_c.")
        if coeff_a <= 0 or coeff_c <= 0:
            raise HTTPException(status_code=400, detail="Custom coefficients require coeff_a > 0 and coeff_c > 0.")
        coeffs = [coeff_a, coeff_b, coeff_c]
    else:
        coeffs = COEFF_PRESETS.get(coeff_key)
        if not coeffs:
            raise HTTPException(status_code=400, detail="Unknown coeff_profile.")

    try:
        parsed = parse_em31_file(tmp_path)
        geojson = build_feature_collection(
            parsed["lines"],
            max_delta_ms=max_delta_ms,
            inst_height=inst_height,
            coeffs=coeffs,
        )
        header_dict = asdict(parsed["header"])
        lines_meta = []
        for line in parsed["lines"]:
            lines_meta.append(
                {
                    "line_name": line.line_name,
                    "readings": len(line.readings),
                    "gps_points": len(line.gps_points),
                    "created_at": line.created_at.isoformat() if line.created_at else None,
                }
            )
        return JSONResponse({"header": header_dict, "lines": lines_meta, "geojson": geojson})
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass


@app.get("/api/health")
async def health():
    return {"status": "ok"}


def run():
    import uvicorn
    import os

    port = int(os.environ.get("BACKEND_PORT", "8000"))
    host = os.environ.get("BACKEND_HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port, reload=False)


if __name__ == "__main__":
    run()
