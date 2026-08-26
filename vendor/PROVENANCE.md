# renderer/vendor — provenance

| File | Origin | Version | License | SHA-256 |
| --- | --- | --- | --- | --- |
| `three.module.js` | npm registry, package `three` (`three@0.165.0`, `build/three.module.js`) | r165 (0.165.0) | MIT (`THREE-LICENSE.md`) | `5916c8dfb5f4e3eede312de305345868d4a0a8105383b080c6985565d6e79b46` |

Retrieved 2026-07-18 for the standalone repository so
`banyan-bonsai_v5.source.html` (importmap `three` → `./vendor/three.module.js`)
and `tools/build-v5-standalone.mjs` are self-contained. r165 matches the
Three.js revision already bundled inside the shipped standalone runtime
(`REVISION` string in the minified bundle); fidelity of the rebuild pipeline
was proven by identical `banyan.checksum()`, `stature()` and a 0-pixel frame
diff — evidence in `review/phases-1-2/2026-07-18/renderer-build/`.
