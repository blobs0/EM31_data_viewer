"""
Build a standalone backend executable with PyInstaller.
Includes frontend assets, tiles and pyEM31 sources so the Electron app can run without a local Python install.
"""
import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
DIST_DIR = BACKEND_DIR / "dist"
BUILD_DIR = BACKEND_DIR / "build"
APP_ENTRY = BACKEND_DIR / "app.py"
BINARY_NAME = "em31-backend"


def run(cmd):
    print(" ".join(str(c) for c in cmd))
    subprocess.check_call(cmd)


def build():
    try:
        import PyInstaller  # noqa: F401
    except ImportError as exc:
        print("PyInstaller n'est pas installé. Installe-le avec `pip install pyinstaller`.", file=sys.stderr)
        raise SystemExit(1) from exc

    sep = ";" if os.name == "nt" else ":"
    add_data = [
        f"{PROJECT_ROOT / 'frontend'}{sep}frontend",
        f"{PROJECT_ROOT / 'tiles'}{sep}tiles",
        f"{PROJECT_ROOT / 'pyEM31-main'}{sep}pyEM31-main",
    ]

    DIST_DIR.mkdir(exist_ok=True)
    BUILD_DIR.mkdir(exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--onefile",
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR),
        "--name",
        BINARY_NAME,
    ]
    for data in add_data:
        cmd += ["--add-data", data]
    cmd.append(str(APP_ENTRY))

    run(cmd)
    print(f"Binaire généré dans {DIST_DIR}")


if __name__ == "__main__":
    build()
