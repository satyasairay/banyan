# Changelog

All notable changes to the Banyan Engine. Format follows
[Keep a Changelog](https://keepachangelog.com/); the banyan determinism baseline is
byte-identical from v0.4.0 onward (the integer-hash re-baseline), and every later change
is spec-gated so the baseline never moved.

## [1.0.0] — 2026-07-07 — Launch pack

Added
- **GLB export now includes the blossom instancer** — cherry-family flowers bake to
  vertex-colored geometry alongside wood and leaves (validates 0 errors / 0 warnings).
- **Deep links**: the standalone boots from `?species=&seed=&scene=&leaves=&quality=&view=`
  URL params, and the address bar updates as you change the tree so any view is shareable.
- **Four examples** (`examples/01-minimal … 04-species-swap`).
- **Docs**: full `README.md` with the complete `TreeSpec/v1` and `SceneSpec/v1` reference,
  species catalogue with hero seeds, performance notes, and honesty notes on GLB.
- **Packaging**: distributable zips; GitHub Pages demo site. (The license of this
  repository is AGPL-3.0 — see `LICENSE`.)

## [0.8.0] — 2026-07-07 — GPU hotfixes

Fixed
- Composer scenes rendered black on real ANGLE/D3D11 GPUs — the half-float MSAA composer
  target now uses `samples:0`; the renderer pins the discrete GPU and drops
  `preserveDrawingBuffer`. **Temple Ruin was retired and replaced by Golden Hour**, built
  from proven-safe elements.
- Branch/trunk junction seams — a mesh-time **collar flare** swells child-branch bases into
  the parent (consumes no rng; baseline unchanged). Cured the pine "floating limb".
- Panel `<select>` overflow with long option labels.

## [0.7.0] — 2026-07-04 — Species line

Added
- **TreeSpec/v1**: `habit.form` (dome/pads/cascade/cone/bottle), `scaffolds`, `strands`,
  `foliage.system` (blades/tufts), `blade.outline`, `blossom`, `bark.style` — all optional
  with banyan-literal defaults, so the banyan stream is byte-identical.
- **Six species** as specs, not forks: Dead Winter Oak (free), English Oak, Cherry Blossom,
  Baobab, Japanese Black Pine, Weeping Willow — each with a curated hero seed and its own
  determinism baseline (`verify/species.mjs`).

## [0.6.0] — 2026-07-03 — Scenes

Added
- **SceneSpec/v1** and the scene rig: background / IBL / lights / ground / atmosphere /
  props / post / camera / `treeOverrides`, all data, all procedural.
- Runtime scene swap that **never rebuilds the tree** (verified: leaf world positions and
  instance counts identical across swaps).

## [0.5.0] — 2026-07-03 — Tooling & marketing

Added
- Seed gallery tool (`tools/seed-gallery.html`) — grid-render N seeds, click to export PNG.
- **GLB export v1** (vertex-color: wood AO + per-leaf color).
- Seed-morph launch GIF.

## [0.4.0] — 2026-07-03 — Engine core

Changed
- ES-module split (`src/`) with an esbuild single-file emit (`dist/banyan.standalone.html`)
  plus an importable `dist/banyan.module.js`.
- Bark palette as live shader uniforms; leaf **re-grade** path (recolor with no rebuild).
- Window-fitting renderer + DPR + `quality` presets (auto/high/mobile).
- **Integer bit-mixing hash** replacing `Math.sin` noise for cross-engine determinism
  (deliberate, labelled re-baseline).
- Blunt root tips + auto-fit shadow frustum.

## [0.1.0] — 2026-07-03 — Spec extraction

Added
- `BANYAN_SPEC` extraction (every identity number in one object), regenerate-in-place
  `build()`, and a dependency-free control panel. Verified byte-identical to the original
  one-off across seeds.
