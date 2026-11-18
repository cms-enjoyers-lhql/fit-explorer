# Fit Explorer 0.1.2

Fixes foreground mass-axis text disappearing during camera rotation.
Axis glyphs now use model-only GPU depth testing. Partially covered words
keep their visible glyph fragments; the decorative base cannot erase text.
Mass axes follow the camera-facing edges and the count axis stays on the left.

Source ZIP, standalone offline viewer and optional Python wheel are included.
The supplied synthetic ROOT example and scientific backend are unchanged.
MIT and bundled third-party notices are retained. Nothing is published.
See VERIFICATION.md and SHA256SUMS.txt.

Publication preparation adds the missing ROOT format reference to the source
archive (54 files). Runtime code, native example, offline ZIP and wheel are
unchanged; SHA256SUMS.txt reflects the updated source archive.

The browser CI runner is pinned to Ubuntu 24.04 to match Playwright 1.56.1.
The initial remote run passed Python packaging, npm tests and the browser
build, but its Ubuntu 26.04 browser installation was unsupported. See GitHub
Actions for the current remote validation result. Runtime files, offline ZIP
and wheel remain unchanged.
