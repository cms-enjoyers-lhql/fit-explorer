# Changelog

## 0.1.2

- Render axis text as depth-tested glyphs, preserving foreground labels during orbit.
- Place mass axes on camera-facing edges and keep the count axis on the left.
- Exclude the decorative base from text depth; remove obsolete glyphs on scale changes.

## 0.1.1

- Drop a ROOT file anywhere in the viewer to open it.
- A file-drag overlay works across 3D, projections, Data guide and the empty screen.
- Invalid drops preserve the current fit and normal mouse interactions.
- Export the same scene to MP4 and looping GIF.
- Export selected components with a full 360-degree orbit and fixed full-model scale.
- Keep media to the scene, axes/units and a short component label.
- Hide axis labels when the visible model surface occludes them.

## 0.1.0

Initial standalone release preparation.

- Offline 3D fit viewer with glossy lighting and orbit controls.
- Native single-file ROOT input and standalone HTML distribution.
- Automatic extended RooFit component hierarchy and correlated yield errors.
- Smooth projections, persistent draggable windows and log scales.
- Generated-and-fitted twin-Gaussian/power-law synthetic example.
- Copyable saving instructions, Python helper and reproducible demo.
- Optional five-second MP4 export and automated tests.
