#!/usr/bin/env python3
"""
Petit script utilitaire pour récupérer la mesure EM31 la plus proche
de points GPS donnés, dans les fichiers 121116B.R31 et 121115A.R31.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from em31 import read_r31

# Fichiers à lire (chemins absolus fournis par l'utilisateur)
DATA_FILES = [
    Path("/media/ministrum/A030-A790/data_EM31/EM31/121116B.R31"),
    #Path("/media/ministrum/A030-A790/data_EM31/EM31/121115A.R31"),
]

# Points de référence (lat/lon en degrés/min/sec et hémisphères)
REFERENCE_POINTS = [
    {
        "name": "134",
        "ice_cm": 150,
        "lat_dms": (66, 41, 48.9, "S"),
        "lon_dms": (139, 54, 48.1, "E"),
    },
    {
        "name": "135",
        "ice_cm": 145,
        "lat_dms": (66, 41, 5.2, "S"),
        "lon_dms": (139, 55, 26.4, "E"),
    },
    {
        "name": "136",
        "ice_cm": 130,
        "lat_dms": (66, 40, 58.7, "S"),
        "lon_dms": (139, 55, 52.3, "E"),
    },
    {
        "name": "137",
        "ice_cm": 145,
        "lat_dms": (66, 40, 56.3, "S"),
        "lon_dms": (139, 56, 2.4, "E"),
    },
    {
        "name": "138",
        "ice_cm": 148,
        "lat_dms": (66, 40, 46.8, "S"),
        "lon_dms": (139, 56, 42.7, "E"),
    },
    {
        "name": "139",
        "ice_cm": 148,
        "lat_dms": (66, 40, 25.9, "S"),
        "lon_dms": (139, 58, 2.7, "E"),
    },
    {
        "name": "140",
        "ice_cm": 118,
        "lat_dms": (66, 39, 35.9, "S"),
        "lon_dms": (139, 59, 24.2, "E"),
    },
    {
        "name": "141",
        "ice_cm": 144,
        "lat_dms": (66, 39, 32.7, "S"),
        "lon_dms": (139, 59, 21.1, "E"),
    },
    {
        "name": "142",
        "ice_cm": 143,
        "lat_dms": (66, 38, 52.0, "S"),
        "lon_dms": (139, 59, 26.7, "E"),
    },
]


def dms_to_decimal(degrees: float, minutes: float, seconds: float, hemisphere: str) -> float:
    """
    Convertit (deg, min, sec, hémisphère) en degrés décimaux signés.
    """
    decimal = degrees + minutes / 60.0 + seconds / 3600.0
    if hemisphere.upper() in ("S", "W"):
        decimal *= -1
    return decimal


def load_measurements(files: list[Path]) -> pd.DataFrame:
    """
    Charge les mesures EM31 depuis les fichiers fournis et concatène le tout.
    """
    frames = []
    for file in files:
        if not file.exists():
            print(f"Attention: fichier introuvable, ignoré : {file}")
            continue
        df = read_r31(file)
        if df.empty:
            print(f"Attention: {file.name} ne contient pas de données exploitables.")
            continue
        df = df.dropna(subset=["lat", "lon", "appcond"]).copy()
        df["source"] = file.name
        frames.append(df)
    if not frames:
        raise SystemExit("Aucune donnée chargée, vérifier les chemins des fichiers R31.")
    return pd.concat(frames, ignore_index=True)


def haversine(lat1: float, lon1: float, lat2: np.ndarray, lon2: np.ndarray) -> np.ndarray:
    """
    Distance haversine (m) entre un point (lat1, lon1) et des tableaux lat2/lon2.
    """
    radius = 6_371_000
    phi1 = np.radians(lat1)
    phi2 = np.radians(lat2)
    dphi = phi2 - phi1
    dlambda = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2.0) ** 2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2.0) ** 2
    return 2 * radius * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


def find_nearest(df: pd.DataFrame, lat: float, lon: float) -> dict[str, object]:
    """
    Retourne la mesure la plus proche dans df pour la position (lat, lon).
    """
    distances = haversine(lat, lon, df["lat"].to_numpy(), df["lon"].to_numpy())
    idx = int(np.argmin(distances))
    row = df.iloc[idx]
    return {
        "lat": float(row["lat"]),
        "lon": float(row["lon"]),
        "appcond_mS_m": float(row["appcond"]),
        "distance_m": float(distances[idx]),
        "source": row.get("source", ""),
        "time": row.get("time_sys", ""),
    }


def main() -> None:
    df = load_measurements(DATA_FILES)
    for point in REFERENCE_POINTS:
        lat = dms_to_decimal(*point["lat_dms"])
        lon = dms_to_decimal(*point["lon_dms"])
        nearest = find_nearest(df, lat, lon)
        print(f"Point {point['name']} ({point['ice_cm']} cm)")
        print(f"  cible : lat {lat:.6f}, lon {lon:.6f}")
        print(
            f"  plus proche : {nearest['source']} à {nearest['distance_m']:.1f} m ; "
            f"appcond {nearest['appcond_mS_m']:.2f} mS/m"
        )
        print(f"  mesure : lat {nearest['lat']:.6f}, lon {nearest['lon']:.6f}")
        if nearest["time"]:
            print(f"  temps : {nearest['time']}")
        print()


if __name__ == "__main__":
    main()
