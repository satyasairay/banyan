#!/usr/bin/env node
/*
  Rebuild the self-contained V5 runtime from the readable source.

  Mental model: source = recipe (imports Three.js from vendor/),
  runtime = finished loaf (Three.js baked in, minified, double-clickable).
  This tool bakes the loaf: strip the importmap, bundle+minify the module
  script with the pinned local Three.js, stamp the GENERATED header with
  the source file's sha256.

  Builds the single-file runtime banyan_v5.html from banyan_v5.source.html:
  the vendored three.js module is bundled by esbuild and inlined, and a banner
  with the source sha256 is stamped on top so a shipped file always names the
  exact source it came from.

  Usage:  node tools/build-v5-standalone.mjs [--src <file>] [--out <file>] [--check]
          --check builds in memory and compares against the file at --out
          byte-for-byte instead of writing it (exit 1 on drift).
  Deps:   esbuild, pinned by package.json — npm install at the repository root.
  Vendor: vendor/three.module.js (Three.js r165, MIT — see SOURCES.md)
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* esbuild lives in node_modules at the repository root (the declared home). A repository-
   level or test/ install is accepted as a fallback so an existing checkout
   keeps working, but the error names every root that was tried instead of
   failing with a bare ERR_MODULE_NOT_FOUND. Resolution is explicit rather
   than bare-specifier because the repository root carries a node_modules
   symlink that native Windows cannot traverse. */
const DEP_ROOTS = [
  path.resolve(HERE, '..'),            // repository root      (declared home)
  path.resolve(HERE, '../..'),         // repository root
  path.resolve(HERE, '../../test'),    // legacy: test/node_modules
];
function loadEsbuild() {
  const tried = [];
  for (const root of DEP_ROOTS) {
    const probe = path.join(root, 'node_modules', 'esbuild', 'package.json');
    tried.push(probe);
    if (!fs.existsSync(probe)) continue;
    try {
      return createRequire(path.join(root, 'noop.cjs'))('esbuild');
    } catch (err) {
      throw new Error(`esbuild found at ${probe} but failed to load:\n  ${err.message}\n` +
        `Fix the install for THIS platform (${process.platform}-${process.arch}):\n` +
        `  npm install`);
    }
  }
  throw new Error('esbuild not installed. Run:\n  cd renderer && npm install\nTried:\n  ' + tried.join('\n  '));
}
const esbuild = loadEsbuild();

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const CHECK = args.includes('--check');
const SRC = path.resolve(HERE, opt('--src', '../banyan-bonsai_v5.source.html'));
const OUT = path.resolve(HERE, opt('--out', '../banyan-bonsai_v5.html'));
const THREE = path.resolve(HERE, '../vendor/three.module.js');

/* 1-2 Finding 8 · CANONICAL LINE ENDINGS. The repository is checked out with
   core.autocrlf=true, so on Windows the source arrives CRLF and on Linux LF —
   which used to make the stamped source hash, and therefore the built runtime,
   platform-dependent. Everything below works on the LF-normalized source, and
   the runtime is written with LF only, so one clean build produces the SAME
   BYTES on every platform. (esbuild already normalizes template-literal line
   terminators to LF per the ECMAScript spec, so this changes the stamped hash
   and the passthrough head/tail only — never the bundled program.) */
const toLF = b => b.toString('utf8').replace(/\r\n/g, '\n');
const src = toLF(fs.readFileSync(SRC));
const sha256 = crypto.createHash('sha256').update(Buffer.from(src, 'utf8')).digest('hex');

/* 1 · strip the importmap block (plus the newline it sat on) */
const impStart = src.indexOf('<script type="importmap">');
const impEnd = src.indexOf('</script>', impStart) + '</script>'.length;
if (impStart < 0) throw new Error('importmap not found in source');
let head = src.slice(0, impStart) + src.slice(impEnd);
head = head.replace(/\n\n<\/head>/, '\n</head>'); // collapse the leftover blank line

/* 2 · extract the module script */
const modOpen = '<script type="module">';
const modStart = head.indexOf(modOpen);
const modEnd = head.indexOf('</script>', modStart);
if (modStart < 0) throw new Error('module script not found in source');
const moduleCode = head.slice(modStart + modOpen.length, modEnd);
const before = head.slice(0, modStart);
const after = head.slice(modEnd + '</script>'.length);

/* 3 · bundle + minify with the pinned local Three.js */
const bundle = await esbuild.build({
  stdin: {
    contents: moduleCode,
    resolveDir: path.dirname(SRC),
    sourcefile: 'banyan-bonsai_v5.module.js',
    loader: 'js',
  },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'inline',
  write: false,
  alias: { three: THREE },
});
const js = bundle.outputFiles[0].text;

/* 4 · assemble the runtime */
const banner = `<!-- GENERATED by renderer/tools/build-v5-standalone.mjs from ${path.basename(SRC)} · sha256:${sha256} -->`;
const out = `${before}${banner}\n<script>\n"use strict";\n${js}</script>${after}`;
const outBuf = Buffer.from(out, 'utf8');
const outSha = crypto.createHash('sha256').update(outBuf).digest('hex');

if (CHECK) {
  /* 1-2 Finding 8 gate: prove the documented build reproduces the SHIPPED
     runtime byte-for-byte without touching it. Raw equality is the gate. A
     checkout that re-expanded LF to CRLF (git core.autocrlf=true on Windows)
     is reported separately as CONTENT-IDENTICAL rather than silently passed. */
  const shipped = fs.existsSync(OUT) ? fs.readFileSync(OUT) : null;
  const shippedSha = shipped ? crypto.createHash('sha256').update(shipped).digest('hex') : '(absent)';
  const shippedLF = shipped ? Buffer.from(toLF(shipped), 'utf8') : null;
  const shippedLFSha = shippedLF ? crypto.createHash('sha256').update(shippedLF).digest('hex') : '(absent)';
  const same = !!shipped && shipped.equals(outBuf);
  const sameLF = !!shippedLF && shippedLF.equals(outBuf);
  console.log(`check ${path.relative(process.cwd(), OUT)}`);
  console.log(`  esbuild:        ${esbuild.version} (${process.platform}-${process.arch})`);
  console.log(`  source sha256:  ${sha256}   (LF-normalized source)`);
  console.log(`  rebuilt bytes:  ${outBuf.length} · sha256 ${outSha}`);
  console.log(`  shipped bytes:  ${shipped ? shipped.length : 0} · sha256 ${shippedSha}`);
  console.log(`  shipped LF-norm: ${shippedLF ? shippedLF.length : 0} · sha256 ${shippedLFSha}`);
  console.log(`  byte-for-byte:  ${same ? 'IDENTICAL' : sameLF ? 'CRLF-EXPANDED CHECKOUT (content identical)' : 'DIFFERENT'}`);
  process.exit(same ? 0 : 1);
}

fs.writeFileSync(OUT, outBuf);
console.log(`built ${path.relative(process.cwd(), OUT)}`);
console.log(`  esbuild:       ${esbuild.version} (${process.platform}-${process.arch})`);
console.log(`  source sha256: ${sha256}`);
console.log(`  output sha256: ${outSha}`);
console.log('  remember: update the hash table in README.md');
