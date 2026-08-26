# Banyan — a procedural tree engine for three.js

Banyan grows art-directed trees in the browser from a single number. One readable,
zero-asset file, three.js r165, no build step for you to run. Every tree is a **seed**
plus a **spec**: change the seed and you get a different tree that is *exactly*
reproducible on any machine; change the spec and you get a different species.

- **Zero assets.** No textures, no models, no HDRIs. Bark, leaves, blossoms, bark
  relief and every environment are generated in code. The whole thing is one file you
  can read.
- **Deterministic.** The seed is a 32-bit integer, so each spec addresses
  **4,294,967,296** distinct trees, and a seed renders identically across browsers and
  GPUs. A seed is the artwork's address — shareable, linkable, collectable.
- **Data-driven.** A species is a `TreeSpec` (JSON). An environment is a `SceneSpec`
  (JSON). Swapping either is data, not code — the scene swap never rebuilds the tree.
- **Seven species, four scenes** ship in the box, plus GLB export and a seed gallery.

> **Contents:** [60-second embed](#60-second-embed) · [Seeds & determinism](#seeds--determinism)
> · [TreeSpec/v1 reference](#treespecv1-reference) · [SceneSpec/v1 reference](#scenespecv1-reference)
> · [Species catalogue](#species-catalogue) · [Using it as a library](#using-it-as-a-library)
> · [GLB export](#glb-export) · [Performance](#performance) · [License](#license) · [Support](#support)

---

## 60-second embed

The engine is one self-contained file, `dist/banyan.standalone.html`. To put a specific
tree on any page, point an `<iframe>` at it and deep-link the tree with URL params:

```html
<iframe
  src="banyan.standalone.html?species=cherry-blossom&seed=1892&scene=firefly-night"
  style="width:100%;height:600px;border:0"
  title="Banyan"></iframe>
```

That's the whole integration. No bundler, no npm install. Deep-link params:

| Param | Values | Notes |
|---|---|---|
| `species` | `banyan` · `dead-winter-oak` · `english-oak` · `cherry-blossom` · `baobab` · `black-pine` · `weeping-willow` | which spec to grow |
| `seed` | any 32-bit integer | the tree's address |
| `scene` | `white-studio` · `golden-hour` · `firefly-night` · `ink-wash` | the environment |
| `leaves` | integer | optional leaf-instance count |
| `quality` | `auto` · `high` · `mobile` | optional performance preset |
| `view` | `az,el,dist` | optional initial camera |

As you change species / seed / scene in the panel, the address bar updates to match, so
any view you like is a URL you can copy and share.

See [`examples/`](examples/) for four runnable examples, simplest first.

---

## Seeds & determinism

Determinism is the product, so it is worth being precise about what is guaranteed.

Every random decision in the engine comes from **one seeded stream** (`mulberry32`),
and every noise value that shapes geometry comes from an **integer bit-mixing hash** —
exact integer math, identical on every JS engine. Given the same `seed` and the same
spec, you get byte-for-byte the same tree in Chrome, Firefox, Safari, a headless Node
re-derivation, or a colleague's laptop. That is what makes a seed safe to sell, print,
or link to.

Two rules that follow from this, and that the codebase enforces:

1. **New features are spec-gated.** A field the reference banyan spec doesn't have
   consumes zero draws, so adding species and features never disturbed the banyan
   baseline. (That single discipline is how six more species shipped without moving the
   original tree by a vertex.)
2. **Re-baselining is deliberate.** The determinism harness (`verify/run.mjs` for the
   banyan baseline, `verify/species.mjs` per species) is the regression gate. Numbers
   only change in labelled commits, never by accident.

The seed is a 32-bit integer → **4,294,967,296 trees per spec**, multiplied again by
every spec edit. For practical purposes the space is inexhaustible; the real work is
curation (the hero seeds below).

---

## TreeSpec/v1 reference

A species is one JSON object. **Every field is optional** — anything you omit falls back
to the banyan literal, so the smallest valid spec is `{ "seed": 1892 }`. Ranges below are
the shipped values across the seven species; treat them as sane bounds, not hard limits.

### Top level

| Field | Type | Default | Notes |
|---|---|---|---|
| `seed` | int | `1892` | the tree's address |
| `leafCount` | int | `6800` | leaf instances requested (capped by quality) |
| `quality` | `auto`·`high`·`mobile` | `auto` | performance preset (see [Performance](#performance)) |

### `habit` — overall silhouette

| Field | Type | Default | Notes |
|---|---|---|---|
| `form` | `dome`·`pads`·`cascade`·`cone`·`bottle` | `dome` | canopy field shape. `pads` = azimuth-lobed dome (niwaki plateaus); `cascade` flips the steer term mid-growth for weeping habits; `bottle` = dome alias for stout crowns |
| `field.base` / `field.amp` / `field.falloff` | float | `1.08` / `0.92` / `2.0` | the umbrella "domeY" field that pulls growth into the canopy |
| `steer` | float 0–0.3 | `0.22` | how hard branches are steered toward the field |
| `outward` | float 0–0.12 | `0.05` | outward bias from the trunk axis |
| `pads` | `{lobes,amp,phase}` | — | only for `form:"pads"` (pine): plateau count, depth, rotation |
| `cascade` | `{riseRadius,drop,reach}` | — | only for `form:"cascade"` (willow): rise radius, downward drop, horizontal reach |
| `clampY` | float | — | floor the canopy field (willow uses `0.8`) |

### `trunk`

| Field | Type | Range | Notes |
|---|---|---|---|
| `height` | float | 0.9–1.25 | trunk length before the crown |
| `r0` / `r1` | float | 0.16–0.42 / 0.10–0.19 | base / top radius |
| `lean` | float | 0.03–0.22 | lateral lean |
| `wobble` | float | 0.05–0.13 | trunk-axis noise |
| `radiusPow` | float | 0.62–0.9 | taper curve |
| `gnarl` | float | 0.05–0.14 | surface knot amount |
| `lobes` | `{count,base,amp,sharp,span,mode}` | — | fluted buttress lobes; `mode:"ground"` flares near the base |

### `recursion` — the branch tree

| Field | Type | Notes |
|---|---|---|
| `maxDepth` | int 3–5 | recursion depth (dead-winter-oak goes to 5 for twig lace) |
| `minRadius` | float | stop growing below this radius |
| `spacing` | `{ "1":.., "2":.., ... }` | child spacing per depth |
| `lenByDepth` | `{ "2":[lo,hi], ... }` | child length range per depth |
| `wig` | `[..]` | wiggle per depth (index = depth) |
| `steer` | `[..]` | field-steer strength per depth |
| `childRadius` | `[lo,hi]` | child/parent radius ratio |
| `upBias` | float | upward bias on new children |
| `gnarlByDepth` | `[..]` | gnarl per depth |

### `scaffolds` — primary limbs (optional)

Controls the low / upper / apex scaffold limbs. Defaults reproduce banyan's hardcoded
1/5/3 arrangement. Fields: `low`, `upper`, `apex` (counts); `elevation:[lo,hi]`;
`lowLen`, `upperLen:[lo,hi]`, `apexLen:[lo,hi]`; `upperAt:[lo,hi]`, `lowElev`, `lowAt`;
`upperR0:[lo,hi]`, `apexR0:[lo,hi]` (limb base radii — baobab raises these for stout
primaries).

### `strands` — pendant chains (optional; willow)

Gravity-following child chains that carry leaf anchors. Fields: `fromDepth`,
`perTip:[lo,hi]`, `len:[lo,hi]`, `r0`, `sway`, `gravity`, `gnarl`. Absent ⇒ no strands
drawn and zero draws consumed.

### `propRoots` / `surfaceRoots` — roots (optional; `null` to disable)

`propRoots` (banyan's aerial roots): `{count,thick,gnarl,feet,minAzimuthSep,eligibility,
topR,thickR,thinR}`. `surfaceRoots` (basal flare roots): `{count,gnarl,length,r0,
startHeight}`. Set either to `null` (as every non-banyan species does) to omit it.

### `foliage`

| Field | Type | Default | Notes |
|---|---|---|---|
| `system` | `blades`·`tufts` | `blades` | `tufts` = needle fans (pine), with `tuft:{needles,spread}` |
| `blade.length` / `blade.widthRatio` | float | 0.135 / 0.33 | leaf blade size |
| `blade.outline` | `ovate`·`lobed`·`narrow`·`needle` | `ovate` | leaf silhouette (`lobed` = oak, `narrow` = willow, `needle` = pine) |
| `blade.keel` / `recurve` / `droop` / `lift` | float | — | blade sculpt (willow droops, etc.) |
| `anchor` | `{step,startFrac,jitter,maxTwigRadius,tipWeight,tipThresh,tipBonus}` | — | where leaves attach along twigs (tip-biased) |
| `scale` | `[lo,hi]` | `[0.80,1.25]` | per-leaf scale jitter |
| `palette` | `{h,hJitter,sunHue,s,lBase,lSun,lJitter,senescent{rate,h,s,l}}` | — | HSL leaf color; `senescent.rate` is the fraction turned autumnal |

### `blossom` — second instancer (optional; cherry family)

`{count, clusterSize, clusterRadius, size, sizeJitter:[lo,hi], palette:{h:[lo,hi],
s:[lo,hi], l:[lo,hi]}}`. One instance is a cluster of five-petal flowers; drawn from the
shared stream *after* the leaves. Absent ⇒ zero draws.

### `bark`

| Field | Type | Notes |
|---|---|---|
| `style` | `ridged`·`smooth` | default `ridged`; `smooth` adds sheen bands + horizontal lenticels (cherry, baobab) |
| `crevice` / `ridge` | `[r,g,b]` | crevice and ridge tones (linear 0–1) |
| `lenticel` | `[r,g,b]` | only for `style:"smooth"` |
| `striaScale` / `mottleScale` / `bump` | float | bark-relief noise scales + bump strength |

---

## SceneSpec/v1 reference

An environment is one JSON object. The rig owns *everything around the tree* — lights,
ground, IBL, atmosphere, props, post — and **never touches the tree's rng** (all scene
randomness comes from a private `seed`). Swapping a scene does not rebuild the tree.

| Field | Notes |
|---|---|
| `background` | `{type:"color",value}` or `{type:"gradient",top,bottom,curve}` |
| `ibl` | `source:"room"` (studio PMREM), `"gradient"` (procedural sky PMREM), or `"hdri"` (drop in your own `.hdr` — none ships), plus `intensity` |
| `lights[]` | roles `key` (directional + shadow), `fill` (hemisphere), `lantern`/point (with `flicker`), ambient. Shadow: `frustum:"auto-fit-tree"`, `mapSize`, `bias`, `normalBias` |
| `ground` | `type:"mesh"` (procedural material e.g. `moss`) or `"shadowcatcher"`, with a radial `fade:{color,inner,outer}` that dissolves the shadow into the page |
| `atmosphere` | `fog:{type:"exp2"|"linear",color,density}` and `particles:{preset:"motes"|"fireflies"|"inkleaves",count,color,area,size}` |
| `props[]` | procedural registry: `procedural:lantern` (more in the prop-pack roadmap), with `position`/`color` |
| `post[]` | ordered passes: `bloom{strength,radius,threshold}` then grade / inkwash |
| `camera` | `{position,target,fov}` |
| `treeOverrides` | how this scene re-lights the tree: `envMapIntensity`, `exposure`, `backlight:{color,intensity}`, `leafGrade:{hueShift,satMul,lightMul}` (re-runs the leaf color pass so foliage reads correctly under each light — and returns bit-for-bit to the studio look) |

The four shipped scenes: **White Studio** (the clean default — itself a SceneSpec, proving
the swap is code-free), **Golden Hour** (warm, atmospheric), **Firefly Night Garden**
(moonlight + a modeled paper lantern + blinking fireflies through bloom), and **Ink-Wash
Garden** (paper post-process, falling ink leaves, near-zero GPU cost).

---

## Species catalogue

Seven species ship as `TreeSpec` files in `src/spec/`. Each has a curated **hero seed**:

| Species | Hero seed | Character |
|---|---|---|
| **Banyan** | `1892` | aerial prop roots, umbrella crown — the reference tree |
| **Dead Winter Oak** | `4242` | bare five-deep twig lace, strongest silhouette |
| **English Oak** | `1892` | lobed leaves, broad dome, no props |
| **Cherry Blossom** | `1892` | vase limbs, smooth mahogany bark, 5,200 blossom clusters |
| **Baobab** | `777` | bottle trunk, stout high crown, sparse canopy |
| **Japanese Black Pine** | `1892` | pads habit, 950 instanced 30-needle tufts, plated bark |
| **Weeping Willow** | `4242` | rise-then-cascade field, 329 pendant strands of narrow leaves |

To grow any of them:
`?species=<id>&seed=<hero>` on the standalone, or `SPECIES['<id>'].spec` in the library.

---

## Using it as a library

`dist/banyan.module.js` is the importable ESM build (three.js stays external). It does no
DOM work at import time, so it is safe to use in Node for headless generation and export.

```js
import * as THREE from 'three';
import { reseed, growSkeleton, buildWoodGeometry, makeBarkMaterial,
         makeLeafMaterial, buildLeaves, SPECIES } from './dist/banyan.module.js';

const spec = structuredClone(SPECIES['banyan'].spec);
spec.seed = 1892;

reseed(spec.seed);                                  // seed the one stream
const sk   = growSkeleton(spec);                    // branches + leaf anchors
const wood = new THREE.Mesh(buildWoodGeometry(sk.branches, 26), makeBarkMaterial(spec));
const { leaves } = buildLeaves(spec, sk.anchors, makeLeafMaterial());
// add wood + leaves to your scene; light it however you like
```

Other exports: `createSceneRig` + `SCENES` (the environment system), `buildBlossoms` +
`makeBlossomMaterial` (the cherry instancer), `exportGLB` (below), `setupPicking`,
`QUALITY`/`quality`, and `BANYAN_SPEC`. The demo app (`src/main.js`) is a worked example
of wiring all of it together with a control panel and leaf picking.

The full `src/` is annotated module-by-module (`rng` → `skeleton` → `mesher` →
`materials` → `leaves` → `scenes`) — the source *is* the documentation, and it is meant
to be read.

---

## GLB export

Export any tree to a `.glb` — from the panel's **glb** button, `window.banyan.exportGLB()`,
or headless: `node tools/export-glb.js --species cherry-blossom --seed 1892`.

**Be clear-eyed about what GLB can carry.** Export is **vertex-color only**, and honestly
so:

- ✅ The full wood mesh with its baked ambient-occlusion vertex colors.
- ✅ Every leaf blade baked to real geometry with its per-instance color.
- ✅ **Every blossom cluster**, baked the same way (added in v1.0).
- ❌ The procedural GLSL **bark relief and leaf backlight/vein shading do not survive
  glTF** — they are computed in-shader and cannot be expressed as glTF PBR. A leaf-color
  boost (`1.35`) approximates the engine's perceived brightness in a plain viewer.

Exports validate clean against the Khronos glTF validator (0 errors / 0 warnings). A
bake-bark-relief-to-texture path is a possible future upgrade.

---

## Performance

Quality is a runtime preset (`quality: auto | high | mobile`) that scales cost without
touching identity — `high` is the canonical reference output; the presets only cap leaf
instances, shadow-map size, tube segments, and device-pixel-ratio.

| Preset | Leaf cap | Shadow map | Picks |
|---|---|---|---|
| `high` | uncapped (e.g. 6,800) | 1024–2048 | desktop / captures |
| `mobile` | 3,400 | 512 | phones / weak GPUs |
| `auto` | picks `mobile` under 760px | — | default |

The wood is **one draw call** (a single merged mesh); leaves and blossoms are one
instanced draw each. A full banyan is ~386k vertices. Scene swaps never rebuild the tree,
and leaf re-coloring re-runs only the color pass (no geometry rebuild).

---

## License

AGPL-3.0 — see [`LICENSE`](../LICENSE). All shipped content is 100% procedural:
**no third-party assets are bundled** (see [`SOURCES.md`](../SOURCES.md)).
three.js is MIT and loaded from its CDN.

---

## Support

- Start with [`examples/`](../examples/), then read `src/` — it is annotated to be read.
- `CHANGELOG.md` tracks what changed between versions.
- Questions, bugs, or a species you'd like to see: open a GitHub issue.

_Banyan v1.0 · © 2026 Satyasai Ray. Not affiliated with three.js._
