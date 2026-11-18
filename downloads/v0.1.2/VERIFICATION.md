# Verification of Fit Explorer 0.1.2

## Display regression checks

- Ten generic browser groups: components, projections, cameras, log display,
  ROOT picker/download and responsive layout.
- Twelve GPU text groups measure actual alpha pixels against a depth-free
  reference, rather than relying on DOM visibility or submitted Sprite flags.
- All mass titles and all five/four mass ticks retain their foreground ink at
  the reproduced failing orbit angle and four cardinal views.
- Fully hidden and partially covered glyphs respect the fitted surface depth;
  the decorative base cannot erase text.
- Linear/log switching removes obsolete glyphs; near zoom, minimum-distance
  low elevation and Retina DPR2 preserve correct text rendering/measurement.
- Ten ROOT drag-and-drop groups preserve loading, errors and pointer gestures.
- Eight export camera angles plus a full five-second MP4/GIF capture pass.
  The model count scale, count ticks and numerical package SHA remain fixed.

## Packaging and numerical integrity

Source ZIP extraction, clean npm installation, tests and build are checked
with Node.js 24.22.3. The rebuilt standalone HTML matches the offline release.
The Python wheel is installed in a clean environment; import without ROOT and
CLI help are checked.

The synthetic ROOT example is byte-identical to the approved 0.1.0/0.1.1 asset.
The scientific saver, ROOT reader, projection mathematics and native fitted
parameters/covariance are unchanged. No event generation or minimization is run.

Source, binary, archives and metadata are scanned for private data, personal
identity, paths, secrets and cache/history files. Only the supplied synthetic
example is included. MIT and all third-party licenses are retained.

Checks are local on macOS. The prepared GitHub Actions workflow has not run
remotely. Nothing has been uploaded or published; prior release archives are
preserved. SHA256SUMS.txt binds the release files.

Publication preparation adds the missing ROOT format reference to the source
archive (54 files). Runtime code, native example, offline ZIP and wheel are
unchanged; SHA256SUMS.txt reflects the updated source archive.

The browser CI runner is pinned to Ubuntu 24.04 to match Playwright 1.56.1.
The initial remote run passed Python packaging, npm tests and the browser
build, but its Ubuntu 26.04 browser installation was unsupported. See GitHub
Actions for the current remote validation result. Runtime files, offline ZIP
and wheel remain unchanged.
