// Demo app: persistent stage (renderer/scene/camera), the regenerate-in-place
// build() pipeline, quality + resize handling, the dependency-free control panel,
// the window.banyan debug handle -- and, since Phase 3, the SceneSpec rig: every
// light, ground, atmosphere, prop and post effect is data (scenes/*.scenespec.json)
// applied by src/scenes.js. Swapping scenes never rebuilds the tree.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { reseed } from './rng.js';
import { growSkeleton } from './skeleton.js';
import { buildWoodGeometry } from './mesher.js';
import { makeBarkMaterial, restyleBark as restyleBarkMat, makeLeafMaterial, makeBlossomMaterial } from './materials.js';
import { buildLeaves, buildBlossoms, gradeLeafColors } from './leaves.js';
import { setupPicking } from './picking.js';
import { exportGLB } from './export.js';
import { QUALITY, quality } from './quality.js';
import { createSceneRig, SCENES } from './scenes.js';
import { SPECIES } from './species.js';

// The ONE live spec object: a clone of the current species' TreeSpec.
// Edit + rebuild() to art-direct; setSpecies() swaps the whole spec.
let speciesId = 'banyan';
let S = structuredClone(SPECIES[speciesId].spec);

let Qx = QUALITY.high;   // active quality preset; refreshed by build()

/* ============================================================
   Persistent stage -- built ONCE; never rebuilt on regrow.
   Everything scene-dependent (lights/ground/env/post) lives in
   the SceneSpec rig below.
   ============================================================ */
const stage = document.getElementById('stage');
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  // preserveDrawingBuffer was true (so an async toDataURL could read the canvas
  // back). But it forces Chrome onto a preserve-and-resolve present path that
  // strobes black on heavier scenes -- backend-independent (an --use-angle=gl
  // swap didn't help) and unrelated to post-processing (the flicker persisted
  // with the composer disabled). The interactive app never reads the canvas back,
  // so false is correct here; the browser verifiers render inside the capture
  // task instead of relying on a preserved buffer.
  preserveDrawingBuffer: false,
  // Pin WebGL to the discrete GPU. On dual-GPU laptops Chrome otherwise arbitrates
  // between the integrated and discrete adapter and flashes black frames mid-switch.
  powerPreference: 'high-performance',
});
renderer.setClearColor(0xffffff, 1);            // clear is not tone-mapped -> pure #FFFFFF
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(3.05, 2.00, 4.95);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.88, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.6;
controls.maxDistance = 28;
controls.maxPolarAngle = Math.PI * 0.55;
controls.update();

// leaf material is CONSTANT across rebuilds (per-leaf color carries the palette)
const leafMat = makeLeafMaterial();

/* ---------- the SceneSpec rig (Phase 3, audit SS3.4) ---------- */
const rig = createSceneRig({
  renderer, scene, camera, controls, leafMat,
  getTree: ()=> ({ wood, barkMat, leaves, blossoms, blossomMat }),
  regradeLeaves: ()=> regradeLeaves(),
});

/* ---------- resize + DPR (SS1.4 #5): renderer/camera track the stage ---------- */
function sizeToStage(){
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Qx.pixelRatioCap));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  rig.setSize(w, h);
}
window.addEventListener('resize', sizeToStage);
sizeToStage();

/* ============================================================
   BUILD -- regenerate the whole tree in place from S.
   ============================================================ */
let branches = [], anchors = [], scaffoldIds = [], propRootIds = [];
let woodGeo=null, wood=null, barkMat=null;
let leaves=null, leafBranch=null, leafBaseColor=null, leafGrade=null;
let blossoms=null, blossomMat=null;   // second instancer (cherry family)

function disposeCurrent(){
  if (wood){ scene.remove(wood); wood.geometry.dispose(); wood = null; }
  if (barkMat){ barkMat.dispose(); barkMat = null; }
  if (leaves){ scene.remove(leaves); leaves.geometry.dispose(); leaves = null; }
  if (blossoms){ scene.remove(blossoms); blossoms.geometry.dispose(); blossoms = null; }
  woodGeo = null; leafBranch = null; leafBaseColor = null; leafGrade = null;
}

function restyleBark(){ return restyleBarkMat(barkMat, S); }

