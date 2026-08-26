// Build script: bundles src/ back into the dist artifacts.
//   dist/banyan.standalone.html  -- the single-file demo/art piece (no build step needed to run it)
//   dist/banyan.module.js        -- importable ESM library (three left external)
//   dist/forest.standalone.html  -- every species side by side in one scene
// Usage: npm install && node build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

// 0) regenerate the extracted engine modules (read-only slices of the v3/v4 artifacts)
execSync('node tools/extract-v3.mjs', { stdio: 'inherit' });
execSync('node tools/extract-v3.mjs banyan-bonsai_v4.html src/engine-v4.gen.js', { stdio: 'inherit' });

const COMMON = {
  bundle: true,
  format: 'esm',
  external: ['three', 'three/addons/*'],
  minify: false,           // readability is the product -- never minify
  legalComments: 'inline',
  write: false,
  target: 'es2022',
};

mkdirSync('dist', { recursive: true });

// 1) the library module
const lib = await build({ ...COMMON, entryPoints: ['src/index.js'] });
writeFileSync('dist/banyan.module.js', lib.outputFiles[0].text);

// 2) the standalone single-file demo
const app = await build({ ...COMMON, entryPoints: ['src/main.js'] });
const shell = readFileSync('src/shell.html', 'utf8');
writeFileSync('dist/banyan.standalone.html', shell.replace('%%BUNDLE%%', ()=> app.outputFiles[0].text.trimEnd()));

// 2b) the forest / grove standalone -- every species side by side in one scene
const forest = await build({ ...COMMON, entryPoints: ['src/forest.js'] });
const forestShell = readFileSync('src/forest-shell.html', 'utf8');
writeFileSync('dist/forest.standalone.html', forestShell.replace('%%BUNDLE%%', ()=> forest.outputFiles[0].text.trimEnd()));

// 3) the seed gallery tool (engine inlined so it runs from file:// with only the CDN import map)
mkdirSync('tools', { recursive: true });
const gal = await build({ ...COMMON, entryPoints: ['src/gallery.js'] });
const galShell = readFileSync('src/gallery-shell.html', 'utf8');
writeFileSync('tools/seed-gallery.html', galShell.replace('%%BUNDLE%%', ()=> gal.outputFiles[0].text.trimEnd()));

console.log('[build] wrote dist/banyan.module.js + banyan.standalone.html + forest.standalone.html + tools/seed-gallery.html');
