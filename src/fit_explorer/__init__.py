"""Fit Explorer: portable native ROOT storage for two-dimensional fitted models.

PyROOT is loaded only when native ROOT operations are called.
"""
from .io import save_fit_root, write_root_package, standalone_saving_code

__version__ = "0.1.2"
__all__ = ["save_fit_root", "write_root_package", "standalone_saving_code", "__version__"]