/* Re-run ONLY the leaf color pass (SS1.4 #4). The scene's leafGrade override
   (rig.leafGradeAdjust, coupling #2) rides along so hue-slider tweaks stay
   scene-correct; with the White Studio identity grade this reproduces the
   build-time colors bit-for-bit. */
function regradeLeaves(){
  if (!leaves || !leafGrade) return false;
  gradeLeafColors(S, leaves, leafGrade, leafBaseColor, rig.leafGradeAdjust);
  return true;
}

function build(){
  disposeCurrent();
  picking.pulses.length = 0;               // drop stale highlight targets

  // refresh quality preset (SS1.4 #5): shadow cap + DPR cap may change
  Qx = quality(S);
  rig.setQuality(Qx);
  sizeToStage();

  // reseed + regrow the skeleton
  reseed(S.seed);
  const sk = growSkeleton(S);
  branches = sk.branches; anchors = sk.anchors;
  scaffoldIds = sk.scaffoldIds; propRootIds = sk.propRootIds;

  // wood mesh (one draw call)
  woodGeo = buildWoodGeometry(branches, Qx.maxRadialSegs);
  barkMat = makeBarkMaterial(S);
  wood = new THREE.Mesh(woodGeo, barkMat);
  wood.castShadow = true;
  wood.receiveShadow = true;
  scene.add(wood);

  // leaves (same rng stream continues -- placement is part of the seed identity)
  const built = buildLeaves(S, anchors, leafMat, Qx.leafCap);
  leaves = built.leaves;
  leafBranch = built.leafBranch;
  leafBaseColor = built.leafBaseColor;
  leafGrade = built.leafGrade;
  scene.add(leaves);

  // blossom clusters (TreeSpec/v1 `blossom`): second instancer, same rng stream
  if (S.blossom){
    blossomMat = blossomMat || makeBlossomMaterial();
    blossoms = buildBlossoms(S, anchors, blossomMat, Qx.leafCap);
    if (blossoms) scene.add(blossoms);
  }

  // auto-fit the shadow frustum to this tree (SS1.4 #8) + re-push the scene's
  // treeOverrides (the bark material is new; the leaf grade must re-apply)
  rig.fitShadows();
  rig.applyTreeOverrides();

  // reset HUD
  hud.innerHTML = '<span class="dim">click a leaf&hellip;</span>';
  console.log(`[banyan] seed=${S.seed} leaves=${leaves.count} branches=${branches.length} anchors=${anchors.length} propRoots=${propRootIds.length} species=${speciesId}${blossoms ? ` blossoms=${blossoms.count}` : ''}`);
}

/* ============================================================
   Picking (hover + click HUD + pulse highlight)
   ============================================================ */
const picking = setupPicking({
  renderer, camera, hud,
  getState: ()=> ({ leaves, leafBranch, leafBaseColor, branches })
});

/* ============================================================
   Seed box -- dependency-free control panel wired to build()
   ============================================================ */
const panel = document.getElementById('panel');
const pSeed  = document.getElementById('p-seed');
const pGrow  = document.getElementById('p-grow');
const pRand  = document.getElementById('p-rand');
const pLeaf  = document.getElementById('p-leaf'),  pLeafV  = document.getElementById('p-leaf-v');
const pHue   = document.getElementById('p-hue'),   pHueV   = document.getElementById('p-hue-v');
const pProp  = document.getElementById('p-prop'),  pPropV  = document.getElementById('p-prop-v');
const pDepth = document.getElementById('p-depth'), pDepthV = document.getElementById('p-depth-v');
const pQual  = document.getElementById('p-qual');
const pScene = document.getElementById('p-scene');
const pSpec  = document.getElementById('p-species');

// species select: one option per TreeSpec (Phase 5)
for (const id of Object.keys(SPECIES)){
  const o = document.createElement('option');
  o.value = id; o.textContent = SPECIES[id].name || id;
  pSpec.appendChild(o);
}

/* Swap the SPECIES: replaces the live spec with a clone of the target TreeSpec
   and regrows. The scene, camera and panel survive -- same engine, new tree. */
function setSpecies(id){
  const sp = SPECIES[id];
  if (!sp) return false;
  speciesId = id;
  S = structuredClone(sp.spec);
  pSpec.value = id;
  syncPanelFromSpec();
  console.log(`[banyan] species=${id}`);
  build();
  syncUrl();
  return true;
}
pSpec.addEventListener('change', ()=> setSpecies(pSpec.value));

