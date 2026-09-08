# Changelog

## [study-3] — 2026-09-08 — the horizon meets the graded sky

Colour only. No geometry, no rng, no shader change; `?skin=` and `?weather=`
absent, the build draws the same pixels as study-2, and all ten gold seeds
reproduce their four digests on the same hardware.

- A skin or a weather grades the sky dome; the far ground melts into the sky it
  meets and the fog is that same sky. Before this, the grade stopped at the dome
  and the band below it kept the scene's own horizon colour, a one-row step
  across the frame. After each grade the ground melt and the fog now copy the
  dome's graded horizon, so the band carries the grade.
- The composed sky uniforms of an active skin are capped at 0.92 in linear light
  so the dome's additive sun bloom keeps headroom; Soft Dawn stops clipping its
  red channel over the lower sky.
- The public build no longer offers the palettes or the weathers: `PUBLIC_SKIN_IDS` and
  `PUBLIC_WEATHER_IDS` are empty, `?skin=` and `?weather=` fall back to the base look,
  `capabilities` reads `skin:0, weather:0`, and the gallery's mist entry is withdrawn. The
  light grades and the weathers are the product's paid enhancements, not part of this
  study; the seam fix above stays in the source for the product's sake.
- Source `D3CE5E7C…`, runtime `35004159…`, byte-for-byte on `--check`. Ported
  from the EverBanyan product at 67c1579 (Prompt 42).

## [study-2] — 2026-09-08 — the frame budget

Nothing here moves the geometry. All ten gold seeds reproduce `checksum()`, the
combined geometry digest, the anchors digest and the environment checksum on
this build, on the same hardware that certified the previous one.

- Shading is gated by screen footprint. Leaf venation, bark relief and the soil
  detail stop being computed once the feature they describe is smaller than the
  pixels it lands on.
- The soft shadow filter is a 4x4 hardware compare on a depth texture under
  WebGL2, in place of 64 point fetches and their RGBA unpack. The penumbra
  width is unchanged and was measured with the same metric. WebGL1 keeps the
  old filter, and so does `?hwshadow=0`.
- Shader compilation no longer arrives as one lump before the first frame. The
  programs compile in time-budgeted slices, or through `compileAsync` when the
  browser's cache is cold, and the page draws nothing until they are ready.
- A drag or an orbit renders at pixel ratio 1 on a dense display and goes back
  to the preset's cap when the hand comes off (`?dragdpr=0` turns this off).
- The five bark noise fields are baked once at build time on the GPU and stored
  with the mesh. The trunk carries about 125,000 vertices; evaluating those
  fields per vertex cost an iPhone 13 6.2 ms of a 24 ms frame.
- `?stills=1` widens the shadow footprint and smooths the leaf laminae for
  offline 4K renders. The live page never pays for it.
- Measured on a Radeon 740M in Chrome at `balanced`: 21.0 ms of GPU time per
  frame before, about 12.7 ms after. On an iPhone 13 a drag holds above 30 fps.
  A first visit on the phone did not get faster.
- The public panel offers the banyan study only. The magnolia entry stays listed as
  "coming soon" and cannot be selected; the cherry entry is gone; a `?species=` other
  than banyan falls back to banyan. The engine data for the other studies is
  unchanged and unreachable from the public surface.

Runtime `201B36553740823A7F3835064CBA00F8B52676FB3ECD02930A7474902AF22CC4`,
source `2BEDD59174981E8D2DDB8C64A6535860B735863312A8B7EEF4BC39479A157A5D`.
Ported from the EverBanyan product renderer at commit `c65b102` (source
`93262D959B30DD12D6932BE49F71B2B3E9FA3357FB3B1A25CBA7E7DBFC011944`), the build live on
everbanyan.com since 2026-09-07; `gold/gold-banyan-1.json` is byte-identical to the
product's manifest, and the ten-seed witness on this exact file is recorded in the
product repository at `review/fix/40/2026-09-07/banyan-port-digests/`.

## [study-1] — 2026-08-26 — the public tree study cut

- Repository reshaped around the current v5 runtime — the engine as it matured
  in production through 2026-08-05: reproducible standalone build (LF-normalized,
  hash-stamped), readable source, vendored three.js, gold-seed catalogue with
  preview images and geometry checksums.
- The faith-emblem remembrance objects are not present in this public build;
  the runtime's `capabilities.refusedObjects` records them as refused.
- The former July-era library build (`src/` modules, ESM bundle, examples) is
  retired from this repository; the earlier single-file artifacts remain below
  as the engine's evolution history.

---

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
