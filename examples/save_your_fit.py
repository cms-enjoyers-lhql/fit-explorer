"""Minimal integration template. Supply objects from an existing RooFit fit."""
from fit_explorer import save_fit_root


def export_existing_fit(model, data, result, mass_a, mass_b, output="fit.root"):
    """Call after fitTo(..., Save=True); does not execute another fit."""
    return save_fit_root(
        output,
        model=model,
        data=data,
        result=result,
        axes=[(mass_a, "m(A)", "GeV"), (mass_b, "m(B)", "GeV")],
        title="My fitted model",
    )
