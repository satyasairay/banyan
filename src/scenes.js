// SceneSpec/v1 (audit SS3.4): data-driven environment "moods" for the banyan engine.
// A SceneSpec is pure JSON -- background / ibl / lights / ground / atmosphere /
// props / post / camera / treeOverrides -- applied at runtime by
// createSceneRig(ctx).apply(spec). The rig owns everything AROUND the tree.
//
// DETERMINISM CONTRACT: the rig NEVER touches the tree's rng stream (rng.js
// reseed/rand). All scene randomness (block jitter, rubble, particles) comes from
// a private mulberry32 seeded by spec.seed -- so the same tree seed drops into any
// scene unchanged, and verify/run.mjs stays green.
//
// The six couplings the audit flags (SS3.4), and where they are handled:
//   1. env-map feeds tree materials  -> treeOverrides.envMapIntensity (live, bark+leaf)
//   2. leaf "fake GI" baked for day  -> treeOverrides.leafGrade re-runs the pass-2
//                                       color loop per scene (SS1.4 #4 path)
//   3. sun-backlight bound once      -> treeOverrides.backlight rebinds to the
//                                       scene's key light (rig.backlightColor)
//   4. hand-tuned shadow frustum     -> rig.fitShadows() auto-fits per tree (SS1.4 #8)
//   5. fade plane hardcodes white    -> ground.fade.color
//   6. global tone-mapping exposure  -> treeOverrides.exposure
//
// Zero external assets: every shipped scene is 100% procedural (no HDRIs, no
// textures, no models). ibl.source:"hdri" is implemented for anyone who wants to
// drop in their own equirect .hdr, but no shipped SceneSpec uses it.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { mulberry32 } from './rng.js';
import { setBarkVisualDetail, setLeafVisualDetail } from './materials.js';

import whiteStudio from '../scenes/white-studio.scenespec.json' with { type: 'json' };
// temple-ruin retired: its ruin-wall / rubble / light-shaft props + 2048 shadow
// map strobed black on real GPUs (backend-independent, unrelated to the composer).
// golden-hour replaces it in the same warm/atmospheric slot using only the
// elements proven safe in white-studio/firefly/ink. The temple JSON stays on disk
// (unimported) so it can be revived if those props are ever hardened.
import goldenHour from '../scenes/golden-hour.scenespec.json' with { type: 'json' };
import fireflyNight from '../scenes/firefly-night.scenespec.json' with { type: 'json' };
import inkWash from '../scenes/ink-wash.scenespec.json' with { type: 'json' };

/** The shipped scenes, keyed by id. Any object with the same shape works too. */
export const SCENES = {
  [whiteStudio.id]: whiteStudio,
  [goldenHour.id]: goldenHour,
  [fireflyNight.id]: fireflyNight,
  [inkWash.id]: inkWash,
};

/* ============================================================
   Shared GLSL: the same hash/value-noise/fbm stack the bark
   shader uses, for prop + ground materials. (Visual only --
   never feeds geometry, so cross-engine identity is not at stake.)
   ============================================================ */
const NOISE_GLSL = /* glsl */`
float phash(vec3 p){ p = fract(p*0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float pnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(phash(i),phash(i+vec3(1,0,0)),f.x), mix(phash(i+vec3(0,1,0)),phash(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(phash(i+vec3(0,0,1)),phash(i+vec3(1,0,1)),f.x), mix(phash(i+vec3(0,1,1)),phash(i+vec3(1,1,1)),f.x), f.y), f.z); }
float pfbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s += a*pnoise3(p); p*=2.03; a*=0.5; } return s*1.07; }
`;

/* ============================================================
   Procedural stone/moss material (temple ruin + night garden).
   MeshStandardMaterial + in-shader fbm -- zero textures, same
   recipe as the bark material (SS1.4 #4).
   ============================================================ */
