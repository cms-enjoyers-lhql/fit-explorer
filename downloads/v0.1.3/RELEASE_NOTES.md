# Fit Explorer 0.1.3

Fixes graphics resources retained when a loaded fit viewer is replaced or
closed. Shared axis-sprite geometry is disposed during viewer teardown,
releasing the previous renderer's disposal listeners.

A repeated synthetic ROOT-loading regression now checks viewer cleanup and
idle memory behavior. Existing camera, labels, projections and file loading
remain covered by browser regression checks.

The native ROOT format, scientific saving helper, fitted synthetic example,
component yields, covariance and projection calculations are unchanged.

The release includes a source ZIP, self-contained offline viewer ZIP and
optional Python wheel. MIT and bundled third-party license notices are retained.
See VERIFICATION.md, SOURCE_FILES.txt and SHA256SUMS.txt.
