# Banyan

A procedural banyan tree study for three.js.

Everything is grown from code: trunk, aerial prop roots, bark, leaves, ground,
grass, litter, light. No models, no textures, no downloaded assets. A tree is a
32-bit seed. Geometry is certified at `balanced`; `auto` chooses a detail
tier for the screen, and different tiers have different mesh counts. Bark
fields are baked on the viewer's GPU while the tree is built, so geometry
determinism is not a promise of identical shading on every machine. A seed
keeps the tree's identity reproducible at the same certified settings.

![Banyan, close — bark and canopy grown from a seed](docs/images/hero-banyan-closeup.jpg)

## See it

[satyasairay.github.io/banyan](https://satyasairay.github.io/banyan/) opens the
tree. Or open `banyan_v5.html` straight off disk: one self-contained file, with
three.js baked in by a reproducible build, so it needs no network at all. Drag
to orbit, tap a leaf for botanical details, press "copy tree link" for a link that
carries the seed, scene and season (the ground is not in the copied link yet — add
it by hand). Deep links carry `?seed=&scene=&season=`.

Season changes preserve the view, including its lens. Reset returns to the
low-eye opening. Regrowing, choosing another tree or seed, changing quality,
or resizing the page re-fits the opening.

## Gallery

Each caption is a command: put it on the standalone's URL and the same tree
grows for you, in the same ground.

| | |
|---|---|
| ![Banyan 1653 "Single Bough" — wild meadow](docs/images/banyan-1653-wild-meadow.jpg) | ![Banyan 153 "Wide Colonnade" — quiet garden](docs/images/banyan-153-quiet-garden.jpg) |
| `?seed=1653&ground=wild-meadow&scene=golden-hour` | `?seed=153&ground=quiet-garden&scene=golden-hour` |

## How it grows

The seed drives a constrained recursive grower: scaffold branches start along
the trunk, then fork with depth-dependent lengths, radii and spacing; noise,
a crown envelope and a height ceiling steer their paths. A pipe-model pass
sets thickness from supported growth, then gravity bending moves the limbs.
Foliage anchors retain branch/segment/fraction addresses and resolve onto the
bent wood before low-canopy pruning and terminal coverage. See
[growSkeleton](banyan_v5.source.html). This shares the parameter-driven,
recursive approach of [Weber and Penn (1995)](https://doi.org/10.1145/218380.218427),
but does not implement their parameter model. It does not implement
[Runions, Lane and Prusinkiewicz's space colonisation (2007)](https://algorithmicbotany.org/papers/colonization.egwnp2007.html):
there is no attraction-point population competing to guide branch extension.
These are comparisons of algorithms, not a claim of derivation.

## What it costs to draw

Everything in the frame is shaded rather than painted, so the bill comes due
every frame. On the reference laptop GPU (a Radeon 740M, Chrome, 1080x896) the
`balanced` tree spent 21 ms of GPU time per frame in August. It now spends
about 12.7 ms and stays above 59 fps through orbit and dive. Four fragment
programs had been doing work below the pixel: leaf venation on leaves fifteen
pixels tall, bark relief read from a mip nobody could see, a 64-tap shadow
filter. Most of that is gated by screen footprint now, and the shadow filter is
a 4x4 hardware compare.

The GPU numbers above are historical measurements of the `balanced` portrait
pose at 1080x896 in Chrome on a Radeon 740M: GPU milliseconds per frame under
vsync, measured with `EXT_disjoint_timer_query_webgl2` by the author's private
product-repository perf rig, which is not shipped here. Loop FPS measures the
animation callback cadence, not GPU work; it is not the reciprocal of that
GPU-time reading. Firefox and Safari do not expose this timer in their default
configurations, so they cannot reproduce the GPU number by this mechanism
([compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/EXT_disjoint_timer_query_webgl2.json)).
`?debug=1` shows the study's smoothed loop FPS meter, not that external GPU timer.

![The same tree with the canopy hidden](docs/images/banyan-863-skeleton.jpg)

The phone told a different story. The trunk carries about 125,000 vertices, and
a change that moved five noise fields from the pixel to the vertex was a win on
the laptop and a loss on an iPhone 13, where the trunk covers fewer pixels than
it has vertices at the pose the page opens on. Those fields are baked once
at build time now, on the GPU, and stored with the mesh.

![Pixel difference between two builds, amplified](docs/images/banyan-863-heat.jpg)

That picture is how a look change gets checked. Two builds, the same frame,
every differing pixel lit. The trees in the gold catalogue reproduce their
geometry checksums on every v5 build, and shading changes are held to what a
pixel diff, and then a pair of eyes on the live page, cannot tell apart. First
visit on the phone is the part that did not improve: three paired runs on the
same iPhone 13 put the new build within two per cent of the old one, and the
bark bake's one-time cost is where that went.

## Gold seeds

Not every seed grows a great tree. [gold/](gold/) is the curated catalogue:
ten seeds selected from thousands of candidates, each with a preview image,
recorded in [gold/gold-banyan-1.json](gold/gold-banyan-1.json) with geometry
checksums — so a certified tree can be verified, not just admired. Seed `863`
("Sheltering") and seed `1653` ("Single Bough") are good places to start.

### Verify a Gold tree

Serve this repository on localhost (for example, `python -m http.server 8000`),
open [this seed-863 configuration](banyan_v5.html?seed=863&quality=balanced&species=banyan&season=live&scene=golden-hour&ground=earth-moss&wind=0),
and run this in that page's browser console. The snippet explicitly fetches
verification files; the runtime itself does not make those requests. It checks
the current build's LF-normalised SHA-256 and prints the four digests against
the manifest and its linked ten-seed witness. The manifest's tree `checksum`
field is the **combined geometry digest**, distinct from `banyan.checksum()`.

```js
(async () => {
  const required = {seed:'863', quality:'balanced', species:'banyan',
    season:'live', scene:'golden-hour', ground:'earth-moss', wind:'0'};
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(required)) {
    if (params.get(key) !== value) throw Error(`Open the linked configuration: ${key}=${value}`);
  }
  const get = async path => {
    const response = await fetch(path, {cache:'no-store'});
    if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
    return response;
  };
  const manifest = await (await get('gold/gold-banyan-1.json')).json();
  const build = manifest.currentBuild;
  const text = (await (await get(build.file)).text()).replace(/\r\n/g, '\n');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const sha256 = [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('');
  console.log('Current build SHA-256 (LF)', sha256);
  if (sha256 !== build.sha256.toLowerCase()) throw Error('Build hash mismatch');
  const witness = await (await get(build.witness)).json();
  const gold = manifest.trees.find(t => t.seed === 863);
  const row = witness.rows.find(t => t.seed === 863 && t.preset === 'balanced');
  if (!gold || !row) throw Error('Missing seed-863 evidence');
  const deadline = performance.now() + 120000;
  while (!window.banyan?.stature() || !document.getElementById('boot-status')?.hidden) {
    if (performance.now() > deadline) throw Error('Tree readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const b = window.banyan, g = b.geometry.report();
  const state = b.stats();
  for (const key of ['seed','quality','species','season','scene','ground']) {
    if (String(state[key]) !== required[key]) throw Error(`Tree state changed: ${key}`);
  }
  if (row.combined !== gold.checksum || row.anchors !== gold.anchorsChecksum)
    throw Error('Manifest and witness disagree');
  const expected = {checksum:row.checksum, combined:gold.checksum,
    anchors:gold.anchorsChecksum, environment:row.env};
  const actual = {checksum:b.checksum(), combined:g.combined,
    anchors:g.anchors, environment:b.environmentChecksum()};
  console.table(Object.keys(expected).map(digest => ({digest,
    expected:expected[digest], actual:actual[digest], match:actual[digest] === expected[digest]})));
  if (Object.keys(expected).some(k => actual[k] !== expected[k])) throw Error('Gold digest mismatch');
  console.log('PASS: build hash and four Gold digests');
})();
```

`checksum()` is a 32-bit sampled tripwire over quantised geometry values, not a
proof of identical geometry. The witness records its browser and GPU; a
cross-machine claim needs that machine's own run.

## Reproducible build

`banyan_v5.source.html` is the readable source: one HTML file, the engine in a
module script, three.js imported from [vendor/](vendor/) (r165, pinned,
provenance in `vendor/PROVENANCE.md`). The runtime is built from it:

```sh
npm install
npm run build     # writes banyan_v5.html
npm run check     # rebuilds in memory, compares byte-for-byte
```

The build LF-normalizes the source, bundles with a pinned esbuild, and stamps
the source hash into the runtime header — one clean build produces the same
bytes on Windows and Linux. You do not have to trust the shipped file; check it.
The SHA-256 rows below hash LF-normalised text: convert CRLF to LF before
hashing a checkout; a raw CRLF file hash will differ.

| File | SHA-256 (LF-normalized content) |
|---|---|
| `banyan_v5.html` | `83fb1dda0351d4d73e77747e689b4b2db97ee09e3799d9d7ee75f98f91150f69` |
| `banyan_v5.source.html` | `cc3e12fc128d664b6e5ec223958d53107572f03f3978cf143f0aeddfc0f287fd` |

## The evolution

The earlier single-file stages are no longer in the tree; they remain in the
repository's history. The current v5 runtime bundles its dependency locally
and downloads nothing.

## Public boundary

Working use case: [everbanyan.com](https://www.everbanyan.com), a living tree
memorial for pets, is where this renderer grew and where it runs in production. Its
public study refuses nameplates, portrait images, remembrance objects,
companion lanterns, memory-leaf operations and the still tier. Rejected input
silently leaves the base tree in place; `capabilities` reports those refusals.
The Gold anchor table is still computed. Other species and experimental scene
data remain in the bytes and are gated on the public surface. Gated does not
mean absent from the source. Paid palettes and weather effects are not part
of the study; their implementation has been deleted.

## Provenance and license

The engine and every scene are 100% procedural; zero external assets are
bundled (see [SOURCES.md](SOURCES.md)). three.js is MIT. This repository is
AGPL-3.0 — use it, learn from it, build with it; if you ship something built on
it, your code must be open too. For a commercial license outside those terms,
contact the author. See [LICENSE](LICENSE).