function makeStoneMaterial(opts, disposables){
  const o = Object.assign({
    base:'#b8a276', dark:'#7c6a4a', moss:'#5d6b3a', mossAmt:0.55, grid:0.0, roughness:0.93
  }, opts);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: o.roughness, metalness: 0.0,
    vertexColors: true, envMapIntensity: 0.35
  });
  mat.onBeforeCompile = (sh)=>{
    sh.uniforms.uSBase   = { value: new THREE.Color(o.base) };
    sh.uniforms.uSDark   = { value: new THREE.Color(o.dark) };
    sh.uniforms.uSMoss   = { value: new THREE.Color(o.moss) };
    sh.uniforms.uSMossAmt= { value: o.mossAmt };
    sh.uniforms.uSGrid   = { value: o.grid };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSWP;\nvarying vec3 vSNW;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvSNW = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSWP; varying vec3 vSNW;
uniform vec3 uSBase; uniform vec3 uSDark; uniform vec3 uSMoss;
uniform float uSMossAmt; uniform float uSGrid;
${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float e = pfbm(vSWP*3.1);
  vec3 stone = mix(uSDark, uSBase, smoothstep(0.22, 0.78, e));
  stone *= 0.82 + 0.36*pnoise3(vSWP*11.0);
  // flagstone joints (ground only, uSGrid=1): darkened grid lines broken by noise
  if (uSGrid > 0.5){
    vec2 cell = vSWP.xz / 0.92;
    vec2 g = abs(fract(cell) - 0.5);
    float line = smoothstep(0.40, 0.485, max(g.x, g.y));
    line *= smoothstep(0.25, 0.6, pnoise3(vec3(cell*3.7, 5.0)));
    stone *= 1.0 - 0.38*line;
  }
  float up = clamp(vSNW.y, 0.0, 1.0);
  float m = uSMossAmt * smoothstep(0.42, 0.9, pfbm(vSWP*2.2 + 13.0)) * (0.3 + 0.7*up);
  stone = mix(stone, uSMoss * (0.7 + 0.6*pnoise3(vSWP*9.0)), clamp(m, 0.0, 0.9));
  diffuseColor.rgb *= stone;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - (pfbm(vSWP*3.1)-0.5)*0.12, 0.6, 1.0);`);
    mat.userData.shader = sh;
  };
  disposables.push(mat);
  return mat;
}

/* ============================================================
   Props registry -- "procedural:<name>" builders. Each receives
   (propSpec, rng, env) and returns an Object3D. rng is the SCENE
   stream (mulberry32(spec.seed)), never the tree's.
   ============================================================ */
const PROPS = {
  /* Sandstone block wall being "gripped" by time: coursed blocks with jitter,
     ruin factor knocks blocks out (more toward the top). */
  ruinWall(p, rng, env){
    const bw = 0.46, bh = 0.28, bd = 0.34;
    const len = p.length ?? 5, hgt = p.height ?? 2, ruin = p.ruin ?? 0.4;
    const rows = Math.max(1, Math.round(hgt/bh));
    const cols = Math.max(2, Math.round(len/bw));
    // erosion happens from the TOP of each column (no floating blocks): each
    // column keeps a contiguous base, heights smoothed so the ruin line reads
    // as collapse, not noise
    const colH = [];
    for(let c=0; c<cols; c++) colH.push(rows * (1 - ruin * Math.pow(rng(), 0.55)));
    for(let c=1; c<cols-1; c++) colH[c] = colH[c]*0.6 + (colH[c-1]+colH[c+1])*0.2;
    const geos = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for(let r=0; r<rows; r++){
      const y = (r+0.5)*bh;
      const off = (r%2) ? bw*0.5 : 0;
      for(let c=0; c<cols; c++){
        if (r >= colH[c]) continue;                          // above the collapse line
        if (r > colH[c] - 1.7 && rng() < 0.35) continue;     // chipped top course
        const g = new THREE.BoxGeometry(
          bw*(0.94 + rng()*0.1), bh*(0.92 + rng()*0.1), bd*(0.9 + rng()*0.16));
        e.set((rng()-0.5)*0.05, (rng()-0.5)*0.08, (rng()-0.5)*0.05);
        q.setFromEuler(e);
        m.compose(
          new THREE.Vector3(-len/2 + off + c*bw + (rng()-0.5)*0.03, y + (rng()-0.5)*0.012, (rng()-0.5)*0.05),
          q, new THREE.Vector3(1,1,1));
        g.applyMatrix4(m);
        // per-block tone via vertex colors (the stone shader multiplies it in)
        const t = 0.82 + rng()*0.3, warm = 0.97 + rng()*0.06;
        const n = g.attributes.position.count, col = new Float32Array(n*3);
        for(let i=0;i<n;i++){ col[i*3]=t*warm; col[i*3+1]=t; col[i*3+2]=t*(2.0-warm); }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geos.push(g);
      }
    }
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    geos.forEach(g=> g.dispose());
    env.disposables.push(merged);
    const mesh = new THREE.Mesh(merged, env.stoneMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  },

  /* Fallen masonry + weathered stones scattered around the base (never inside
     the trunk footprint). */
  rubble(p, rng, env){
    const count = p.count ?? 20, R = p.radius ?? 3;
    const geos = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for(let i=0;i<count;i++){
      const a = rng()*Math.PI*2;
      const r = 1.15 + Math.sqrt(rng())*(R-1.15);
      const s = 0.05 + rng()*rng()*0.2;
      const block = rng() < 0.45;
      let g;
      if (block){
        const b = new THREE.BoxGeometry(s*1.5, s, s*1.1);
        g = b.toNonIndexed();               // icosahedra are non-indexed; merge needs uniformity
        b.dispose();
      } else {
        g = new THREE.IcosahedronGeometry(s, 1);
      }
      if (!block){ // knock the sphere into a rock
        const pos = g.attributes.position;
        for(let v=0; v<pos.count; v++){
          const k = 0.75 + rng()*0.5;
          pos.setXYZ(v, pos.getX(v)*k, pos.getY(v)*(0.55+rng()*0.3), pos.getZ(v)*k);
        }
        g.computeVertexNormals();
      }
      e.set(rng()*0.6-0.3, rng()*Math.PI*2, rng()*0.6-0.3);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(a)*r, s*0.28, Math.sin(a)*r), q, new THREE.Vector3(1,1,1));
      g.applyMatrix4(m);
      const t = 0.8 + rng()*0.3;
      const n = g.attributes.position.count, col = new Float32Array(n*3).fill(t);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(g);
    }
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    geos.forEach(g=> g.dispose());
    env.disposables.push(merged);
    const mesh = new THREE.Mesh(merged, env.stoneMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  },

  /* Volumetric-ish light shafts: crossed additive planes aligned to the key
     light direction, softly animated by fbm. Cheap on purpose (SS3.1: "earn
     its volumetrics last"). */
  lightShafts(p, rng, env){
    const group = new THREE.Group();
    const count = p.count ?? 4;
    const color = new THREE.Color(p.color ?? '#ffe7b8');
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor:{value:color}, uOpacity:{value:p.opacity ?? 0.16}, uTime:{value:0} },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
${NOISE_GLSL}
void main(){
  float across = pow(1.0 - abs(vUv.x - 0.5)*2.0, 1.6);
  float along = smoothstep(0.02, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 0.98, vUv.y));
  float wisp = 0.65 + 0.35*pfbm(vec3(vUv*vec2(3.0, 1.2), uTime*0.05));
  gl_FragColor = vec4(uColor, uOpacity * across * along * wisp);
}`
    });
    env.disposables.push(mat);
    env.timeMats.push(mat);
    const dir = env.keyDir.clone();             // shaft axis: along the sun ray
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
    for(let i=0;i<count;i++){
      const a = rng()*Math.PI*2, r = 0.5 + rng()*1.3;
      const anchor = new THREE.Vector3(Math.cos(a)*r, 1.1 + rng()*1.3, Math.sin(a)*r);
      const w = 0.35 + rng()*0.6;
      const geo = new THREE.PlaneGeometry(w, 7);
      env.disposables.push(geo);
      const shaft = new THREE.Group();
      shaft.quaternion.copy(quat);
      shaft.position.copy(anchor);
      const m1 = new THREE.Mesh(geo, mat), m2 = new THREE.Mesh(geo, mat);
      m2.rotation.y = Math.PI/2;
      m1.renderOrder = m2.renderOrder = 6;
      shaft.add(m1, m2);
      group.add(shaft);
    }
    return group;
  },

  /* A small paper lantern -- gives the firefly scene's point light a visible
     source (and the bloom pass something warm to catch). */
  lantern(p, rng, env){
    const group = new THREE.Group();
    const c = new THREE.Color(p.color ?? '#ffb45e');
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.9 });
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0x241505, emissive: c, emissiveIntensity: 2.4, roughness: 0.6
    });
    const postGeo = new THREE.CylinderGeometry(0.016, 0.02, 0.42, 8);
    const bodyGeo = new THREE.CylinderGeometry(0.07, 0.088, 0.17, 12, 1, true);
    const capGeo  = new THREE.CylinderGeometry(0.03, 0.095, 0.045, 12);
    [postMat, paperMat, postGeo, bodyGeo, capGeo].forEach(d=> env.disposables.push(d));
    const post = new THREE.Mesh(postGeo, postMat); post.position.y = 0.21;
    const body = new THREE.Mesh(bodyGeo, paperMat); body.position.y = 0.52;
    const cap  = new THREE.Mesh(capGeo, postMat);  cap.position.y = 0.63;
    post.castShadow = true;
    group.add(post, body, cap);
    return group;
  },
};

