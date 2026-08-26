// Forest / Grove demo: every species in the registry grown side by side in ONE
// scene — the "Grove pattern" from docs/ARCHITECTURE-PLAYBOOK.md §10 (and Opus
// brief Phase 6.5). Sequential CONSTRUCTION, parallel EXISTENCE: each tree owns
// the rng stream from reseed() to finish, so per-tree determinism is untouched
// and the trees coexist for free. Cost model: ~1 wood draw call + 1 per instancer
// per tree (7 trees ≈ 14–21 calls). Materials are shared where the playbook says
// they can be: ONE leaf material and ONE blossom material serve every tree (the
// palette rides on per-instance colors); bark is per-tree (cheap at this count).
//
// Reuses the ONE generator via the engine modules — no forked geometry code.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { reseed } from './rng.js';
import { growSkeleton } from './skeleton.js';
import { buildWoodGeometry } from './mesher.js';
import { makeBarkMaterial, makeLeafMaterial, makeBlossomMaterial } from './materials.js';
import { buildLeaves, buildBlossoms } from './leaves.js';
import { SPECIES } from './species.js';

const GAP = 4.6;            // spacing between trunks (canopies gently interleave = grove, not lineup)
const LEAF_CAP = 3600;     // per-tree instance cap — full-looking from grove distance, light on the GPU
const RADIAL_SEGS = 26;    // 'high' tube tessellation (matches the seed gallery)

const stage  = document.getElementById('stage');
const hud    = document.getElementById('hud');
const labels = document.getElementById('labels');

/* ---------- renderer (the flicker-safe flags learned on the scene work) ---------- */
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: false,          // avoids the Chrome present-path black strobe
  powerPreference: 'high-performance',   // pin the discrete GPU on dual-GPU laptops
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xffffff, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3;
controls.maxDistance = 90;
controls.maxPolarAngle = Math.PI * 0.52;   // stay above the ground plane

/* ---------- lights + IBL (the White Studio look, same as the seed gallery) ---------- */
const key = new THREE.DirectionalLight(0xfff1e2, 2.9);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.05;
scene.add(key, key.target);
const KEY_DIR = new THREE.Vector3(4.2, 7.5, 3.2).normalize();

scene.add(new THREE.HemisphereLight(0xf0f4fa, 0xd9d3c8, 0.5));

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

/* ---------- ground: one wide shadow catcher (transparent → seamless white) ---------- */
const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.12 })
);
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

/* ============================================================
   Grow the grove — one tree at a time, all coexisting.
   ============================================================ */
const leafMat = makeLeafMaterial();     // shared across ALL trees (palette is per-instance color)
let blossomMat = null;                  // shared, created on first blossoming species (cherry)

const forest = new THREE.Group();
scene.add(forest);
const ids = Object.keys(SPECIES);       // all species in the registry
const trees = [];                       // { id, name, x } — for the projected labels

let totalLeaves = 0, totalBranches = 0, drawCalls = 0;

ids.forEach((id, i) => {
  const sp = SPECIES[id];
  const S = structuredClone(sp.spec);   // never mutate the shipped spec

  reseed(S.seed);                       // this tree owns the stream from here to finish
  const sk = growSkeleton(S);

  const g = new THREE.Group();

  // wood (one merged geometry = one draw call)
  const wood = new THREE.Mesh(buildWoodGeometry(sk.branches, RADIAL_SEGS), makeBarkMaterial(S));
  wood.castShadow = true;
  wood.receiveShadow = true;
  g.add(wood);
  drawCalls++;

  // foliage (blades or needle-tufts — buildLeaves picks by spec.foliage.system)
  const built = buildLeaves(S, sk.anchors, leafMat, LEAF_CAP);
  built.leaves.castShadow = true;
  built.leaves.receiveShadow = true;
  g.add(built.leaves);
  if (built.leaves.count > 0) drawCalls++;
  totalLeaves += built.leaves.count;

  // blossoms (cherry family only — second instancer, gated on spec.blossom)
  if (S.blossom) {
    blossomMat = blossomMat || makeBlossomMaterial();
    const bl = buildBlossoms(S, sk.anchors, blossomMat, LEAF_CAP);
    if (bl) { bl.castShadow = true; g.add(bl); drawCalls++; }
  }

  // place it: even row, slight z-stagger + a deterministic yaw so it reads natural
  const x = (i - (ids.length - 1) / 2) * GAP;
  const yaw = (((i * 2654435761) >>> 0) / 4294967296) * Math.PI * 2;   // integer-hash, not Math.random → stable layout
  g.position.set(x, 0, (i % 2 ? 1 : -1) * 0.35);
  g.rotation.y = yaw;
  forest.add(g);

  trees.push({ id, name: sp.name, x, z: g.position.z });
  totalBranches += sk.branches.length;
});

