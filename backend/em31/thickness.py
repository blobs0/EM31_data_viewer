"""
Thickness computation (vendored from the upstream pyEM31 project).

Upstream: https://github.com/kingjml/pyEM31 (MIT)
Only the minimal thickness retrieval is kept here.
"""

import numpy as np

# Retrieval coefficients (Haas et al.)
HAAS_2010 = [0.98229, 13.404, 1366.4]


def thickness(em31_df, inst_height, coeffs=HAAS_2010):
    """
    Estimate total thickness from apparent conductivity.

    input:
        em31_df: pandas dataframe with an `appcond` column
        inst_height: instrument height above the snow surface
        coeffs: 3 element list of retrieval coefficients
    output:
        em31_df with a `ttem` column
    """
    mod_app_cond = (em31_df["appcond"] - coeffs[1]) / coeffs[2]
    mod_app_cond[mod_app_cond < 0] = np.nan
    em31_df["ttem"] = -1 / coeffs[0] * np.log(mod_app_cond)
    em31_df["ttem"] -= inst_height
    return em31_df

