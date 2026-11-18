# Verification of Fit Explorer 0.1.3

## Local checks

- Node.js 24.22.3 build and all four npm unit/server test groups pass.
- Browser regression passes 10 generic, 12 GPU-label and 10 drag-and-drop groups.
- Lifecycle regression passes 30 synthetic ROOT reloads and a 15-second idle
  interval. Sampled DOM-node and event-listener counts remain stable, with one
  viewer canvas, app and drop overlay. Simultaneous-viewer cleanup is checked.
- Browser checks report no uncaught page errors or external requests.
- All eight native Python storage tests pass using deterministic fixtures,
  without minimization or event generation.
- The wheel installs in a fresh virtual environment. Its version/import
  without ROOT and installed command-line help pass.

Tests use the existing pinned dependency installation. The source ZIP is
extracted and rebuilt independently; its standalone HTML is byte-identical
to the offline release. Only the 55 allowlisted source files are archived;
installed dependencies, caches, generated test reports and Git history are
excluded. The offline HTML retains MIT and all bundled third-party notices.

## Numerical integrity and scope

The supplied synthetic ROOT file is byte-identical to the 0.1.2 example. The
scientific saver, demo code, ROOT reader, projection mathematics and count-scale
mathematics are unchanged. No scientific fit, event generation or native
example modification is performed for this release.

Verification is local on macOS with headless Chromium. The bounded lifecycle
check is a regression test, not a guarantee about every browser, driver or
workload. Remote CI results are reported separately in GitHub Actions.

SHA256SUMS.txt binds the release archives and wheel. Prior release files are
preserved.