/* ============================================================
   Particle presets (atmosphere.particles.preset)
   ============================================================ */
function softPointsMaterial({ color, size, opacity, blink }, env){
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:{value:0}, uPx:{value:600},
      uColor:{value:new THREE.Color(color)}, uSize:{value:size}, uOpacity:{value:opacity}
    },
    vertexShader: `attribute float aSeed; uniform float uTime, uPx, uSize; varying float vA;
void main(){
  vec3 p = position;
  float s = aSeed*6.2831853;
  p.x += sin(uTime*0.21 + s*3.0)*0.45 + sin(uTime*0.43 + s*7.0)*0.1;
  p.y += sin(uTime*0.16 + s*5.0)*0.28;
  p.z += cos(uTime*0.19 + s*4.0)*0.45 + cos(uTime*0.37 + s*6.0)*0.1;
  ${blink
    ? `float blink = 0.5 + 0.5*sin(uTime*(1.4 + aSeed*2.4) + s*11.0); vA = smoothstep(0.35, 0.95, blink);`
    : `vA = 0.55 + 0.45*sin(uTime*0.5 + s*9.0);`}
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * uPx / max(0.6, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float core = exp(-dot(d,d)*24.0);
  ${blink
    ? `gl_FragColor = vec4(uColor * (0.4 + 2.6*vA), core * (0.12 + 0.88*vA));`
    : `gl_FragColor = vec4(uColor, core * uOpacity * vA);`}
}`
  });
  env.disposables.push(mat);
  env.timeMats.push(mat);
  env.pointMats.push(mat);
  return mat;
}

