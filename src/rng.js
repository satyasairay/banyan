// Deterministic RNG + value noise for the banyan engine.
// The tree's identity is: one mulberry32 stream (reseeded per build) + an
// integer-hash value-noise stack. Everything here is exact int32/float64 math,
// identical across JS engines (SS1.4 #6).
import { MathUtils } from 'three';

const lerp = MathUtils.lerp;

export function mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

// ---- the shared stream: skeleton growth and leaf placement draw from THIS in order ----
let rng = mulberry32(1892);
export const reseed = (seed)=>{ rng = mulberry32(seed); };
export const rand = ()=> rng();
export const rr = (a,b)=> a+(b-a)*rng();        // range draw from the current stream
export const rrOf = (u,a,b)=> a+(b-a)*u;        // rr() with an externally supplied unit draw (same arithmetic)

// stream-free deterministic unit hash (used ONLY for values the original never drew from rng)
export function ihash01(n){ n = Math.imul(n ^ (n>>>16), 0x45d9f3b); n = Math.imul(n ^ (n>>>16), 0x45d9f3b); n ^= n>>>16; return (n>>>0)/4294967296; }

// integer bit-mixing hash (SS1.4 #6): exact int32 ops only, so vnoise/fbm geometry
// is IDENTICAL across JS engines and browsers (Math.sin is not spec-pinned).
// Inputs are the integer lattice coords vnoise passes in.
export function hashN(x,y,z){
  let h = Math.imul(x|0, 0x27d4eb2d) ^ Math.imul(y|0, 0x165667b1) ^ Math.imul(z|0, 0x9e3779b1);
  h = Math.imul(h ^ (h>>>15), 0x85ebca6b);
  h = Math.imul(h ^ (h>>>13), 0xc2b2ae35);
  h ^= h>>>16;
  return (h>>>0)/4294967296;
}

export function vnoise(x,y,z){
  const xi=Math.floor(x), yi=Math.floor(y), zi=Math.floor(z);
  const xf=x-xi, yf=y-yi, zf=z-zi;
  const sx=xf*xf*(3-2*xf), sy=yf*yf*(3-2*yf), sz=zf*zf*(3-2*zf);
  const n000=hashN(xi,yi,zi),     n100=hashN(xi+1,yi,zi),
        n010=hashN(xi,yi+1,zi),   n110=hashN(xi+1,yi+1,zi),
        n001=hashN(xi,yi,zi+1),   n101=hashN(xi+1,yi,zi+1),
        n011=hashN(xi,yi+1,zi+1), n111=hashN(xi+1,yi+1,zi+1);
  return lerp(lerp(lerp(n000,n100,sx), lerp(n010,n110,sx), sy),
              lerp(lerp(n001,n101,sx), lerp(n011,n111,sx), sy), sz);
}

export function fbm(x,y,z,oct){
  let a=0.5, s=0, f=1;
  for(let i=0;i<oct;i++){ s += a*vnoise(x*f,y*f,z*f); f*=2.03; a*=0.5; }
  return s / (1 - Math.pow(0.5,oct));
}
