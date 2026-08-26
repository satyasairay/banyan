# Examples

Three runnable examples, simplest first. Each is a single self-contained HTML file
that pulls three.js r165 from the jsDelivr CDN via an import map — no build step,
no `node_modules`.

| # | Folder | Shows | Opens from |
|---|--------|-------|------------|
| 01 | `01-minimal` | The 60-second `<iframe>` embed | disk (`file://`) or any host |
| 02 | `02-custom-spec` | Edit a TreeSpec and grow it with the library | a local server |
| 03 | `03-scene-swap` | Swap environments around one tree at runtime | a local server |

## Running them

`01-minimal` embeds the prebuilt single file (`dist/banyan.standalone.html`) in an
`<iframe>`, which opens straight from disk — double-click `index.html`.

`02`–`03` import the ES module `dist/banyan.module.js`. Browsers only allow ES-module +
import-map loading over `http(s)`, so serve the pack root and open them through the server:

```
npx serve .
# then visit e.g. http://localhost:3000/examples/02-custom-spec/
```

(Any static server works: `python3 -m http.server`, VS Code Live Server, etc.)

## What each one teaches

- **01** — you don't have to touch code to ship a tree. One `<iframe>` with deep-link
  params (`?species=&seed=&scene=`) is a complete, shareable embed.
- **02** — a species is just data. Clone a `TreeSpec`, change a few numbers, regrow.
- **03** — the environment is data too. One tree, `rig.apply(SCENES[id])`, no rebuild.
