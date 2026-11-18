# Python saving API

```python
from fit_explorer import save_fit_root

save_fit_root(
    "fit.root",
    model=model,
    data=data,
    result=result,
    axes=[(mass_a, "First mass", "GeV"), (mass_b, "Second mass", "GeV")],
    components=None,
    norm_range=None,
    custom_pdf_classes=(),
    bins=40,
    sample_points=401,
    title="My two-dimensional fit",
    channel="fit",
)
```

Call after the existing RooFit fit, with its RooFitResult. The destination must
not already exist. The output is a native ROOT file containing model, data,
snapshot, covariance and viewer tables.

## Automatic components

An extended RooAddPdf supplies its component PDFs and event yields. Nested
additive mixtures become child components. Their event yields are formula
objects built from the parent yield and ROOT's effective coefficients, including
recursive fractions. Errors use the full saved covariance through
`getPropagatedError`, rather than treating the parent yield and fractions as
independent.

RooExtendPdf wrappers use native expected-events functions. Product PDFs remain
whole shapes: multiplying factors does not create additional event categories.
A non-extended model does not define an estimated event yield, so automatic
saving rejects an invented count normalization.

An explicit mapping remains available for special models:

```python
components={"peak": (signal_pdf, signal_yield),
            "background": (background_pdf, background_yield)}
```

The mapped PDFs and yield objects must belong to the supplied model. IDs are
made safe and unique, while original PDF names, classes and display titles remain
in the ROOT file.

## Domains and data

Automatic hierarchy discovery supports the default full rectangular observable
domain and supported unambiguous coefficient conventions. Restricted/named
normalization domains require a compatible explicit leaf mapping; nested or
conditional cases that cannot be inferred are rejected. Yields must correspond
to the exact declared domain.

Supported data are unit-weight RooDataSet or uniform-bin Poisson RooDataHist.
The saver checks integer bin contents and stored SumW2; integer event weights
are not silently treated as ordinary Poisson counts.

If external constraints, global observables or conditional fit options live
outside the supplied PDF graph, preserve their objects and settings separately
inside the same ROOT file when complete likelihood replay is needed. These
cannot be reconstructed from RooFitResult alone.

## Display integration

Expected counts are native cell integrals normalized in the declared joint 2D
domain and multiplied by the saved yield. Dense curves integrate over individual
bins of the other observable and include the original projection-bin width.
Children are checked against their parent in count grids and dense tables.
The observed total is not used to rescale model yields.

Higher `bins` and `sample_points` improve display resolution and require more
integration work. This is done once during saving; the browser then reads native
ROOT display objects without executing PDFs. Saving does not call fitting,
minimization, generation or event selection.
