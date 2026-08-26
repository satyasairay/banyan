// Seed gallery (SS1.4 #11): grid-render N seeds with the real engine, click a
// cell to export a high-res PNG. This is both a product feature and the
// screenshot factory for marketing assets.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { reseed } from './rng.js';
import { growSkeleton } from './skeleton.js';
import { buildWoodGeometry } from './mesher.js';
import { makeBarkMaterial, makeLeafMaterial } from './materials.js';
import { buildLeaves } from './leaves.js';
import BANYAN_SPEC from './spec/banyan.treespec.json' with { type: 'json' };

const CELL = 420;            // grid render size
const EXPORT = 1600;         // click-to-export size
const CURATED = [1892, 777, 42, 1, 5, 99, 1234, 4242, 31337, 271828, 314159, 999983];

/* ---------- one offscreen stage, reused for every cell ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CELL, CELL);
renderer.setClearColor(0xffffff, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

const key = new THREE.DirectionalLight(0xfff1e2, 2.9);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.05;
scene.add(key);
scene.add(key.target);
const KEY_DIR = new THREE.Vector3(4.2, 7.5, 3.2).normalize();

scene.add(new THREE.HemisphereLight(0xf0f4fa, 0xd9d3c8, 0.5));

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI/2),
  new THREE.ShadowMaterial({ opacity: 0.12 })
);
shadowPlane.receiveShadow = true;
shadowPlane.renderOrder = 1;
scene.add(shadowPlane);
const fadePlane = new THREE.Mesh(
  new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI/2).translate(0, 0.0015, 0),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uInner:{value:2.1}, uOuter:{value:4.3} },
    vertexShader: `varying vec3 vWp; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWp = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader:`varying vec3 vWp; uniform float uInner,uOuter; void main(){ float a = smoothstep(uInner,uOuter,length(vWp.xz)); gl_FragColor = vec4(1.0,1.0,1.0,a); }`
  })
);
fadePlane.renderOrder = 2;
scene.add(fadePlane);

const leafMat = makeLeafMaterial();
let wood = null, leaves = null, barkMat = null;

function fitShadow(box){
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const c = sphere.center, r = Math.max(1, sphere.radius);
  const dist = Math.max(6, r*2.2);
  key.position.copy(c).addScaledVector(KEY_DIR, dist);
  key.target.position.copy(c);
  key.target.updateMatrixWorld();
  const cam = key.shadow.camera, m = r*1.06;
  cam.left=-m; cam.right=m; cam.top=m; cam.bottom=-m;
  cam.near = Math.max(0.5, dist - r*1.2);
  cam.far  = dist + r*1.2 + Math.max(0, box.max.y)/Math.max(0.2, KEY_DIR.y);
  cam.updateProjectionMatrix();
}

/* Build one tree, frame it, render once. Returns the renderer's canvas. */
function renderSeed(seed, leafCount, size){
  if (renderer.domElement.width !== size) renderer.setSize(size, size);
  if (wood){ scene.remove(wood); wood.geometry.dispose(); wood = null; }
  if (barkMat){ barkMat.dispose(); barkMat = null; }
  if (leaves){ scene.remove(leaves); leaves.geometry.dispose(); leaves = null; }

  const S = structuredClone(BANYAN_SPEC);
  S.seed = seed;
  S.leafCount = leafCount;

  reseed(S.seed);
  const sk = growSkeleton(S);
  wood = new THREE.Mesh(buildWoodGeometry(sk.branches, 26), (barkMat = makeBarkMaterial(S)));
  wood.castShadow = wood.receiveShadow = true;
  scene.add(wood);
  const built = buildLeaves(S, sk.anchors, leafMat);
  leaves = built.leaves;
  scene.add(leaves);

  // frame the tree: bbox-driven camera at the house 3/4 view
  wood.geometry.computeBoundingBox();
  leaves.computeBoundingBox();
  const box = wood.geometry.boundingBox.clone();
  if (leaves.count > 0) box.union(leaves.boundingBox);
  fitShadow(box);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const c = sphere.center;
  const dist = sphere.radius * 2.12;
  camera.position.set(c.x + dist*0.52, c.y + dist*0.30, c.z + dist*0.82);
  camera.lookAt(c.x, c.y*0.95, c.z);
  camera.updateProjectionMatrix();

  // leaf backlight needs one uniform sync
  const sh = leafMat.userData.shader;
  if (sh){
    const sun = key.position.clone().sub(key.target.position).normalize();
    sh.uniforms.uSunView.value.copy(sun.transformDirection(camera.matrixWorldInverse));
  }
  renderer.render(scene, camera);
  return renderer.domElement;
}

/* ---------- grid UI ---------- */
const grid = document.getElementById('grid');
const nInput = document.getElementById('g-n');
const seedInput = document.getElementById('g-seeds');
const status = document.getElementById('g-status');

function parseSeeds(){
  const txt = seedInput.value.trim();
  if (txt){
    const list = txt.split(/[\s,]+/).map(v=> parseInt(v, 10)).filter(v=> Number.isFinite(v));
    if (list.length) return list;
  }
  const n = Math.max(1, Math.min(64, parseInt(nInput.value, 10) || 12));
  const out = [...CURATED.slice(0, n)];
  while (out.length < n) out.push(Math.floor(Math.random()*1000000));
  return out;
}

function exportPng(seed){
  status.textContent = `rendering seed ${seed} at ${EXPORT}px…`;
  requestAnimationFrame(()=> requestAnimationFrame(()=>{
    const canvas = renderSeed(seed, BANYAN_SPEC.leafCount, EXPORT);
    canvas.toBlob((blob)=>{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `banyan-seed-${seed}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      status.textContent = `saved banyan-seed-${seed}.png`;
    }, 'image/png');
  }));
}

async function buildGrid(){
  grid.textContent = '';
  const seeds = parseSeeds();
  for (const seed of seeds){
    const cellCanvas = document.createElement('canvas');
    cellCanvas.width = cellCanvas.height = CELL;
    const cell = document.createElement('figure');
    cell.className = 'cell';
    const cap = document.createElement('figcaption');
    cap.textContent = `seed ${seed}`;
    cell.appendChild(cellCanvas);
    cell.appendChild(cap);
    cell.title = 'click to export PNG';
    cell.addEventListener('click', ()=> exportPng(seed));
    grid.appendChild(cell);

    status.textContent = `growing seed ${seed}…`;
    await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
    const src = renderSeed(seed, BANYAN_SPEC.leafCount, CELL);
    cellCanvas.getContext('2d').drawImage(src, 0, 0);
  }
  status.textContent = `${seeds.length} seeds — click any cell to export a ${EXPORT}px PNG`;
}

document.getElementById('g-grow').addEventListener('click', buildGrid);
window.gallery = { renderSeed, buildGrid, exportPng, CURATED };   // scripting handle
buildGrid();
