import math
import os
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# -----------------------------------------------------------
# CONFIGURATION
# -----------------------------------------------------------

OUTPUT_ROOT = "tiles"         # dossier racine des tuiles
MAX_WORKERS = 60               # nb de threads (8 est un bon début)
REQUEST_TIMEOUT = 30          # timeout en secondes pour chaque requête HTTP

# User-Agent "déguisé" en Firefox
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) "
        "Gecko/20100101 Firefox/128.0"
    )
    # Astuce recommandée par OSM : mettre un contact, ex :
    # "Mozilla/5.0 ... Firefox/128.0; +contact:t-on-email@example.com"
}

def lon2tile_x(lon, z):
    return int((lon + 180.0) / 360.0 * (2 ** z))

def lat2tile_y(lat, z):
    lat_rad = math.radians(lat)
    return int(
        (1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi)
        / 2.0
        * (2 ** z)
    )

# -----------------------------------------------------------
# ZONE A TELECHARGER (petite bbox)
# -----------------------------------------------------------

minlat, maxlat = -66.69549, -66.66505
minlon, maxlon = 139.89106, 140.02582
min_zoom, max_zoom = 1, 18   # zooms fins (attention au nombre de tuiles)

# -----------------------------------------------------------
# URL OSM
# -----------------------------------------------------------

TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"

# -----------------------------------------------------------
# FONCTION DE TELECHARGEMENT (POUR UNE TUILE)
# -----------------------------------------------------------

def download_tile(job):
    z, x, y, url, path = job

    if os.path.exists(path):
        return f"SKIP {z}/{x}/{y} (exists)"

    try:
        r = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(r.content)
            return f"OK   {z}/{x}/{y}"
        else:
            return f"ERR  {z}/{x}/{y} -> HTTP {r.status_code}"
    except Exception as e:
        return f"ERR  {z}/{x}/{y} -> {e}"

# -----------------------------------------------------------
# PREPARATION DE LA LISTE DES TUILES A TELECHARGER
# -----------------------------------------------------------

jobs = []

for z in range(min_zoom, max_zoom + 1):
    x_min = lon2tile_x(minlon, z)
    x_max = lon2tile_x(maxlon, z)
    y_min = lat2tile_y(maxlat, z)  # lat max -> y_min
    y_max = lat2tile_y(minlat, z)  # lat min -> y_max

    print(f"Zoom {z} : X {x_min}→{x_max}, Y {y_min}→{y_max}")

    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            url = TILE_URL.format(z=z, x=x, y=y)
            folder = os.path.join(OUTPUT_ROOT, str(z), str(x))
            path = os.path.join(folder, f"{y}.png")

            if os.path.exists(path):
                continue

            jobs.append((z, x, y, url, path))

print(f"Nombre total de tuiles à traiter : {len(jobs)}")

# -----------------------------------------------------------
# TELECHARGEMENT EN PARALLELE
# -----------------------------------------------------------

if jobs:
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_job = {executor.submit(download_tile, job): job for job in jobs}

        for future in as_completed(future_to_job):
            result = future.result()
            print(result)
else:
    print("Rien à faire, toutes les tuiles existent déjà.")

