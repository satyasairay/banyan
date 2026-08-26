// Materials: procedural GLSL bark (striae/mottle/bump computed in-shader, zero
// textures) and the physically-shaded leaf blade (veins, backface darkening,
// sun-backlight translucency). All S.bark values are LIVE UNIFORMS (SS1.4 #4).
import * as THREE from 'three';

export function makeBarkMaterial(S){
  const Bk = S.bark;
  const smooth = Bk.style === 'smooth';
  /* Two GLSL variants. 'ridged' (default) is the ORIGINAL banyan bark --
     the strings below are byte-identical to the pre-species shader.
     'smooth' (TreeSpec/v1 bark.style, cherry/baobab family) swaps the height
     field for soft sheen bands + horizontal lenticel dashes. */
  const BARKH_GLSL = smooth ? `
uniform vec3 uLentic;
float barkH(){
  float ang = vBUv.x*6.2831853;
  vec3 cyl = vec3(cos(ang)*1.55, vBUv.y*1.05, sin(ang)*1.55);
  float broad = bfbm(cyl*vec3(uStria, 0.45, uStria));
  float band  = bnoise(vec3(2.7, vBUv.y*uMottle*1.6, 3.9));
  return broad*0.55 + band*0.45;
}
float lenticels(){
  float d = bnoise(vec3(vBUv.x*uStria*6.0, vBUv.y*uMottle*9.0, 8.5));
  return smoothstep(0.70, 0.82, d) * (1.0 - smoothstep(0.84, 0.94, d));
}` : `
float barkH(){
  float ang = vBUv.x*6.2831853;
  vec3 cyl = vec3(cos(ang)*1.55, vBUv.y*1.05, sin(ang)*1.55);
  float stria = bfbm(cyl*vec3(uStria, 1.0, uStria));
  float mott  = bfbm(vWP*uMottle);
  float fine  = bnoise(vWP*52.0);
  return stria*0.60 + mott*0.28 + fine*0.12;
}`;
  const MAP_GLSL = smooth ? `
{
  gBarkH = barkH();
  float crack = barkCrackMask()*uBarkCrack;
  float knot = barkKnotMask()*uBarkKnot;
  float macro = bfbm(vWP*vec3(0.72, 0.36, 0.72) + vec3(6.0, 1.0, 2.0))*uBarkMacro;
  gBarkH = clamp(gBarkH + uBarkRelief*(knot*0.18 - crack*0.22), 0.0, 1.0);
  vec3 bark = mix(uCrevice, uRidge, smoothstep(0.18, 0.85, gBarkH));
  bark = mix(bark, bark*vec3(1.06, 0.99, 0.96), smoothstep(0.6, 0.9, bfbm(vWP*1.8))*0.35);
  bark = mix(bark, uCrevice*0.62, crack*0.72);
  bark = mix(bark, uRidge*vec3(1.14, 1.08, 0.98), knot*0.38);
  bark *= 0.92 + 0.22*macro;
  bark = mix(bark, uLentic, lenticels()*0.75);
  diffuseColor.rgb = bark;
}` : `
{
  gBarkH = barkH();
  float crack = barkCrackMask()*uBarkCrack;
  float knot = barkKnotMask()*uBarkKnot;
  float macro = bfbm(vWP*vec3(0.68, 0.34, 0.68) + vec3(6.0, 1.0, 2.0))*uBarkMacro;
  gBarkH = clamp(gBarkH + uBarkRelief*(knot*0.16 - crack*0.26), 0.0, 1.0);
  vec3 crev = uCrevice;
  vec3 ridg = uRidge;
  vec3 bark = mix(crev, ridg, smoothstep(0.22, 0.78, gBarkH));
  bark = mix(bark, bark*vec3(0.9, 1.02, 0.88), smoothstep(0.62, 0.9, bfbm(vWP*2.6))*0.45);
  bark = mix(bark, crev*0.50, crack*0.82);
  bark = mix(bark, ridg*vec3(1.20, 1.12, 1.02), knot*0.42);
  bark *= 0.90 + 0.24*macro;
  diffuseColor.rgb = bark;
}`;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.87, metalness: 0.0,
    vertexColors: true, envMapIntensity: 0.25
  });
  mat.userData.barkVisualDetail = { macro:0, cracks:0, knots:0, relief:0 };
  mat.onBeforeCompile = (sh)=>{
    const detail = mat.userData.barkVisualDetail || {};
    sh.uniforms.uBumpAmt  = { value: Bk.bump };
    sh.uniforms.uStria    = { value: Bk.striaScale };
    sh.uniforms.uMottle   = { value: Bk.mottleScale };
    sh.uniforms.uCrevice  = { value: new THREE.Vector3(Bk.crevice[0], Bk.crevice[1], Bk.crevice[2]) };
    sh.uniforms.uRidge    = { value: new THREE.Vector3(Bk.ridge[0], Bk.ridge[1], Bk.ridge[2]) };
    sh.uniforms.uBarkMacro = { value: detail.macro ?? 0 };
    sh.uniforms.uBarkCrack = { value: detail.cracks ?? 0 };
    sh.uniforms.uBarkKnot  = { value: detail.knots ?? 0 };
    sh.uniforms.uBarkRelief= { value: detail.relief ?? 0 };
    if (smooth){
      const lc = Bk.lenticel || [0.42, 0.36, 0.33];
      sh.uniforms.uLentic = { value: new THREE.Vector3(lc[0], lc[1], lc[2]) };
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec2 vBUv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWP; varying vec2 vBUv;
uniform float uBumpAmt;
uniform float uStria;
uniform float uMottle;
uniform float uBarkMacro;
uniform float uBarkCrack;
uniform float uBarkKnot;
uniform float uBarkRelief;
uniform vec3 uCrevice;
uniform vec3 uRidge;
float gBarkH;
float bhash(vec3 p){ p = fract(p*0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float bnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(bhash(i),bhash(i+vec3(1,0,0)),f.x), mix(bhash(i+vec3(0,1,0)),bhash(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(bhash(i+vec3(0,0,1)),bhash(i+vec3(1,0,1)),f.x), mix(bhash(i+vec3(0,1,1)),bhash(i+vec3(1,1,1)),f.x), f.y), f.z); }
float bfbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*bnoise(p); p *= 2.03; a *= 0.5; } return s*1.07; }
float barkCrackMask(){
  float flow = bfbm(vWP*vec3(0.65, 1.8, 0.65) + vec3(2.1, 0.0, 7.4));
  float seam = abs(fract(vBUv.x*uStria*2.4 + flow*0.38) - 0.5);
  float broken = smoothstep(0.34, 0.86, bfbm(vec3(vBUv.x*10.0, vBUv.y*uMottle*0.62, 3.7)));
  return (1.0 - smoothstep(0.018, 0.082, seam)) * broken;
}
float barkKnotMask(){
  float pores = bfbm(vWP*vec3(2.0, 0.72, 2.0) + vec3(4.0, 9.0, 1.0));
  float rings = abs(bfbm(vWP*vec3(4.8, 1.1, 4.8)) - 0.56);
  return smoothstep(0.72, 0.92, pores) * (1.0 - smoothstep(0.07, 0.22, rings));
}
${BARKH_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
${MAP_GLSL}`)
      .replace('#include <roughnessmap_fragment>', smooth
        ? `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - (gBarkH-0.5)*0.3 - lenticels()*0.1, 0.35, 1.0);`
        : `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - (gBarkH-0.5)*0.18, 0.55, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 sp = -vViewPosition;
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1);
  float reliefH = gBarkH + uBarkRelief*(barkCrackMask()*0.75 + barkKnotMask()*0.34);
  vec3 grad = sign(det) * (dFdx(reliefH) * r1 + dFdy(reliefH) * r2);
  normal = normalize(abs(det) * normal - uBumpAmt * 0.012 * grad);
}`);
    mat.userData.shader = sh;
  };
  return mat;
}

/* Push current S.bark into the live uniforms (no rebuild). Returns false if the
   shader hasn't compiled yet -- harmless, onBeforeCompile reads S.bark at compile. */
export function restyleBark(mat, S){
  const sh = mat && mat.userData.shader;
  if (!sh) return false;
  sh.uniforms.uBumpAmt.value = S.bark.bump;
  sh.uniforms.uStria.value   = S.bark.striaScale;
  sh.uniforms.uMottle.value  = S.bark.mottleScale;
  sh.uniforms.uCrevice.value.set(S.bark.crevice[0], S.bark.crevice[1], S.bark.crevice[2]);
  sh.uniforms.uRidge.value.set(S.bark.ridge[0], S.bark.ridge[1], S.bark.ridge[2]);
  if (sh.uniforms.uLentic && S.bark.lenticel)
    sh.uniforms.uLentic.value.set(S.bark.lenticel[0], S.bark.lenticel[1], S.bark.lenticel[2]);
  return true;
}

export function setBarkVisualDetail(mat, detail = {}){
  if (!mat) return false;
  const next = {
    macro: detail.macro ?? 0,
    cracks: detail.cracks ?? 0,
    knots: detail.knots ?? 0,
    relief: detail.relief ?? 0,
  };
  mat.userData.barkVisualDetail = next;
  const sh = mat.userData.shader;
  if (!sh) return false;
  sh.uniforms.uBarkMacro.value = next.macro;
  sh.uniforms.uBarkCrack.value = next.cracks;
  sh.uniforms.uBarkKnot.value = next.knots;
  sh.uniforms.uBarkRelief.value = next.relief;
  return true;
}

/* Leaf material is CONSTANT across rebuilds (per-instance color carries the palette);
   build it once and keep its compiled shader for the per-frame backlight uniform. */
export function makeLeafMaterial(){
  const leafMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.46, metalness: 0.0,
    side: THREE.DoubleSide,
    clearcoat: 0.25, clearcoatRoughness: 0.32,
    sheen: 0.15, sheenColor: new THREE.Color(0x8fae66), sheenRoughness: 0.6,
    envMapIntensity: 0.25
  });
  leafMat.userData.leafVisualDetail = { variation:0, edge:1, vein:1, subsurface:1 };
  leafMat.onBeforeCompile = (sh)=>{
    const detail = leafMat.userData.leafVisualDetail || {};
    sh.uniforms.uSunView = { value: new THREE.Vector3(0,1,0) };
    sh.uniforms.uSunColor = { value: new THREE.Color(0xfff1e2).multiplyScalar(0.16) };
    sh.uniforms.uLeafVar = { value: detail.variation ?? 0 };
    sh.uniforms.uLeafEdge = { value: detail.edge ?? 1 };
    sh.uniforms.uLeafVein = { value: detail.vein ?? 1 };
    sh.uniforms.uLeafSubsurface = { value: detail.subsurface ?? 1 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aLeafMorph;
varying vec2 vLUv;
varying vec4 vLeafMorph;
uniform float uLeafVar;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLUv = uv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vLeafMorph = aLeafMorph;
{
  float morph = clamp(uLeafVar, 0.0, 1.0);
  float u = clamp(uv.x, 0.0, 1.0);
  float side = uv.y*2.0 - 1.0;
  float blade = sin(3.14159265*u);
  float lenScale = mix(1.0, 0.88 + 0.24*aLeafMorph.x, morph);
  float widthScale = mix(1.0, 0.78 + 0.42*aLeafMorph.y, morph);
  transformed.x *= lenScale;
  transformed.z *= widthScale;
  float twist = (aLeafMorph.z - 0.5) * morph * 0.30 * blade;
  float c = cos(twist), s = sin(twist);
  transformed.yz = vec2(transformed.y*c - transformed.z*s, transformed.y*s + transformed.z*c);
  transformed.y += morph * blade * ((aLeafMorph.w - 0.5)*0.018 + side*side*(aLeafMorph.z - 0.5)*0.018);
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vLUv;
varying vec4 vLeafMorph;
uniform vec3 uSunView;
uniform vec3 uSunColor;
uniform float uLeafVar;
uniform float uLeafEdge;
uniform float uLeafVein;
uniform float uLeafSubsurface;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float u = vLUv.x;
  float v = vLUv.y - 0.5;
  float av = abs(v);
  float mid = (1.0 - smoothstep(0.0, 0.045, av)) * (1.0 - smoothstep(0.72, 0.98, u));
  float d = abs(fract(u*13.0 - av*1.9) - 0.5);
  float lat = (1.0 - smoothstep(0.03, 0.09, d));
  lat *= 1.0 - smoothstep(0.30, 0.46, av);
  lat *= smoothstep(0.03, 0.12, u) * (1.0 - smoothstep(0.80, 0.97, u));
  float veins = clamp(mid*0.9 + lat*0.5, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.55,1.45,1.05) + vec3(0.012), veins*0.30*uLeafVein);
  diffuseColor.rgb *= 1.0 - 0.16*smoothstep(0.40, 0.5, av);
  float edge = smoothstep(0.36, 0.50, av);
  float freckle = fract(u*7.0 + vLeafMorph.x*5.0 + vLeafMorph.y*3.0 + vLeafMorph.z*2.0);
  diffuseColor.rgb *= 1.0 - uLeafVar*uLeafEdge*edge*(0.035 + 0.075*vLeafMorph.w);
  diffuseColor.rgb *= 1.0 + uLeafVar*0.055*(freckle - 0.5)*(1.0 - edge*0.45);
  if (!gl_FrontFacing) diffuseColor.rgb = diffuseColor.rgb*vec3(0.78,0.88,0.70) + vec3(0.045,0.06,0.028);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + uLeafVar*(smoothstep(0.36, 0.50, abs(vLUv.y - 0.5))*0.09 - 0.04), 0.30, 1.0);
if (!gl_FrontFacing) roughnessFactor = min(1.0, roughnessFactor + 0.32);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float backlit = clamp(-dot(normal, uSunView), 0.0, 1.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * uLeafSubsurface * pow(backlit, 1.6);
}`);
    leafMat.userData.shader = sh;
  };
  return leafMat;
}

export function setLeafVisualDetail(mat, detail = {}){
  if (!mat) return false;
  const next = {
    variation: detail.variation ?? 0,
    edge: detail.edge ?? 1,
    vein: detail.vein ?? 1,
    subsurface: detail.subsurface ?? 1,
  };
  mat.userData.leafVisualDetail = next;
  const sh = mat.userData.shader;
  if (!sh) return false;
  sh.uniforms.uLeafVar.value = next.variation;
  sh.uniforms.uLeafEdge.value = next.edge;
  sh.uniforms.uLeafVein.value = next.vein;
  sh.uniforms.uLeafSubsurface.value = next.subsurface;
  return true;
}

/* Blossom material (cherry family): per-instance color carries the pink range;
   soft sheen + slight clearcoat read as petal. Constant across rebuilds. */
export function makeBlossomMaterial(){
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.55, metalness: 0.0,
    side: THREE.DoubleSide,
    sheen: 0.4, sheenColor: new THREE.Color(0xffd7e6), sheenRoughness: 0.5,
    clearcoat: 0.08, clearcoatRoughness: 0.5,
    envMapIntensity: 0.25
  });
}
