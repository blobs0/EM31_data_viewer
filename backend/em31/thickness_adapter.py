from __future__ import annotations

from typing import List, Optional

import pandas as pd
from pandas import DataFrame

from .thickness import HAAS_2010, thickness


def compute_thickness(
    appcond: List[Optional[float]],
    inst_height: float = 0.15,
    coeffs: List[float] = HAAS_2010,
) -> List[Optional[float]]:
    """
    Run the pyEM31 thickness post-processing on a list of apparent conductivities.
    Values of None propagate to None in the output.
    """
    if coeffs is None:
        coeffs = HAAS_2010
    df: DataFrame = pd.DataFrame({"appcond": appcond})
    df = thickness(df, inst_height=inst_height, coeffs=coeffs)
    return [val if pd.notna(val) else None for val in df["ttem"].tolist()]
