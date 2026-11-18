# Installation

## Offline viewer

Extract the offline release and open `FitExplorer.html` in a modern browser.
The synthetic fit, fonts, ROOT reader and compression codecs are bundled.
Loading a saved ROOT file works without a server or network connection.

## Source installation

Use Node.js 22.22.2+, 24.15+ or 26+ with npm, then run from the repository root:

```bash
npm ci --ignore-scripts
npm run build
npm start
```

Keep optional npm dependencies enabled: esbuild uses a platform-specific package.
Install scripts are not needed for this browser-only distribution. The full
upstream ROOT reader also contains optional Node graphics dependencies; Fit
Explorer only bundles its file reader and browser codecs.

The local server serves the built viewer on loopback. It has no file upload or
native execution endpoint. The build also produces a standalone
`dist/fit-explorer.html`, which can be copied to another computer.

## Python saving helper

Python 3.10+ is required. Install ROOT with working PyROOT using the
[official ROOT installation instructions](https://root.cern/install/).
For example, in a Conda environment:

```bash
conda create -n fit-explorer -c conda-forge python=3.11 root pip
conda activate fit-explorer
python -m pip install .
```

Check the native library before saving:

```bash
python -c "import ROOT; print(ROOT.gROOT.GetVersion())"
```

The Python package does not install or bundle ROOT. Its import is lazy, so
importing the helper without ROOT works; saving or reproducing the example
requires ROOT at runtime. No NumPy or SciPy package is required by the saver.

## Optional MP4 and GIF export

Install FFmpeg using your operating system's package manager. Install the pinned
Playwright browser with:

```bash
npx playwright install chromium
npm run render -- --output animation
```

Use a new output directory. A compatible existing Chromium executable can be selected with
`--browser /path/to/chromium` or the `FIT_EXPLORER_BROWSER` environment variable.
No personal browser profile is accessed. Rendering runs headlessly and uses the
same ROOT file and numerical arrays as the interactive viewer.

Each run writes `poster.png`, `fit-animation.mp4`, `fit-animation.gif` and a
`render-report.json` with data-integrity checks. Existing named outputs are never
overwritten. The default follows the five-second additive timeline. Media shows the scene,
axes/units and a short component label. Audit details remain in the report.

For a full 360-degree orbit of selected components at their saved yields:

```bash
npm run render -- --output peak-animation --components twin_peak --label "Twin Gaussian peak"
```

Component IDs come from the ROOT display hierarchy. Pass comma-separated IDs
for a group, or `--components all --label "Full model"` for the complete model. Parent/child double-counting is rejected by the viewer. Selection
keeps the original full-model count scale; it does not normalize each peak.
`--gif-width 1280` and `--gif-fps 15` control GIF size; `--poster-only` skips video.
Use `--root fit.root` to load another compatible ROOT file, or `--url file:///path/to/FitExplorer.html`
for an existing compatible standalone viewer. The renderer preserves that
viewer's data and error model; a weighted viewer remains weighted.

## Troubleshooting

- A workspace-only file needs display tables added by `save_fit_root`.
- A saving-state error means model parameter values or fixed/free flags changed
  after fitting; restore the saved best-fit state before saving.
- Weighted data or a restricted/conditional coefficient convention may require
  an explicit compatible adapter; do not silently convert weights to Poisson data.
- If Chromium is unavailable, install it with Playwright or pass a compatible
  executable. Viewing the prebuilt HTML does not require Playwright.
