# Third-party notices

Project source code and the included synthetic example are distributed under the
root [MIT license](LICENSE). Third-party software and fonts keep their own
licenses; project licensing does not replace those notices.

| Component | Use | License / notice file |
| --- | --- | --- |
| Three.js 0.182.0 | 3D rendering | [MIT](LICENSES/three.txt) |
| JSROOT 7.12.0 | Native ROOT file reader | [MIT](LICENSES/jsroot.txt) |
| IBM Plex Mono via Fontsource 5.3.0 | Bundled unmodified Latin font files | [SIL OFL 1.1](LICENSES/fontsource-ibm-plex-mono.txt) |
| One Identity Zstd wrapper | Browser decompression | [MIT](LICENSES/oneidentity-zstd-js.txt) |
| Zstandard | Compiled decompression codec | [BSD 3-Clause](LICENSES/zstd-bsd.txt) |
| LZMA-JS | Browser decompression | [MIT](LICENSES/lzma-mit.txt) |
| LZ4 browser implementation | Browser decompression | [MIT](LICENSES/lz4-mit.txt) |
| core-js 3.9.0 codec runtime | Browser codec compatibility | [MIT](LICENSES/core-js-mit.txt) |
| JSROOT inflate implementation | ZLIB decompression | [Source attribution](LICENSES/jsroot-inflate-notice.txt) |

The build includes all files from `LICENSES/`, plus license comments retained by
esbuild, in `dist/THIRD_PARTY_LICENSES.txt` and inside the standalone HTML.
The offline distribution includes these notices alongside the viewer.

Node build/test tools such as esbuild and Playwright are installed through npm
and retain their upstream licenses. Their complete package sources are not
copied into the source archive. ROOT/PyROOT is an external prerequisite for the
Python saver; the ROOT framework libraries are not redistributed here.

Upstream projects: [Three.js](https://threejs.org/),
[JSROOT](https://github.com/root-project/jsroot),
[IBM Plex](https://github.com/IBM/plex),
[Fontsource](https://fontsource.org/),
[Zstandard](https://github.com/facebook/zstd),
[core-js](https://github.com/zloirock/core-js),
[LZMA-JS](https://github.com/LZMA-JS/LZMA-JS).
