# EM31 – Application Electron

Application de visualisation EM31 (frontend statique + backend FastAPI) empaquetée avec Electron.

## Prérequis
- Python 3.10+ avec `pip`
- Node.js 18+ / npm
- Dépendances Python : `pip install -r backend/requirements.txt`
- (Build) PyInstaller : `pip install pyinstaller`

## Installation
1. Installer les paquets Node : `npm install`
2. Vérifier que les dossiers nécessaires sont présents : `frontend/`, `backend/`, `tiles/`.

## Lancer en dev
- Important : si `ELECTRON_RUN_AS_NODE=1` est défini dans ton environnement, Electron se lance en mode Node et l'app plante. Le script `npm start` le désactive automatiquement.
- `npm start` lance Electron et démarre automatiquement le backend Python.
- Variables utiles :
  - `BACKEND_PORT` pour changer le port (par défaut `8000`)
  - `PYTHON_PATH` si le binaire Python n'est pas `python3`/`python`
  - `ELECTRON_START_URL` pour pointer vers un backend déjà lancé (sinon Electron essaie d'en démarrer un).

## Build Electron
- `npm run pack` : build sans installeur (dossier dans `dist/`)
- `npm run dist` : build avec installeur (Linux: `deb`/`tar.gz`/`zip` + option `AppImage`, Windows: NSIS). Appelle automatiquement PyInstaller pour packager le backend avant Electron Builder.
- Le binaire backend et les ressources frontend/tiles sont inclus, donc pas besoin de Python sur la machine cible.

## Backend seul
- `BACKEND_PORT=8000 uvicorn backend.app:app --reload` sert l'API et le frontend (URL par défaut : `http://127.0.0.1:8000`).


## Build backend seul (PyInstaller)
- `python backend/build_backend.py` génère `backend/dist/em31-backend[.exe]` incluant frontend et tiles.
- Ce binaire est embarqué automatiquement dans `npm run pack` / `npm run dist`.
- Compile sur chaque OS cible pour obtenir un binaire natif (Windows depuis Windows, Linux depuis Linux).

## Linux (AppImage / FUSE)
- Si l'AppImage affiche `dlopen(): error loading libfuse.so.2`, installe FUSE2 (ex: Debian/Ubuntu: `sudo apt install libfuse2`, Fedora: `sudo dnf install fuse fuse-libs`).
- Sinon, utilise plutôt les artefacts `*.deb`, `*.tar.gz` ou `*.zip` qui ne nécessitent pas FUSE.
