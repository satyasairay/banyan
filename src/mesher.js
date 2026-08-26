// Mesher: skeleton polylines -> lobed, gnarled tube geometry with
// parallel-transport frames, merged into ONE wood mesh (one draw call).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm } from './rng.js';
import { arcTable } from './skeleton.js';

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, smoothstep = THREE.MathUtils.smoothstep;

export function computeFrames(pts){
  const n = pts.length, T=[], N=[], B=[];
  for(let i=0;i<n;i++){
    const a = pts[Math.max(0,i-1)], b = pts[Math.min(n-1,i+1)];
    T.push(new THREE.Vector3().subVectors(b,a).normalize());
  }
  const up = Math.abs(T[0].y) > 0.92 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
  let N0 = up.clone().addScaledVector(T[0], -up.dot(T[0])).normalize();
  N.push(N0); B.push(new THREE.Vector3().crossVectors(T[0], N0).normalize());
  const q = new THREE.Quaternion();
  for(let i=1;i<n;i++){
    q.setFromUnitVectors(T[i-1], T[i]);
    const Ni = N[i-1].clone().applyQuaternion(q);
    Ni.addScaledVector(T[i], -Ni.dot(T[i])).normalize();
    N.push(Ni);
    B.push(new THREE.Vector3().crossVectors(T[i], Ni).normalize());
  }
  return {T, N, B};
}

export function flareAt(br, pts, i, cum, total){
  const lob = br.lobes;
  if (!lob) return 0;
  if (lob.mode === 'ground') return Math.pow(Math.max(0, 1 - pts[i].y/lob.span), 1.6);
  return Math.pow(Math.max(0, 1 - (total-cum[i])/lob.span), 1.6);
}

