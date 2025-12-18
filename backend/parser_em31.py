from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .models import GPSPoint, Header, LineRecord, Reading, TimerRelation


def ddmm_to_deg(value_str: str, hemisphere: str) -> float:
    v = float(value_str)
    degrees = int(v // 100)
    minutes = v - degrees * 100
    sign = -1 if hemisphere in ("S", "W") else 1
    return sign * (degrees + minutes / 60.0)


def parse_header_e(line: str, header: Header) -> Header:
    parts = line.strip().split()
    if not parts:
        return header
    header.program = parts[0]
    rest = parts[1] if len(parts) > 1 else ""
    header.version = rest[:4] or None
    survey_block = rest[4:] if len(rest) > 4 else ""
    if survey_block:
        header.survey_type = survey_block[:3] or None
        digits = survey_block[3:]
        if len(digits) >= 1:
            header.unit_type = safe_int(digits[0])
        if len(digits) >= 2:
            header.dipole = safe_int(digits[1])
        if len(digits) >= 3:
            header.mode = safe_int(digits[2])
        if len(digits) >= 4:
            header.component = safe_int(digits[3])
        if len(digits) >= 5:
            header.field_computer = safe_int(digits[4])
    elif len(parts) > 2:
        header.survey_type = parts[1]
    return header


def parse_header_h(line: str, header: Header) -> Header:
    content = line[1:].strip()
    tokens = content.split()
    if tokens:
        header.file_name = tokens[0]
    if len(tokens) > 1:
        header.mode_parameter = safe_float(tokens[1])
    return header


def parse_line_created_at(line: str) -> Optional[datetime]:
    date_part = line[1:9]
    time_part = line[10:].strip()
    try:
        return datetime.strptime(f"{date_part} {time_part}", "%d%m%Y %H:%M:%S")
    except ValueError:
        return None


def parse_timer_relation(line: str) -> Optional[TimerRelation]:
    match = re.match(r"^\*(\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d{1,10})", line.strip())
    if not match:
        return None
    pc_time = match.group(1)
    time_ms = int(match.group(2))
    return TimerRelation(pc_time=pc_time, time_ms=time_ms)


def decode_info_byte(info_char: str) -> Dict[str, object]:
    code = ord(info_char)
    marker = bool(code & 64)
    dipole_mode = "vertical" if code & 32 else "horizontal"
    range2 = bool(code & 2)
    range3 = bool(code & 4)
    if not range2 and not range3:
        range_value = 1000
    elif range2 and not range3:
        range_value = 100
    elif range2 and range3:
        range_value = 10
    else:
        range_value = 1
    return {
        "info_byte": code,
        "marker": marker,
        "dipole_mode": dipole_mode,
        "range_value": range_value,
    }


def reading_to_physical(
    raw: Optional[int], range_value: int, component: Optional[int], is_inphase: bool
) -> Optional[float]:
    if raw is None:
        return None
    comp = 0 if component is None else component
    if comp == 1 and not is_inphase:
        return None
    if comp == 0:
        if is_inphase:
            factor = -0.025
        else:
            if range_value == 1000:
                factor = -0.25
            elif range_value == 100:
                factor = -0.025
            elif range_value == 10:
                factor = -0.0025
            else:
                factor = -0.00025
    else:
        if range_value == 1000:
            factor = -0.0625
        elif range_value == 100:
            factor = -0.00625
        elif range_value == 10:
            factor = -0.000625
        else:
            factor = -0.0000625
    return raw * factor


def parse_reading_line(line: str, header: Header, station: Optional[float]) -> Optional[Reading]:
    if len(line) < 3:
        return None
    match = re.match(r"^[T2].(.)([+-]\d{4})([+-]\d{4})?\s*(\d{1,10})", line)
    info_char: str
    if not match:
        fallback = re.match(r"^[T2]([+-]\d{4})([+-]\d{4})?\s*(\d{1,10})", line)
        if not fallback:
            return None
        info_char = "\x00"
        reading1_str = fallback.group(1)
        reading2_str = fallback.group(2)
        timestamp_str = fallback.group(3)
    else:
        info_char = match.group(1)
        reading1_str = match.group(2)
        reading2_str = match.group(3)
        timestamp_str = match.group(4)
    info = decode_info_byte(info_char)
    raw_reading1 = safe_int(reading1_str)
    raw_reading2 = safe_int(reading2_str) if reading2_str else None
    time_ms = int(timestamp_str)
    conductivity = reading_to_physical(raw_reading1, info["range_value"], header.component, False)
    inphase = reading_to_physical(raw_reading2, info["range_value"], header.component, True)
    return Reading(
        time_ms=time_ms,
        info_byte=info["info_byte"],
        marker=info["marker"],
        dipole_mode=info["dipole_mode"],
        range_value=info["range_value"],
        raw_reading1=raw_reading1,
        raw_reading2=raw_reading2,
        conductivity=conductivity,
        inphase=inphase,
        station=station,
    )


def parse_gga_sentence(sentence: str) -> Optional[Tuple[float, float, Dict[str, Optional[float]]]]:
    clean_sentence = sentence.strip()
    if not clean_sentence.startswith("$GPGGA"):
        return None
    parts = clean_sentence.split(",")
    if len(parts) < 10:
        return None
    lat_str, lat_hemi = parts[2], parts[3]
    lon_str, lon_hemi = parts[4], parts[5]
    if not lat_str or not lon_str:
        return None
    try:
        lat = ddmm_to_deg(lat_str, lat_hemi)
        lon = ddmm_to_deg(lon_str, lon_hemi)
    except ValueError:
        return None
    meta: Dict[str, Optional[float]] = {}
    meta["quality"] = safe_int(parts[6])
    meta["satellites"] = safe_int(parts[7])
    meta["hdop"] = safe_float(parts[8])
    meta["altitude"] = safe_float(parts[9])
    return lat, lon, meta


def safe_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def safe_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def ensure_line(lines: List[LineRecord]) -> LineRecord:
    if lines:
        return lines[-1]
    line = LineRecord()
    lines.append(line)
    return line


def parse_em31_file(path: Path) -> Dict[str, object]:
    header = Header()
    lines: List[LineRecord] = []
    gps_buffer: List[str] = []
    current_station: Optional[float] = None
    with open(path, "r", errors="ignore") as f:
        for raw_line in f:
            line = raw_line.strip("\r\n")
            if not line:
                continue
            rec_type = line[0]
            if rec_type == "E":
                header = parse_header_e(line, header)
            elif rec_type == "H":
                header = parse_header_h(line, header)
            elif rec_type == "L":
                line_rec = LineRecord(line_name=line[1:].strip())
                lines.append(line_rec)
            elif rec_type == "B":
                line_rec = ensure_line(lines)
                line_rec.start_station = safe_float(line[1:].strip())
            elif rec_type == "A":
                line_rec = ensure_line(lines)
                direction = line[1:2]
                station_inc = safe_float(line[2:].strip())
                line_rec.direction = direction
                line_rec.station_increment = station_inc
            elif rec_type == "Z":
                line_rec = ensure_line(lines)
                line_rec.created_at = parse_line_created_at(line)
            elif rec_type == "*":
                line_rec = ensure_line(lines)
                timer = parse_timer_relation(line)
                if timer:
                    line_rec.timer_relations.append(timer)
            elif rec_type in ("T", "2"):
                line_rec = ensure_line(lines)
                reading = parse_reading_line(line, header, current_station)
                if reading:
                    line_rec.readings.append(reading)
            elif rec_type == "S":
                station_str = line[1:12]
                current_station = safe_float(station_str.strip())
            elif rec_type in ("@", "#", "!"):
                line_rec = ensure_line(lines)
                gps_payload = line[1:]
                if rec_type == "@":
                    gps_buffer = [gps_payload]
                elif rec_type == "#":
                    gps_buffer.append(gps_payload)
                else:
                    timestamp_match = re.search(r"(\d{1,10})$", line)
                    time_ms = int(timestamp_match.group(1)) if timestamp_match else None
                    sentence = "".join(gps_buffer).strip()
                    parsed = parse_gga_sentence(sentence)
                    if parsed and time_ms is not None:
                        lat, lon, meta = parsed
                        gps_point = GPSPoint(
                            time_ms=time_ms,
                            lat=lat,
                            lon=lon,
                            hdop=meta.get("hdop"),
                            quality=meta.get("quality"),
                            satellites=meta.get("satellites"),
                            altitude=meta.get("altitude"),
                        )
                        line_rec.gps_points.append(gps_point)
                    gps_buffer = []
            else:
                continue
    return {"header": header, "lines": lines}


def match_readings_to_gps(
    readings: List[Reading],
    gps_points: List[GPSPoint],
    max_delta_ms: int = 1000,
) -> List[Tuple[Reading, GPSPoint]]:
    if not readings or not gps_points:
        return []
    readings_sorted = sorted(readings, key=lambda r: r.time_ms)
    gps_sorted = sorted(gps_points, key=lambda g: g.time_ms)
    matches: List[Tuple[Reading, GPSPoint]] = []
    g_idx = 0
    for reading in readings_sorted:
        while (
            g_idx + 1 < len(gps_sorted)
            and abs(gps_sorted[g_idx + 1].time_ms - reading.time_ms)
            <= abs(gps_sorted[g_idx].time_ms - reading.time_ms)
        ):
            g_idx += 1
        delta = abs(gps_sorted[g_idx].time_ms - reading.time_ms)
        if delta <= max_delta_ms:
            matches.append((reading, gps_sorted[g_idx]))
    return matches