function buildDriftPoints(p, rng, env, { blink }){
  const N = p.count ?? 150, R = (p.area && p.area[0]) ?? 4, H = (p.area && p.area[1]) ?? 3;
  const pos = new Float32Array(N*3), seed = new Float32Array(N);
  for(let i=0;i<N;i++){
    const a = rng()*Math.PI*2, r = Math.sqrt(rng())*R;
    pos[i*3]   = Math.cos(a)*r;
    pos[i*3+1] = 0.1 + rng()*H;
    pos[i*3+2] = Math.sin(a)*r;
    seed[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  env.disposables.push(geo);
  const mat = softPointsMaterial({
    color: p.color ?? '#ffffff', size: p.size ?? 0.03, opacity: p.opacity ?? 0.6, blink
  }, env);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

const PARTICLES = {
  motes:     (p, rng, env)=> buildDriftPoints(p, rng, env, { blink:false }),
  fireflies: (p, rng, env)=> buildDriftPoints(p, rng, env, { blink:true }),

  /* Falling ink leaves: a few dozen CPU-updated instanced blades tumbling down.
     All parameters come from the scene rng; motion is a pure function of time. */
  inkleaves(p, rng, env){
    const N = p.count ?? 40, R = (p.area && p.area[0]) ?? 3, H = (p.area && p.area[1]) ?? 3;
    const size = p.size ?? 0.055;
    const geo = new THREE.PlaneGeometry(size*2.4, size, 2, 1);
    { // pinch the quad into a blade-ish leaf silhouette
      const v = geo.attributes.position;
      for(let i=0;i<v.count;i++){
        const x = v.getX(i);
        const t = Math.abs(x)/(size*1.2);
        v.setY(i, v.getY(i) * (1.0 - t*0.85));
      }
    }
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color ?? '#262a33'), side: THREE.DoubleSide });
    env.disposables.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.frustumCulled = false;
    const params = [];
    for(let i=0;i<N;i++){
      const a = rng()*Math.PI*2;
      params.push({
        x0: Math.cos(a)*Math.sqrt(rng())*R, z0: Math.sin(a)*Math.sqrt(rng())*R,
        phase: rng()*H, speed: 0.10 + rng()*0.16,
        sway: 0.15 + rng()*0.35, swayF: 0.4 + rng()*0.6,
        spinA: rng()*Math.PI*2, spinB: rng()*Math.PI*2, spinF: 0.5 + rng()*1.4
      });
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
    env.updaters.push((t)=>{
      for(let i=0;i<N;i++){
        const P = params[i];
        const y = H - ((t*P.speed + P.phase) % H);
        v.set(P.x0 + Math.sin(t*P.swayF + P.phase*7)*P.sway, 0.04 + y,
              P.z0 + Math.cos(t*P.swayF*0.8 + P.phase*5)*P.sway*0.7);
        e.set(P.spinA + t*P.spinF, P.spinB + t*P.spinF*0.6, Math.sin(t*P.spinF + P.phase)*0.9);
        q.setFromEuler(e);
        m.compose(v, q, new THREE.Vector3(1,1,1));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
    return mesh;
  },
};

/* ============================================================
   Post passes. Order is fixed regardless of listing order:
   RenderPass -> bloom (linear/HDR) -> OutputPass (tone map + sRGB)
   -> grade / inkwash (display-referred).
   ============================================================ */
const GradeShader = {
  uniforms: {
    tDiffuse:{value:null},
    uLift:{value:new THREE.Color(0)}, uGain:{value:new THREE.Color(1,1,1)},
    uSat:{value:1}, uContrast:{value:1}, uVig:{value:0}
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uLift, uGain; uniform float uSat, uContrast, uVig;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c = c * (uGain - uLift) + uLift;                       // lift/gain
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, uSat);                           // saturation
  c = (c - 0.5) * uContrast + 0.5;                       // contrast
  float d = distance(vUv, vec2(0.5));
  c *= 1.0 - uVig * smoothstep(0.35, 0.85, d);           // vignette
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`
};

const InkWashShader = {
  uniforms: {
    tDiffuse:{value:null}, uRes:{value:new THREE.Vector2(1024,768)},
    uPaper:{value:new THREE.Color('#f2ecdd')}, uInk:{value:new THREE.Color('#232630')},
    uDesat:{value:0.82}, uGrain:{value:0.05}, uVig:{value:0.3}
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes;
uniform vec3 uPaper, uInk; uniform float uDesat, uGrain, uVig;
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(lum), uDesat);                          // toward monochrome
  vec3 ramp = mix(uInk, uPaper, smoothstep(0.0, 1.0, pow(lum, 0.85)));
  c = mix(c, ramp, 0.55);                                 // pull onto the paper/ink ramp
  vec2 px = vUv * uRes / 3.0;
  float grain = pnoise3(vec3(px, 3.7)) - 0.5;             // static paper tooth
  float fib = pnoise3(vec3(px*vec2(0.12, 1.9), 9.2)) - 0.5; // paper fibre streaks
  c += (grain * 0.75 + fib * 0.6) * uGrain;
  float d = distance(vUv, vec2(0.5));
  c = mix(c, uPaper, uVig * smoothstep(0.42, 0.85, d));   // edges dissolve into paper
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`
};

/* ============================================================
   The rig
   ============================================================ */
export function createSceneRig(ctx){
  const { renderer, scene, camera, controls, leafMat, getTree, regradeLeaves } = ctx;
  const root = new THREE.Group();
  root.name = 'scene-rig';
  scene.add(root);
  const pmrem = new THREE.PMREMGenerator(renderer);

  const rig = {
    spec: null,
    keyLight: null,
    keyDir: new THREE.Vector3(0.45, 0.8, 0.35).normalize(),
    backlightColor: new THREE.Color(0xfff1e2).multiplyScalar(0.16),
    leafGradeAdjust: null,          // read by the demo's regradeLeaves()
    composer: null,
    _disposables: [],
    _updaters: [],
    _timeMats: [],                  // materials with a uTime uniform
    _pointMats: [],                 // point materials needing uPx on resize
    _resPasses: [],                 // passes needing uRes on resize
    _flickers: [],                  // { light, base, amt }
    _envRT: null,
    _shadowMapSpec: 1024,
    _quality: { shadowMapSize: 2048 },
    _t0: null,
  };

  function clear(){
    while(root.children.length) root.remove(root.children[0]);
    for(const d of rig._disposables){ if (d && d.dispose) d.dispose(); }
    rig._disposables.length = 0;
    rig._updaters.length = 0;
    rig._timeMats.length = 0;
    rig._pointMats.length = 0;
    rig._resPasses.length = 0;
    rig._flickers.length = 0;
    if (rig.composer){ rig.composer.dispose(); rig.composer = null; }
    if (rig._envRT){ rig._envRT.dispose(); rig._envRT = null; }
    scene.environment = null;
    scene.fog = null;
    scene.background = null;
  }

  /* ---------- background ---------- */
  function applyBackground(bg){
    if (!bg || bg.type === 'color'){
      renderer.setClearColor(new THREE.Color((bg && bg.value) || '#ffffff'), 1);
      return;
    }
    if (bg.type === 'gradient'){
      const top = new THREE.Color(bg.top), bottom = new THREE.Color(bg.bottom);
      renderer.setClearColor(bottom, 1);
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { uTop:{value:top}, uBottom:{value:bottom}, uCurve:{value:bg.curve ?? 1.2} },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; uniform vec3 uTop, uBottom; uniform float uCurve;
void main(){
  float t = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(uBottom, uTop, pow(t, uCurve)), 1.0);
}`
      });
      const geo = new THREE.SphereGeometry(48, 24, 16);
      rig._disposables.push(mat, geo);
      const sky = new THREE.Mesh(geo, mat);
      sky.renderOrder = -10;
      sky.frustumCulled = false;
      root.add(sky);
    }
  }

  /* ---------- image-based lighting ---------- */
  function applyIBL(ibl){
    if (!ibl || ibl.source === 'none'){ scene.environment = null; return; }
    if (ibl.source === 'room'){
      rig._envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    } else if (ibl.source === 'gradient'){
      // procedural sky-dome PMREM: gradient sphere + a bright blob toward the key
      // light so the env map has directional interest. Zero assets.
      const es = new THREE.Scene();
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          uSky:{value:new THREE.Color(ibl.sky ?? '#ffffff')},
          uHor:{value:new THREE.Color(ibl.horizon ?? '#dddddd')},
          uGnd:{value:new THREE.Color(ibl.ground ?? '#444444')}
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; uniform vec3 uSky, uHor, uGnd;
void main(){
  float y = normalize(vP).y;
  vec3 c = y > 0.0 ? mix(uHor, uSky, pow(y, 0.7)) : mix(uHor, uGnd, pow(-y, 0.55));
  gl_FragColor = vec4(c, 1.0);
}`
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), mat);
      const blobMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(rig.keyLight ? rig.keyLight.color : 0xffffff).multiplyScalar(4)
      });
      const blob = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), blobMat);
      blob.position.copy(rig.keyDir).multiplyScalar(7.5);
      es.add(sphere, blob);
      rig._envRT = pmrem.fromScene(es, 0.04);
      sphere.geometry.dispose(); mat.dispose(); blob.geometry.dispose(); blobMat.dispose();
    } else if (ibl.source === 'hdri' && ibl.url){
      // custom-HDRI path: equirect .hdr -> PMREM (async; scene works while it loads)
      new RGBELoader().load(ibl.url, (tex)=>{
        tex.mapping = THREE.EquirectangularReflectionMapping;
        rig._envRT = pmrem.fromEquirectangular(tex);
        tex.dispose();
        scene.environment = rig._envRT.texture;
        rig.applyTreeOverrides();          // rebind the tree materials' envMap
      });
    }
    if (rig._envRT) scene.environment = rig._envRT.texture;
    if ('environmentIntensity' in scene) scene.environmentIntensity = ibl.intensity ?? 1.0;
  }

  /* ---------- lights ---------- */
  function applyShadowMapSize(){
    const key = rig.keyLight; if (!key) return;
    const px = Math.min(rig._shadowMapSpec, rig._quality.shadowMapSize || 2048);
    if (key.shadow.mapSize.x !== px){
      key.shadow.mapSize.set(px, px);
      if (key.shadow.map) key.shadow.map.setSize(px, px);
    }
  }

  function applyLights(lights){
    const L = lights || [];
    let keySpec = L.find(l=> l.role === 'key');
    if (!keySpec) keySpec = { type:'directional', color:'#ffffff', intensity:2, position:[4,7,3], shadow:{} };
    const key = new THREE.DirectionalLight(new THREE.Color(keySpec.color), keySpec.intensity);
    key.position.fromArray(keySpec.position);
    key.castShadow = true;
    const sh = keySpec.shadow || {};
    key.shadow.bias = sh.bias ?? -0.0003;
    key.shadow.normalBias = sh.normalBias ?? 0.05;
    rig._shadowMapSpec = sh.mapSize ?? 1024;
    rig.keyLight = key;
    rig.keyDir.copy(key.position).normalize();
    applyShadowMapSize();
    root.add(key, key.target);

    for(const l of L){
      if (l === keySpec) continue;
      if (l.type === 'hemisphere'){
        root.add(new THREE.HemisphereLight(new THREE.Color(l.sky), new THREE.Color(l.ground), l.intensity ?? 0.5));
      } else if (l.type === 'directional'){
        const d = new THREE.DirectionalLight(new THREE.Color(l.color), l.intensity ?? 1);
        d.position.fromArray(l.position || [0,5,0]);
        root.add(d, d.target);
      } else if (l.type === 'point'){
        const pt = new THREE.PointLight(new THREE.Color(l.color), l.intensity ?? 1, l.distance ?? 0, l.decay ?? 2);
        pt.position.fromArray(l.position || [0,1,0]);
        root.add(pt);
        if (l.flicker) rig._flickers.push({ light: pt, base: pt.intensity, amt: l.flicker });
      } else if (l.type === 'ambient'){
        root.add(new THREE.AmbientLight(new THREE.Color(l.color), l.intensity ?? 0.3));
      }
    }
  }

  /* ---------- ground ---------- */
  function applyGround(g, sceneRng){
    if (!g || g.type === 'none') return;

    if (g.type === 'mesh' && g.material){
      const R = ((g.fade && g.fade.outer) || 4.5) + 2.5;
      const geo = new THREE.CircleGeometry(R, 64).rotateX(-Math.PI/2);
      // stone materials expect vertex colors
      const n = geo.attributes.position.count;
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n*3).fill(1), 3));
      rig._disposables.push(geo);
      let mat;
      if (g.material === 'sandstone'){
        mat = makeStoneMaterial({ base:'#b3a077', dark:'#6e5f45', moss:'#55663a', mossAmt:0.5, grid:1.0 }, rig._disposables);
      } else if (g.material === 'moss'){
        mat = makeStoneMaterial({ base:'#1c2b1e', dark:'#0b120c', moss:'#2c4a2e', mossAmt:0.75, grid:0.0, roughness:0.98 }, rig._disposables);
      } else {
        mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.95 });
        rig._disposables.push(mat);
      }
      const ground = new THREE.Mesh(geo, mat);
      ground.receiveShadow = true;
      root.add(ground);
    } else { // shadowcatcher (transparent -- the background shows through)
      const shadowMat = new THREE.ShadowMaterial({ opacity: g.shadowOpacity ?? 0.12 });
      if (g.shadowColor) shadowMat.color = new THREE.Color(g.shadowColor);
      rig._disposables.push(shadowMat);
      const geo = new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI/2);
      rig._disposables.push(geo);
      const catcher = new THREE.Mesh(geo, shadowMat);
      catcher.receiveShadow = true;
      catcher.renderOrder = 1;
      root.add(catcher);

      // optional decorative layer under the catcher (ink-wash ground strokes)
      if (g.material === 'inkstrokes'){
        const smat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false,
          uniforms: { uInk:{value:new THREE.Color('#2b2f3a')}, uSeed:{value:(sceneRng()*100)|0} },
          vertexShader: `varying vec3 vWp; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWp = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
          fragmentShader: `varying vec3 vWp; uniform vec3 uInk; uniform float uSeed;
${NOISE_GLSL}
void main(){
  float r = length(vWp.xz);
  float a = atan(vWp.z, vWp.x);
  // enso ring: a broken brush circle around the tree
  float ring = exp(-pow((r - 1.45)*3.2, 2.0));
  float dry = 0.35 + 0.65*pfbm(vec3(cos(a), sin(a), uSeed)*2.4);
  ring *= smoothstep(0.28, 0.62, dry);
  // raked-gravel streaks fading with distance
  float rake = smoothstep(0.72, 0.95, pfbm(vec3(vWp.x*0.7, vWp.z*3.1, uSeed+7.0)));
  rake *= (1.0 - smoothstep(1.4, 3.8, r)) * 0.5;
  float ink = clamp(ring*0.85 + rake, 0.0, 0.8);
  ink *= 0.75 + 0.25*pnoise3(vWp*23.0);
  gl_FragColor = vec4(uInk, ink * 0.6);
}`
        });
        const sgeo = new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI/2).translate(0, 0.0008, 0);
        rig._disposables.push(smat, sgeo);
        const strokes = new THREE.Mesh(sgeo, smat);
        strokes.renderOrder = 0;
        root.add(strokes);
      }
    }

    // radial fade into the backdrop -- color is per-scene (coupling #5)
    if (g.fade){
      const fmat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: {
          uInner:{value:g.fade.inner ?? 2.1}, uOuter:{value:g.fade.outer ?? 4.3},
          uColor:{value:new THREE.Color(g.fade.color ?? '#ffffff')}
        },
        vertexShader: `varying vec3 vWp; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWp = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
        fragmentShader:`varying vec3 vWp; uniform float uInner, uOuter; uniform vec3 uColor;
void main(){ float a = smoothstep(uInner, uOuter, length(vWp.xz)); gl_FragColor = vec4(uColor, a); }`
      });
      const fgeo = new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI/2).translate(0, 0.0015, 0);
      rig._disposables.push(fmat, fgeo);
      const fade = new THREE.Mesh(fgeo, fmat);
      fade.renderOrder = 2;
      root.add(fade);
    }

    if (g.contact){
      const c = g.contact;
      const contactMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: {
          uColor:{value:new THREE.Color(c.color ?? '#4a341c')},
          uWarm:{value:new THREE.Color(c.warm ?? c.color ?? '#6a4b2a')},
          uRadius:{value:c.radius ?? 1.7},
          uOpacity:{value:c.opacity ?? 0.18},
          uSeed:{value:(sceneRng()*1000)|0},
        },
        vertexShader: `varying vec3 vWp; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWp = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
        fragmentShader: `varying vec3 vWp;
uniform vec3 uColor, uWarm;
uniform float uRadius, uOpacity, uSeed;
${NOISE_GLSL}
void main(){
  float r = length(vWp.xz);
  float a = atan(vWp.z, vWp.x);
  float rootRay = pow(0.5 + 0.5*cos(a*9.0 + pfbm(vec3(vWp.xz*1.4, uSeed))*3.6), 3.0);
  float radial = 1.0 - smoothstep(uRadius*0.32, uRadius, r);
  float broken = smoothstep(0.22, 0.78, pfbm(vec3(vWp.x*2.7, vWp.z*2.7, uSeed + 2.0)));
  float soil = radial * (0.38 + 0.62*rootRay) * (0.55 + 0.45*broken);
  float outer = (1.0 - smoothstep(uRadius*0.58, uRadius*1.18, r)) * smoothstep(0.15, uRadius*0.65, r);
  soil += outer * smoothstep(0.62, 0.9, pfbm(vec3(vWp.xz*5.2, uSeed + 9.0))) * 0.25;
  vec3 col = mix(uColor, uWarm, broken*0.35);
  gl_FragColor = vec4(col, clamp(soil*uOpacity, 0.0, 0.75));
}`
      });
      const contactGeo = new THREE.PlaneGeometry(5.8, 5.8, 1, 1).rotateX(-Math.PI/2).translate(0, 0.0022, 0);
      rig._disposables.push(contactMat, contactGeo);
      const contact = new THREE.Mesh(contactGeo, contactMat);
      contact.renderOrder = 3;
      root.add(contact);
    }
  }

  /* ---------- atmosphere ---------- */
  function applyAtmosphere(a, sceneRng){
    if (!a) return;
    if (a.fog){
      scene.fog = a.fog.type === 'linear'
        ? new THREE.Fog(new THREE.Color(a.fog.color), a.fog.near ?? 4, a.fog.far ?? 30)
        : new THREE.FogExp2(new THREE.Color(a.fog.color), a.fog.density ?? 0.02);
    }
    if (a.particles && PARTICLES[a.particles.preset]){
      const env = {
        disposables: rig._disposables, timeMats: rig._timeMats,
        pointMats: rig._pointMats, updaters: rig._updaters
      };
      root.add(PARTICLES[a.particles.preset](a.particles, sceneRng, env));
    }
  }

  /* ---------- props ---------- */
  function applyProps(props, sceneRng){
    if (!props || !props.length) return;
    const env = {
      disposables: rig._disposables, timeMats: rig._timeMats,
      pointMats: rig._pointMats, updaters: rig._updaters,
      keyDir: rig.keyDir,
      stoneMat: null,
    };
    for(const p of props){
      const name = String(p.src || '').replace(/^procedural:/, '');
      const builder = PROPS[name];
      if (!builder) continue;
      if ((name === 'ruinWall' || name === 'rubble') && !env.stoneMat){
        env.stoneMat = makeStoneMaterial({}, rig._disposables);
      }
      const obj = builder(p, sceneRng, env);
      if (p.position) obj.position.fromArray(p.position);
      if (p.rotationY) obj.rotation.y = p.rotationY;
      root.add(obj);
    }
  }

  /* ---------- post ---------- */
  function applyPost(post){
    const list = post || [];
    if (!list.length) return;                    // no composer -> plain renderer path
    const size = renderer.getSize(new THREE.Vector2());
    // ANGLE/D3D11 (Windows Chrome) cannot reliably MSAA-resolve a half-float
    // composer target through EffectComposer + UnrealBloomPass -> the whole
    // canvas renders black (it worked under headless SwiftShader, which is why
    // it slipped past the browser harness). Dropping MSAA on the post path fixes
    // it; bloom + grain + vignette already mask edge aliasing, so the visual cost
    // is nil. Non-multisampled RGBA16F is core-renderable in WebGL2 everywhere.
    // See opus48-prompt-remaining-roadmap.md Phase 0a.
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    const composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.addPass(new RenderPass(scene, camera));
    for(const p of list){
      if (p.pass === 'bloom'){
        composer.addPass(new UnrealBloomPass(
          new THREE.Vector2(size.x, size.y), p.strength ?? 0.4, p.radius ?? 0.5, p.threshold ?? 0.85));
      }
    }
    composer.addPass(new OutputPass());
    for(const p of list){
      if (p.pass === 'grade'){
        const pass = new ShaderPass(GradeShader);
        pass.uniforms.uLift.value.set(p.lift ?? '#000000');
        pass.uniforms.uGain.value.set(p.gain ?? '#ffffff');
        pass.uniforms.uSat.value = p.saturation ?? 1;
        pass.uniforms.uContrast.value = p.contrast ?? 1;
        pass.uniforms.uVig.value = p.vignette ?? 0;
        composer.addPass(pass);
      } else if (p.pass === 'inkwash'){
        const pass = new ShaderPass(InkWashShader);
        pass.uniforms.uPaper.value.set(p.paper ?? '#f2ecdd');
        pass.uniforms.uInk.value.set(p.ink ?? '#232630');
        pass.uniforms.uDesat.value = p.desat ?? 0.82;
        pass.uniforms.uGrain.value = p.grain ?? 0.05;
        pass.uniforms.uVig.value = p.vignette ?? 0.3;
        pass.uniforms.uRes.value.set(size.x, size.y);
        rig._resPasses.push(pass);
        composer.addPass(pass);
      }
    }
    rig.composer = composer;
  }

  /* ============================================================
     Public API
     ============================================================ */
  rig.apply = function(spec){
    clear();
    rig.spec = spec;
    const sceneRng = mulberry32((spec.seed ?? 1) >>> 0);   // the SCENE stream, never the tree's

    applyLights(spec.lights);          // first: keyDir feeds ibl blob + light shafts
    applyBackground(spec.background);
    applyIBL(spec.ibl);
    applyGround(spec.ground, sceneRng);
    applyAtmosphere(spec.atmosphere, sceneRng);
    applyProps(spec.props, sceneRng);
    applyPost(spec.post);

    if (spec.camera){
      if (spec.camera.fov){ camera.fov = spec.camera.fov; camera.updateProjectionMatrix(); }
      if (spec.camera.position) camera.position.fromArray(spec.camera.position);
      if (spec.camera.target) controls.target.fromArray(spec.camera.target);
      controls.update();
    }

    rig.applyTreeOverrides();
    rig.fitShadows();
    rig.setSize(renderer.domElement.clientWidth || 1, renderer.domElement.clientHeight || 1);
    console.log(`[banyan] scene=${spec.id}`);
  };

  /* Coupling #1/#2/#3/#6: push treeOverrides into the live tree. Called on scene
     swap AND after every build() (the bark material is recreated per build).

     envMapIntensity note (r163+ behavior, verified in r165 source): when a
     material's envMap comes implicitly from scene.environment, the renderer
     overwrites the envMapIntensity uniform with scene.environmentIntensity every
     frame -- material.envMapIntensity is IGNORED. So to give the TREE its own
     per-scene intensity (audit coupling #1) we bind scene.environment as the
     tree materials' explicit .envMap; props keep the implicit path and follow
     ibl.intensity (scene.environmentIntensity) instead. */
  rig.applyTreeOverrides = function(){
    const o = (rig.spec && rig.spec.treeOverrides) || {};
    renderer.toneMappingExposure = o.exposure ?? 1.05;
    const env = o.envMapIntensity ?? 1.0;
    const t = getTree();
    for (const m of [t.barkMat, leafMat, t.blossomMat]){
      if (!m) continue;
      if (m.envMap !== scene.environment){ m.envMap = scene.environment; m.needsUpdate = true; }
      m.envMapIntensity = env;
    }
    const bl = o.backlight || {};
    rig.backlightColor.set(bl.color ?? '#fff1e2').multiplyScalar(bl.intensity ?? 0.16);
    const g = o.leafGrade;
    rig.leafGradeAdjust = (g && ((g.hueShift || 0) !== 0 || (g.satMul ?? 1) !== 1 || (g.lightMul ?? 1) !== 1))
      ? { hueShift: g.hueShift || 0, satMul: g.satMul ?? 1, lightMul: g.lightMul ?? 1 }
      : null;
    const vd = o.visualDetail || {};
    setLeafVisualDetail(leafMat, vd.foliage || {});
    setBarkVisualDetail(t.barkMat, vd.bark || {});
    regradeLeaves();
  };

  /* Coupling #4 (SS1.4 #8): auto-fit the key light's ortho shadow camera to the
     current tree's wood+leaf bounding box. Direction comes from the SceneSpec. */
  rig.fitShadows = function(){
    const key = rig.keyLight; if (!key) return;
    const { wood, leaves, blossoms } = getTree();
    const box = new THREE.Box3();
    if (wood){ wood.geometry.computeBoundingBox(); box.union(wood.geometry.boundingBox); }
    if (leaves){ leaves.computeBoundingBox(); box.union(leaves.boundingBox); }
    if (blossoms){ blossoms.computeBoundingBox(); box.union(blossoms.boundingBox); }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const c = sphere.center, r = Math.max(1, sphere.radius);
    const dist = Math.max(6, r*2.2);
    key.position.copy(c).addScaledVector(rig.keyDir, dist);
    key.target.position.copy(c);
    key.target.updateMatrixWorld();
    const cam = key.shadow.camera;
    const m = r*1.06;
    cam.left = -m; cam.right = m; cam.top = m; cam.bottom = -m;
    cam.near = Math.max(0.5, dist - r*1.2);
    cam.far  = dist + r*1.2 + Math.max(0, box.max.y) / Math.max(0.2, rig.keyDir.y);
    cam.updateProjectionMatrix();
  };

  /* Quality preset hook (SS1.4 #5): Qx.shadowMapSize acts as a CAP on the
     SceneSpec's requested shadow map. */
  rig.setQuality = function(Qx){
    rig._quality = Qx;
    applyShadowMapSize();
  };

  rig.setSize = function(w, h){
    if (rig.composer){
      rig.composer.setPixelRatio(renderer.getPixelRatio());
      rig.composer.setSize(w, h);
    }
    const px = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
    for(const m of rig._pointMats) m.uniforms.uPx.value = px;
    for(const p of rig._resPasses) p.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  };

  rig.update = function(nowMs){
    if (rig._t0 === null) rig._t0 = nowMs;
    const t = (nowMs - rig._t0) / 1000;
    for(const m of rig._timeMats) m.uniforms.uTime.value = t;
    for(const u of rig._updaters) u(t);
    for(const f of rig._flickers){
      f.light.intensity = f.base * (1 + f.amt * (Math.sin(t*9.3) + 0.5*Math.sin(t*23.7) + Math.sin(t*5.1)) / 2.5);
    }
  };

  rig.render = function(){
    if (rig.composer) rig.composer.render();
    else renderer.render(scene, camera);
  };

  return rig;
}
