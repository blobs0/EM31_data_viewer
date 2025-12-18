from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .models import GPSPoint, LineRecord, Reading
from .parser import match_readings_to_gps
from .thickness_adapter import compute_thickness


def compute_bounds(coords: List[Tuple[float, float]]) -> Optional[List[float]]:
    if not coords:
        return None
    lats = [c[1] for c in coords]
    lons = [c[0] for c in coords]
    return [min(lons), min(lats), max(lons), max(lats)]


def build_feature_collection(
    lines: List[LineRecord],
    max_delta_ms: int = 1000,
    inst_height: float = 0.15,
) -> Dict[str, object]:
    features: List[Dict[str, object]] = []
    all_coords: List[Tuple[float, float]] = []
    for line in lines:
        matched = match_readings_to_gps(line.readings, line.gps_points, max_delta_ms=max_delta_ms)
        cond_values = [reading.conductivity for reading, _ in matched]
        thickness_values = compute_thickness(cond_values, inst_height=inst_height)
        thickness_iter = iter(thickness_values)
        for reading, gps in matched:
            coords = [gps.lon, gps.lat]
            all_coords.append((gps.lon, gps.lat))
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": coords},
                    "properties": {
                        "kind": "reading",
                        "line_name": line.line_name,
                        "time_ms": reading.time_ms,
                        "conductivity": reading.conductivity,
                        "inphase": reading.inphase,
                        "range": reading.range_value,
                        "dipole_mode": reading.dipole_mode,
                        "marker": reading.marker,
                        "station": reading.station,
                        "raw_reading1": reading.raw_reading1,
                        "raw_reading2": reading.raw_reading2,
                        "thickness": next(thickness_iter, None),
                        "gps_quality": gps.quality,
                        "gps_satellites": gps.satellites,
                        "gps_hdop": gps.hdop,
                        "gps_altitude": gps.altitude,
                    },
                }
            )
        coords_sorted = sorted(line.gps_points, key=lambda g: g.time_ms)
        if coords_sorted:
            track_coords = [[p.lon, p.lat] for p in coords_sorted]
            all_coords.extend((p.lon, p.lat) for p in coords_sorted)
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": track_coords},
                    "properties": {
                        "kind": "track",
                        "line_name": line.line_name,
                    },
                }
            )
    bounds = compute_bounds(all_coords)
    return {"type": "FeatureCollection", "features": features, "bounds": bounds}
