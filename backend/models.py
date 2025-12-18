from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional


@dataclass
class Header:
    program: Optional[str] = None
    version: Optional[str] = None
    survey_type: Optional[str] = None
    unit_type: Optional[int] = None
    dipole: Optional[int] = None
    mode: Optional[int] = None
    component: Optional[int] = None
    field_computer: Optional[int] = None
    file_name: Optional[str] = None
    mode_parameter: Optional[float] = None


@dataclass
class TimerRelation:
    pc_time: str
    time_ms: int


@dataclass
class Reading:
    time_ms: int
    info_byte: int
    marker: bool
    dipole_mode: str
    range_value: int
    raw_reading1: Optional[int]
    raw_reading2: Optional[int]
    conductivity: Optional[float]
    inphase: Optional[float]
    station: Optional[float] = None


@dataclass
class GPSPoint:
    time_ms: int
    lat: float
    lon: float
    hdop: Optional[float] = None
    quality: Optional[int] = None
    satellites: Optional[int] = None
    altitude: Optional[float] = None


@dataclass
class LineRecord:
    line_name: Optional[str] = None
    start_station: Optional[float] = None
    station_increment: Optional[float] = None
    direction: Optional[str] = None
    created_at: Optional[datetime] = None
    timer_relations: List[TimerRelation] = field(default_factory=list)
    readings: List[Reading] = field(default_factory=list)
    gps_points: List[GPSPoint] = field(default_factory=list)