/* maxRadialSegs comes from the active quality preset (SS1.4 #5). */
export function tubeGeometry(br, maxRadialSegs = 26){
  let pts = br.pts, radii = br.radii;
  // blunt-tip fix (SS1.4 #8, audit 0.6): surface roots / prop feet used to taper to
  // needle points (~0.004-0.005) and read as spikes. Floor their radii and close the
  // end with a short rounded cap. Mesh-time only -- consumes no rng, skeleton identical.
  if (br.kind === 'root' || br.kind === 'prop'){
    const tipFloor = br.kind === 'root' ? 0.016 : 0.02;
    radii = radii.map(r => Math.max(r, tipFloor));
    const last = pts[pts.length-1], prev = pts[pts.length-2];
    const dir = last.clone().sub(prev).normalize();
    pts = pts.concat([last.clone().addScaledVector(dir, tipFloor*0.9)]);
    radii = radii.concat([tipFloor*0.35]);
  }
  // trunk dome cap (audit 0b): the trunk is built as an open cylinder ending at a
  // large radius (baobab r1=0.14..0.26) -- uncapped, it shows a hollow "sawn pipe"
  // mouth wherever the crown is sparse enough to see down into it (baobab worst).
  // Dome the top shut with a few shrinking rings so it rounds to a near-point the
  // scaffolds emerge around. Mesh-time only -- consumes no rng, skeleton identical,
  // scales with the trunk-top radius so a thin-topped trunk gets an invisible cap.
  if (br.kind === 'trunk'){
    const last = pts[pts.length-1], prev = pts[pts.length-2];
    const dir = last.clone().sub(prev).normalize();
    const r = radii[radii.length-1];
    pts = pts.concat([ last.clone().addScaledVector(dir, r*0.45),
                       last.clone().addScaledVector(dir, r*0.80),
                       last.clone().addScaledVector(dir, r*1.00) ]);
    radii = radii.concat([ r*0.62, r*0.30, 0.008 ]);
  }
  const n = pts.length;
  const {T, N, B} = computeFrames(pts);
  const maxR = Math.max(...radii);
  const segs = Math.min(maxRadialSegs, maxR>0.16 ? 26 : maxR>0.08 ? 16 : maxR>0.035 ? 11 : maxR>0.016 ? 8 : 6);
  const cum = arcTable(pts), total = cum[n-1];
  // Collar flare (audit 0b/0d): swell the basal ~25% of a child branch's rings so
  // the base blends into its parent tube instead of reading as a cut socket/floating
  // limb (worst on baobab's pale smooth bark; also the pine "detached limb"), paired
  // with a crotch contact-shadow in vertex AO -- real branch collars read as a dark
  // bark ridge, which is what smooth pale bark needs to sell the joint. Pure mesh-time
  // radial multiplier + vertex colour -- consumes no rng and moves no skeleton point
  // or leaf anchor, so verify/run.mjs and verify/species.mjs stay byte-identical.
  // Only 'branch' wood meets another tube at its base; trunk/root/prop/strand skip it.
  const collarAmt  = br.kind === 'branch' ? 0.85 : 0;
  const collarSpan = total * 0.25;
  const rootLike = br.kind === 'root' || br.kind === 'prop';
  const posA=[], norA=[], uvA=[], colA=[], idx=[];
  const rad = new THREE.Vector3(), nrm = new THREE.Vector3();
  for(let i=0;i<n;i++){
    const iP = Math.max(0,i-1), iN = Math.min(n-1,i+1);
    const slope = (radii[iP]-radii[iN]) / Math.max(1e-5, cum[iN]-cum[iP]);
    const f = flareAt(br, pts, i, cum, total);
    let collarMul = 1, collarAo = 1;
    if (collarAmt > 0 && collarSpan > 1e-5){
      const tc = clamp(cum[i]/collarSpan, 0, 1);
      const swell = collarAmt * (1-tc) * (1-tc);
      collarMul = 1 + swell;
      collarAo  = 1 - swell * 0.55;   // crotch contact-shadow so smooth bark reads the joint
    }
    for(let j=0;j<=segs;j++){
      const th = j/segs*Math.PI*2;
      const cs = Math.cos(th), sn = Math.sin(th);
      rad.set(0,0,0).addScaledVector(N[i],cs).addScaledVector(B[i],sn);
      let mul = 1, ao = 1;
      if (br.lobes && f > 1e-4){
        const w = Math.pow(0.5+0.5*Math.sin(th*br.lobes.count + br.lobes.phase), br.lobes.sharp);
        mul = 1 + f*(br.lobes.base + br.lobes.amp*w);
        ao  = 1 - f*(1-w)*0.42;
      }
      let g = 1 + br.gnarl * (fbm(cs*1.3 + br.id*0.719, cum[i]*2.4, sn*1.3 - br.id*0.377, 3) - 0.5) * 2.0;
      g = Math.max(0.62, g);
      let rootMul = 1, rootAo = 1, horizSpread = 1, vertSquash = 1;
      if (rootLike && total > 1e-5){
        const startCollar = Math.pow(1 - clamp(cum[i] / Math.min(0.18, total), 0, 1), 2);
        const groundBlend = Math.pow(1 - smoothstep(0.01, 0.18, pts[i].y), 1.4);
        const endBlend = Math.pow(clamp(cum[i] / total, 0, 1), 2.0);
        const rootCollar = (br.kind === 'prop' ? startCollar*0.18 : startCollar*0.32) + groundBlend*endBlend*0.16;
        rootMul += rootCollar;
        rootAo -= Math.min(0.24, rootCollar*0.34 + groundBlend*0.06);
        horizSpread += groundBlend*endBlend*0.12;
        vertSquash -= groundBlend*endBlend*0.08;
      }
      const Rr = Math.max(0.0006, radii[i]*mul*g*collarMul*rootMul);
      let px = pts[i].x + rad.x*Rr*horizSpread;
      let py = pts[i].y + rad.y*Rr*vertSquash;
      let pz = pts[i].z + rad.z*Rr*horizSpread;
      if (rootLike && pts[i].y < 0.035 && rad.y < -0.35) py = Math.max(-0.004, py);
      posA.push(px, py, pz);
      nrm.copy(rad).addScaledVector(T[i], slope).normalize();
      norA.push(nrm.x, nrm.y, nrm.z);
      uvA.push(j/segs, cum[i]*1.6);
      // extra AO where branches meet the ground, plus the collar contact-shadow
      const gAo = ao * collarAo * rootAo * clamp(0.72 + pts[i].y*1.8, 0.72, 1);
      colA.push(gAo, gAo, gAo);
    }
  }
  for(let i=0;i<n-1;i++) for(let j=0;j<segs;j++){
    const a = i*(segs+1)+j, b = a+segs+1;
    idx.push(a, a+1, b,  a+1, b+1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(norA, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvA, 2));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colA, 3));
  geo.setIndex(idx);
  return geo;
}

export function buildWoodGeometry(branches, maxRadialSegs = 26){
  return mergeGeometries(branches.map(br => tubeGeometry(br, maxRadialSegs)));
}