// scene select: one option per shipped SceneSpec (Phase 3)
for (const id of Object.keys(SCENES)){
  const o = document.createElement('option');
  o.value = id; o.textContent = SCENES[id].name || id;
  pScene.appendChild(o);
}

/* Swap the environment around the CURRENT tree -- no rebuild, no code edits:
   accepts a shipped scene id or any SceneSpec-shaped object. */
function setScene(idOrSpec){
  const spec = typeof idOrSpec === 'string' ? SCENES[idOrSpec] : idOrSpec;
  if (!spec) return false;
  rig.apply(spec);
  if (spec.id && SCENES[spec.id]) pScene.value = spec.id;
  syncUrl();
  return true;
}
pScene.addEventListener('change', ()=> setScene(pScene.value));

function syncPanelFromSpec(){
  pSeed.value  = S.seed;
  pLeaf.value  = S.leafCount;   pLeafV.textContent  = S.leafCount;
  pHue.value   = S.foliage.palette.h; pHueV.textContent = S.foliage.palette.h.toFixed(3);
  // prop roots are a banyan-family feature; disable the slider when the spec has none
  const hasProps = !!S.propRoots;
  pProp.disabled = !hasProps;
  pProp.value  = hasProps ? S.propRoots.count : 0;
  pPropV.textContent = hasProps ? S.propRoots.count : '—';
  // depth range is species-dependent (wig/steer tables must cover it)
  pDepth.max   = S.recursion.wig.length - 1;
  pDepth.value = S.recursion.maxDepth; pDepthV.textContent = S.recursion.maxDepth;
  pQual.value  = S.quality || 'auto';
}
function applyPanelToSpec(){
  S.seed              = parseInt(pSeed.value)  || 0;
  S.leafCount         = parseInt(pLeaf.value)  || 0;
  S.foliage.palette.h = parseFloat(pHue.value);
  if (S.propRoots) S.propRoots.count = parseInt(pProp.value);
  S.recursion.maxDepth = Math.min(parseInt(pDepth.value), S.recursion.wig.length - 1);
  S.quality           = pQual.value;
}
// rebuild yielding to the browser so the "growing..." state can paint
function regrow(){
  applyPanelToSpec();
  panel.classList.add('busy');
  requestAnimationFrame(()=> requestAnimationFrame(()=>{ build(); syncUrl(); panel.classList.remove('busy'); }));
}
pGrow.addEventListener('click', regrow);
// GLB export (SS1.4 #9): vertex-color-only -- procedural bark/leaf GLSL cannot
// survive glTF; see src/export.js for exactly what is exported.
document.getElementById('p-glb').addEventListener('click', async ()=>{
  if (!woodGeo) return;
  const glb = await exportGLB({ woodGeometry: woodGeo, leaves, blossoms, spec: S });
  const blob = new Blob([glb], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `banyan-seed-${S.seed}.glb`;
  a.click();
  URL.revokeObjectURL(a.href);
});
pSeed.addEventListener('change', regrow);
pRand.addEventListener('click', ()=>{ S.seed = Math.floor(Math.random()*1000000); pSeed.value = S.seed; regrow(); });
pLeaf.addEventListener('input',  ()=> pLeafV.textContent  = pLeaf.value);
// leaf hue restyles LIVE via the re-grade path (SS1.4 #4) -- no skeleton rebuild
pHue.addEventListener('input',   ()=>{
  pHueV.textContent = (+pHue.value).toFixed(3);
  S.foliage.palette.h = parseFloat(pHue.value);
  regradeLeaves();
});
pProp.addEventListener('input',  ()=> pPropV.textContent  = pProp.value);
pDepth.addEventListener('input', ()=> pDepthV.textContent = pDepth.value);
pLeaf.addEventListener('change',  regrow);
pProp.addEventListener('change',  regrow);
pDepth.addEventListener('change', regrow);
pQual.addEventListener('change',  regrow);

/* ============================================================
   Loop
   ============================================================ */
const sunDirWorld = new THREE.Vector3();      // recomputed per frame: key retargets per tree
const sunView = new THREE.Vector3();

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  const now = performance.now();
  picking.updatePulses(now);
  picking.updateHover();
  const sh = leafMat.userData.shader;
  if (sh && rig.keyLight){
    // coupling #3: the leaf backlight follows the SCENE's key light (dir + color)
    sunDirWorld.copy(rig.keyLight.position).sub(rig.keyLight.target.position).normalize();
    sunView.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
    sh.uniforms.uSunView.value.copy(sunView);
    sh.uniforms.uSunColor.value.copy(rig.backlightColor);
  }
  rig.update(now);
  rig.render();
}

