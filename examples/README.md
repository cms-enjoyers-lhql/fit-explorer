# Fitted synthetic example

`twin-gaussian.root` contains a two-dimensional extended RooFit model, a fitted
synthetic dataset, RooFitResult, best-fit and generation-truth snapshots, known
generation counts and all native viewer tables.

- 12,000 fixed-count generated events; seed 20261118.
- Both masses range from 0.08 to 0.92 GeV.
- A two-head Gaussian signal: two products of 1D Gaussians in the two masses.
- A combinatorial background: a product of power-law mass densities.
- Generated counts: head 1 = 2976, head 2 = 1824, background = 7200.
- One extended fit with 13 floating parameters: status 0, covariance quality 3.
- Fitted peak 4796.9 ± 74.0 and background 7203.2 ± 88.8.

The child yields are derived from the fitted peak yield and mixture fraction.
Their errors include the full covariance. They partition the parent yield and
must not be added again on top of the peak.

This is one demonstration, not a coverage or sensitivity study. It uses only
synthetic numbers; no external dataset is required. The distributed ROOT file
has a clean relative filename and has been inspected for personal metadata.

Reproduce in a PyROOT environment after installing this package:

```bash
python -m fit_explorer.demo --output new-demo-run
```

To save an existing model, use the function pattern in `save_your_fit.py` or copy
the standalone function and call template from the viewer's Data guide.
