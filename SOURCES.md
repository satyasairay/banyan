# SOURCES — asset provenance

**The engine and all shipped scenes are 100% procedural. Zero external assets are
bundled.**

| Asset | Source | License |
|---|---|---|
| Tree geometry, bark, leaves | procedural (this codebase) | — |
| White Studio scene | procedural (`scenes/white-studio.scenespec.json`) | — |
| Golden Hour scene — warm gradient sky, procedural sunset IBL, low key light, moss/earth ground, dust motes, fog, bloom + warm grade | procedural (`scenes/golden-hour.scenespec.json`, `src/scenes.js`) | — |
| Firefly Night Garden scene — night gradient, moonlight, lantern mesh, fireflies, moss ground | procedural (`src/scenes.js`) | — |
| Ink-Wash Garden scene — paper post-process, ink ground strokes, falling ink leaves | procedural (`src/scenes.js`) | — |
| three.js r165 (CDN import map, not bundled) | https://threejs.org | MIT |
| esbuild (dev dependency only, not shipped) | https://esbuild.github.io | MIT |

Notes:

- `SceneSpec.ibl.source: "hdri"` is implemented so you can drop in your own
  equirectangular `.hdr` — no HDRI ships with this repository. If one is ever
  bundled, it must be CC0 with provenance recorded here.
- All GLSL noise in scenes/props is authored in this repository (same value-noise
  recipe as the bark shader).
- The four registered scenes are `white-studio`, `golden-hour`, `firefly-night`
  and `ink-wash`.
