from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import List, Optional

import pandas as pd
from pandas import DataFrame

# Cache for the dynamically imported pyEM31 module
_PYEM31_MOD = None


def _load_pyem31_module() -> object:
    """
    Dynamically load the pyEM31 module that ships alongside the project.
    """
    global _PYEM31_MOD
    if _PYEM31_MOD is not None:
        return _PYEM31_MOD
    module_path = Path(__file__).resolve().parent.parent / "pyEM31-main" / "em31.py"
    if not module_path.exists():
        raise FileNotFoundError(f"pyEM31 source not found at {module_path}")
    spec = importlib.util.spec_from_file_location("pyem31_module", module_path)
    if spec is None or spec.loader is None:
        raise ImportError("Unable to prepare import spec for pyEM31")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _PYEM31_MOD = module
    return module


def compute_thickness(appcond: List[Optional[float]], inst_height: float = 0.15) -> List[Optional[float]]:
    """
    Run the pyEM31 thickness post-processing on a list of apparent conductivities.
    Values of None propagate to None in the output.
    """
    module = _load_pyem31_module()
    df: DataFrame = pd.DataFrame({"appcond": appcond})
    # pyEM31 expects a pandas DataFrame and adds a `ttem` column.
    df = module.thickness(df, inst_height=inst_height, coeffs=module.HAAS_2010)
    return [val if pd.notna(val) else None for val in df["ttem"].tolist()]