/* ---------- frame the whole row + fit one shadow frustum over all of it ---------- */
forest.updateMatrixWorld(true);
const forestBox = new THREE.Box3().setFromObject(forest);
const sphere = forestBox.getBoundingSphere(new THREE.Sphere());

(function fitShadow() {
  const c = sphere.center, r = Math.max(1, sphere.radius);
  const dist = Math.max(12, r * 2.0);
  key.position.copy(c).addScaledVector(KEY_DIR, dist);
  key.target.position.copy(c);
  key.target.updateMatrixWorld();
  const cam = key.shadow.camera, m = r * 1.05;
  cam.left = -m; cam.right = m; cam.top = m; cam.bottom = -m;
  cam.near = Math.max(0.5, dist - r * 1.3);
  cam.far = dist + r * 1.3 + Math.max(0, forestBox.max.y) / Math.max(0.2, KEY_DIR.y);
  cam.updateProjectionMatrix();
})();

let framed = false;
function frameForest() {
  const c = sphere.center, r = sphere.radius;
  const fov = camera.fov * Math.PI / 180;
  const fitH = r / Math.sin(fov / 2);
  const fitW = r / Math.sin(Math.atan(Math.tan(fov / 2) * camera.aspect));
  const dist = 1.08 * Math.max(fitH, fitW);
  controls.target.set(c.x, Math.max(0.6, c.y * 0.85), c.z);
  camera.position.set(c.x + dist * 0.16, c.y + r * 0.34, c.z + dist);
  controls.update();
  framed = true;
}

/* ---------- resize ---------- */
function resize() {
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!framed) frameForest();     // frame once, after we know the real aspect
}
window.addEventListener('resize', resize);
resize();

/* ---------- species labels that track each tree ---------- */
const labelDivs = trees.map((t) => {
  const d = document.createElement('div');
  d.className = 'label';
  d.textContent = t.name;
  labels.appendChild(d);
  return d;
});
const _v = new THREE.Vector3();
function updateLabels() {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (let i = 0; i < trees.length; i++) {
    _v.set(trees[i].x, -0.12, trees[i].z).project(camera);
    const behind = _v.z > 1;
    const px = (_v.x * 0.5 + 0.5) * w, py = (-_v.y * 0.5 + 0.5) * h;
    const d = labelDivs[i];
    d.style.transform = `translate(-50%, 0) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    d.style.opacity = behind ? '0' : '1';
  }
}

hud.innerHTML =
  `FOREST · ${trees.length} species\n` +
  `${totalBranches} branches · ${totalLeaves.toLocaleString()} leaves · ~${drawCalls} draw calls\n` +
  `<span class="dim">drag to orbit · scroll to zoom</span>`;
console.log(`[forest] ${trees.length} species | ${totalBranches} branches | ${totalLeaves} leaves | ~${drawCalls} draw calls`);

/* ---------- loop ---------- */
const sunView = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const sh = leafMat.userData.shader;
  if (sh) {
    sunView.copy(key.position).sub(key.target.position).normalize().transformDirection(camera.matrixWorldInverse);
    sh.uniforms.uSunView.value.copy(sunView);
  }
  updateLabels();
  renderer.render(scene, camera);
}
animate();

// scripting / debug handle
window.forest = { scene, camera, controls, renderer, trees, species: ids, frameForest };