/* ---------- deep-link boot params (Phase 4): make the standalone shareable,
   embeddable and SEO-able. ?species=&seed=&scene=&leaves=&quality=&view=az,el,dist
   Unknown/invalid values are ignored and fall back to defaults. Boot/UI only --
   the seed still fully determines the tree, so a link reproduces it exactly. */
function readBootParams(){
  const q = new URLSearchParams(location.search);
  const out = {};
  if (q.has('species')) out.species = q.get('species');
  if (q.has('scene'))   out.scene   = q.get('scene');
  const seed = q.get('seed');
  if (seed !== null && seed.trim() !== '' && Number.isFinite(+seed)) out.seed = (+seed) | 0;
  const lv = q.get('leaves');
  if (lv !== null && lv.trim() !== '' && Number.isFinite(+lv)) out.leaves = Math.max(0, (+lv) | 0);
  const qual = q.get('quality');
  if (qual && ['auto','high','mobile'].includes(qual)) out.quality = qual;
  const view = q.get('view');
  if (view){ const p = view.split(',').map(Number); if (p.length === 3 && p.every(Number.isFinite)) out.view = p; }
  return out;
}

/* Reflect the shareable state (species/seed/scene) in the address bar so any
   view can be copied as a deep link. UI-only -- never touches the rng stream. */
function syncUrl(){
  try {
    const q = new URLSearchParams();
    q.set('species', speciesId);
    q.set('seed', S.seed);
    if (pScene.value) q.set('scene', pScene.value);
    history.replaceState(null, '', location.pathname + '?' + q.toString());
  } catch (e) { /* file:// or sandboxed iframe: ignore */ }
}

/* ---------- go: boot from deep-link params, else the defaults ---------- */
const boot = readBootParams();
if (boot.species && SPECIES[boot.species]){
  speciesId = boot.species;
  S = structuredClone(SPECIES[speciesId].spec);
  pSpec.value = speciesId;
}
if (boot.seed   != null) S.seed = boot.seed;
if (boot.leaves != null) S.leafCount = boot.leaves;
if (boot.quality)        S.quality = boot.quality;
syncPanelFromSpec();
setScene(boot.scene && SCENES[boot.scene] ? boot.scene : 'white-studio');
build();                    // initial tree (deep-linked or default)
animate();

// debug + external control handle
window.banyan = {
  camera, controls, scene, rebuild: build,
  render: ()=> rig.render(),              // force a fresh frame (e.g. before an offscreen toDataURL)
  get spec(){ return S; },               // live spec (reassigned by setSpecies)
  get key(){ return rig.keyLight; },     // kept for existing capture scripts
  get species(){ return speciesId; },
  sceneRig: rig, scenes: SCENES, setScene,
  speciesList: SPECIES, setSpecies,
  exportGLB: ()=> exportGLB({ woodGeometry: woodGeo, leaves, blossoms, spec: S }),   // -> Promise<ArrayBuffer> (incl. blossoms)
  regradeLeaves,   // re-run only the leaf color pass after editing spec.foliage.palette
  restyleBark,     // push spec.bark into the live bark uniforms
  setSeed(n){ S.seed = n; pSeed.value = n; build(); syncUrl(); },
  setView(az, el, dist){
    const t = controls.target;
    camera.position.set(
      t.x + dist*Math.cos(el)*Math.sin(az),
      t.y + dist*Math.sin(el),
      t.z + dist*Math.cos(el)*Math.cos(az));
    controls.update();
  }
};

// apply a deep-linked camera view last, once the handle exists (?view=az,el,dist)
if (boot.view) window.banyan.setView(boot.view[0], boot.view[1], boot.view[2]);
