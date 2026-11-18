# Single-file ROOT format

Fit Explorer reads native display objects under `fit_explorer/`. The browser
does not execute RooFit PDFs or custom C++ code. Use the supported
[Python saving API](PYTHON_API.md) or the matching code in Data guide to create
the tables after an existing fit.

## Native fit and display tables

The standard saver preserves a `workspace` RooWorkspace, its `best_fit`
snapshot and `fit_result` RooFitResult. These retain the native model, data and
covariance for separate ROOT use. Viewing requires the display tables below;
a workspace alone is not a directly loadable viewer file.

| Path under `fit_explorer/` | ROOT object | Meaning |
| --- | --- | --- |
| `format` | TNamed | Title must be `fit-explorer.root/1` |
| `title`, `channel`, `baseline_id` | TNamed | Display labels and optional provenance identifier |
| `x_name`, `x_label`, `x_unit` | TNamed | First observable identity, label and unit |
| `y_name`, `y_label`, `y_unit` | TNamed | Second observable identity, label and unit |
| `observed` | TH2D | Observed counts and both bin-edge arrays |
| `poisson_low`, `poisson_high` | TH1D | Lower and upper Poisson count-interval lookup tables |
| `z_max` | TParameter<double> | Common display count maximum |
| `parameters` | TList | Saved parameter names, values, errors and fixed/free metadata |
| `components/<id>/` | TDirectory | One top-level model component |
| `projections/axis0/`, `projections/axis1/` | TDirectory | Optional paired smooth-projection tables |

Every component directory contains an `expected` TH2D on the observed axes,
`yield` and `error` TParameter<double> objects, and parameter metadata. Labels,
descriptions, colors and an integer `order` describe presentation. Optional
`children/<id>/` directories repeat the same structure for nested mixtures.
IDs must be safe and globally unique. The total model is the sum of the
top-level components; children partition their parent and are not additional
event yields.

Expected cell values are integrated candidate counts in the declared joint
normalization domain, not densities at bin centers. They retain the fitted
yield normalization and are not rescaled to the observed total. Child-yield
errors use the saved fit covariance through the native yield expressions.

## Smooth projections

Each projection axis contains a `points` TGraph, a positive `bin_width`
TParameter<double>, and `components/<id>` TH2D tables for all component and
child IDs. Table X bins index the graph's increasing sample coordinates;
table Y bins use the other observable's actual bin edges.

A table value integrates the saved PDF over one bin of the other observable,
then multiplies by the original projection-bin width and the component yield.
Selecting a mass window sums the corresponding table columns. These curves
are projections of the same saved 2D model, not independent 1D fits. Provide
both axes together, with component grids and axis edges consistent throughout.

## Supported inputs and limits

The standard saver accepts unit-weight RooDataSet or uniform-bin Poisson
RooDataHist inputs. Arbitrary weighted samples and SumW2 errors are not
supported by this public format implementation. It does not invent absolute
yields for a shape-only model. See the Python API for explicit component
mapping and normalization-domain restrictions.

The current reader limits a file to 256 MiB, requires at least two bins per
axis, and limits the display grid to 262,144 cells. It validates hierarchy,
axis consistency, numerical values and projection-table dimensions before
replacing the currently loaded fit. The self-contained synthetic reference is
[`examples/twin-gaussian.root`](../examples/twin-gaussian.root).

Preserve any external constraints, global observables and conditional fit
settings separately in the same ROOT file when complete likelihood replay is
needed; display tables and RooFitResult alone do not reconstruct them.
