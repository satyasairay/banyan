// Leaves: sculpted ovate blade geometry + instancing from the skeleton's weighted
// anchors + the two-pass transform/color build. Pass-2 grading inputs are recorded
// so gradeLeafColors() can re-run the color pass ALONE (leaf re-grade, SS1.4 #4).
import * as THREE from 'three';
import { rr, rrOf, rand, ihash01 } from './rng.js';

const clamp = THREE.MathUtils.clamp;

/* Blade geometry. TreeSpec/v1 `foliage.blade` adds `outline`
   ('ovate'|'lobed'|'narrow'|'needle') plus keel/recurve/droop/lift sculpt
   params -- every default is the original banyan literal, so with no new
   fields the geometry is byte-identical. */
export function buildLeafGeometry(S){
  const Bl = S.foliage.blade;
  const L = Bl.length, outline = Bl.outline || 'ovate';
  const LSEG = outline === 'lobed' ? 14 : 8, WSEG = 5;
  const maxHW = L*Bl.widthRatio;
  const keel = Bl.keel ?? 0.34, recurve = Bl.recurve ?? 0.38;
  const droop = Bl.droop ?? 0.16, lift = Bl.lift ?? 0.03;
  const nLobes = Bl.lobes ?? 4;
  const halfWidth = (u)=>{
    if (outline === 'lobed'){            // oak: sinuate margin (rounded lobes)
      const env = Math.pow(Math.sin(Math.PI*Math.pow(u, 0.9)), 0.55);
      const sinu = 0.68 + 0.32*Math.pow(Math.abs(Math.sin(Math.PI*u*nLobes)), 0.8);
      return maxHW * env * sinu;
    }
    if (outline === 'narrow')            // willow: long lanceolate
      return maxHW * Math.pow(Math.sin(Math.PI*u), 0.45);
    if (outline === 'needle')            // linear taper (tuft needles)
      return maxHW * (1 - u*0.85);
    return maxHW * Math.pow(Math.sin(Math.PI*Math.pow(u, 0.78)), 0.72);  // ovate (banyan)
  };
  const pos=[], uv=[], idx=[];
  for(let iu=0; iu<=LSEG; iu++){
    const u = iu/LSEG;
    const hw = halfWidth(u);
    for(let iv=0; iv<=WSEG; iv++){
      const v01 = iv/WSEG;
      const v = v01*2 - 1;         // -1..1 across
      const av = Math.abs(v);
      const x = u*L;
      const z = v*hw;
      let y = 0;
      y += av*hw*keel;                                           // midrib keel (V crease)
      y -= THREE.MathUtils.smoothstep(av, 0.55, 1.0)*hw*recurve; // waxy edge recurve
      y -= u*u*L*droop;                                          // tip droop
      y += (1-u)*(1-u)*L*lift;                                   // slight lift at petiole
      pos.push(x, y, z);
      uv.push(u, v01);
    }
  }
  for(let iu=0; iu<LSEG; iu++) for(let iv=0; iv<WSEG; iv++){
    const a = iu*(WSEG+1)+iv, b = a+WSEG+1;
    idx.push(a, b, a+1,  b, b+1, a+1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Leaf re-grade (SS1.4 #4): re-run ONLY the color pass. Reads the current
   S.foliage.palette against the grading inputs recorded at build time. No rng,
   no skeleton, no geometry -- an instanceColor upload only. With an unchanged
   palette (and no adjust) this reproduces the build-time colors bit-for-bit.

   `adjust` (SceneSpec coupling #2, audit SS3.4): optional per-scene grade
   { hueShift, satMul, lightMul } applied AFTER the palette math -- this is how a
   night scene fixes the "fake GI baked for bright top-down light" problem without
   touching the skeleton or the rng. Default null = exact build-time colors. */
export function gradeLeafColors(S, mesh, grade, baseOut, adjust = null){
  const P = S.foliage.palette;
  const n = mesh.count;
  const col = new THREE.Color();
  for(let i=0;i<n;i++){
    const g = i*8;
    const sun = grade[g];
    let h = P.h + rrOf(grade[g+1], -P.hJitter, P.hJitter) - sun*P.sunHue;
    let s = rrOf(grade[g+2], P.s[0], P.s[1]);
    let l = P.lBase + sun*P.lSun + rrOf(grade[g+3], -P.lJitter, P.lJitter);
    if (grade[g+4] < P.senescent.rate){
      h = rrOf(grade[g+5], P.senescent.h[0], P.senescent.h[1]);
      s = rrOf(grade[g+6], P.senescent.s[0], P.senescent.s[1]);
      l = rrOf(grade[g+7], P.senescent.l[0], P.senescent.l[1]);
    }
    if (adjust){
      h += adjust.hueShift || 0;                       // Color.setHSL wraps hue
      s = clamp(s * (adjust.satMul ?? 1), 0, 1);
      l = clamp(l * (adjust.lightMul ?? 1), 0, 1);
    }
    col.setHSL(h, s, l, THREE.SRGBColorSpace);
    mesh.setColorAt(i, col);
    baseOut[i*3] = col.r; baseOut[i*3+1] = col.g; baseOut[i*3+2] = col.b;
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;   // null when count===0 (bare winter skeleton)
}

/* Needle tuft (TreeSpec/v1 foliage.system 'tufts', pine family): ONE tuft is a
   fan of 20-40 single-triangle needles built as one low-poly unit and instanced
   at anchors -- keeps instance counts sane vs per-needle (audit SS2.2). All
   irregularity comes from the stream-free integer hash, so the geometry
   consumes NO rng draws (exactly like the blade). */
export function buildTuftGeometry(S){
  const Bl = S.foliage.blade, T = S.foliage.tuft || {};
  const L = Bl.length;
  const needles = T.needles ?? 28;
  const spread = T.spread ?? 1.15;                     // max polar angle of the fan
  const halfW = Math.max(0.0012, L*Bl.widthRatio*0.10); // needle half-width
  const GOLD = Math.PI*(3-Math.sqrt(5));
  const pos=[], uv=[], idx=[];
  for(let i=0;i<needles;i++){
    const az = i*GOLD + ihash01(i*7+1)*0.7;
    const pol = spread * (0.28 + 0.72*Math.sqrt(ihash01(i*7+2)));
    const len = L * (0.7 + 0.6*ihash01(i*7+3));
    const dir = new THREE.Vector3(Math.sin(pol)*Math.cos(az), Math.cos(pol), Math.sin(pol)*Math.sin(az));
    const tipY = -len*0.10*ihash01(i*7+4);             // slight outward droop
    const sx = -Math.sin(az)*halfW, sz = Math.cos(az)*halfW;
    const bx = dir.x*len*0.05, by = dir.y*len*0.05, bz = dir.z*len*0.05;
    const b = pos.length/3;
    pos.push(bx - sx, by, bz - sz);
    pos.push(bx + sx, by, bz + sz);
    pos.push(dir.x*len, dir.y*len + tipY, dir.z*len);
    uv.push(0.05, 0.2,  0.05, 0.8,  1.0, 0.5);
    idx.push(b, b+1, b+2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Instance the foliage from the current anchors. leafCap comes from the active
   quality preset (SS1.4 #5); 'high' passes Infinity so N = S.leafCount.
   foliage.system: 'blades' (default) instances the sculpted blade, 'tufts'
   instances the needle fan; the transform/color passes are IDENTICAL either
   way (same rng draws), only the instanced geometry differs. */
export function buildLeaves(S, anchors, material, leafCap = Infinity){
  const P = S.foliage.palette;
  const N = Math.min(S.leafCount, leafCap);
  const leafGeo = (S.foliage.system === 'tufts') ? buildTuftGeometry(S) : buildLeafGeometry(S);
  const leafMorph = new Float32Array(N*4);
  for(let i=0;i<N;i++){
    leafMorph[i*4]   = ihash01(i*11 + 1);  // length
    leafMorph[i*4+1] = ihash01(i*11 + 2);  // width
    leafMorph[i*4+2] = ihash01(i*11 + 3);  // curl/twist
    leafMorph[i*4+3] = ihash01(i*11 + 4);  // edge tone
  }
  leafGeo.setAttribute('aLeafMorph', new THREE.InstancedBufferAttribute(leafMorph, 4));
  const leaves = new THREE.InstancedMesh(leafGeo, material, N);
  leaves.castShadow = true;
  leaves.receiveShadow = true;

  const leafBranch = new Uint16Array(N);
  const leafBaseColor = new Float32Array(N*3);
  // per-leaf grading inputs: [sun, uH, uS, uL, uSen, uSenH, uSenS, uSenL] (Float64
  // so re-grades reproduce build-time colors bit-for-bit)
  const leafGrade = new Float64Array(N*8);
  {
    // pass 1: transforms
    const positions = [];
    const m = new THREE.Matrix4();
    const xA = new THREE.Vector3(), yA = new THREE.Vector3(), zA = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for(let i=0;i<N;i++){
      const a = anchors[Math.floor(rand()*anchors.length)];
      const t = a.t;
      const p1 = Math.abs(t.y)>0.92 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const n1 = p1.clone().addScaledVector(t, -p1.dot(t)).normalize();
      const b1 = new THREE.Vector3().crossVectors(t, n1);
      const ang = rr(0, Math.PI*2);
      const radial = n1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(b1, Math.sin(ang));
      const pos = a.p.clone()
        .addScaledVector(t, rr(-0.02, 0.05))
        .addScaledVector(radial, rr(0.006, 0.035));
      // blade direction: outward + drooping
      xA.copy(t).multiplyScalar(rr(0.35, 0.8)).addScaledVector(radial, rr(0.5, 1.0)).normalize();
      xA.y -= rr(0.05, 0.45); xA.normalize();
      const up = new THREE.Vector3(rr(-0.18,0.18), 1, rr(-0.18,0.18)).normalize();
      zA.crossVectors(xA, up);
      if (zA.lengthSq() < 1e-4) zA.set(1,0,0).cross(xA);
      zA.normalize();
      yA.crossVectors(zA, xA);
      const s = rr(S.foliage.scale[0], S.foliage.scale[1]);
      m.makeBasis(xA, yA, zA);
      sc.set(s,s,s);
      m.scale(sc);
      m.setPosition(pos);
      leaves.setMatrixAt(i, m);
      leafBranch[i] = a.id;
      positions.push(pos);
    }
    // pass 2: record grading inputs -- canopy-depth "sun" plus the per-leaf jitter
    // draws, consumed from the rng in EXACTLY the original order -- then grade.
    const centroid = new THREE.Vector3();
    positions.forEach(p=> centroid.add(p));
    centroid.divideScalar(N);
    let maxR = 0, minY = 1e9, maxY = -1e9;
    for(const p of positions){
      maxR = Math.max(maxR, Math.hypot(p.x-centroid.x, p.z-centroid.z));
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    for(let i=0;i<N;i++){
      const p = positions[i];
      const relR = clamp(Math.hypot(p.x-centroid.x, p.z-centroid.z)/maxR, 0, 1);
      const relY = clamp((p.y-minY)/(maxY-minY), 0, 1);
      const g = i*8;
      leafGrade[g]   = clamp(relR*0.6 + relY*0.5 + rrOf(rand(), -0.18, 0.18), 0, 1); // sun
      leafGrade[g+1] = rand();          // hue jitter
      leafGrade[g+2] = rand();          // saturation
      leafGrade[g+3] = rand();          // lightness jitter
      leafGrade[g+4] = rand();          // senescent gate
      if (leafGrade[g+4] < P.senescent.rate){ // senescent draws happen ONLY when senescent (stream identical to original)
        leafGrade[g+5] = rand(); leafGrade[g+6] = rand(); leafGrade[g+7] = rand();
      } else { // filler for a later re-grade that RAISES senescent.rate -- never rng-drawn
        leafGrade[g+5] = ihash01(i*3+1); leafGrade[g+6] = ihash01(i*3+2); leafGrade[g+7] = ihash01(i*3+3);
      }
    }
    gradeLeafColors(S, leaves, leafGrade, leafBaseColor);
  }
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor){                                        // null when count===0 (bare winter skeleton)
    leaves.instanceColor.needsUpdate = true;
    leaves.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  leaves.computeBoundingSphere();
  return { leaves, leafBranch, leafBaseColor, leafGrade };
}

/* ============================================================
   Blossom clusters (TreeSpec/v1 `blossom`, cherry family).
   Second instancer per the bougainvillea-fork precedent (audit SS2.2):
   one instance = a cluster of small five-petal flowers; per-instance
   color carries the pink range. Draws from the shared rng stream AFTER
   the leaf passes -- only species whose spec HAS `blossom` consume these
   draws, so every other stream is untouched.
   ============================================================ */
export function buildBlossomGeometry(S){
  const B = S.blossom;
  const size = B.size ?? 0.028;
  const cluster = B.clusterSize ?? 3, cr = B.clusterRadius ?? 0.02;
  const PET = 5;
  const pos=[], uv=[], idx=[];
  for(let ci=0; ci<cluster; ci++){
    const ca = ihash01(ci*13+1)*Math.PI*2, cp = Math.acos(2*ihash01(ci*13+2)-1);
    const center = new THREE.Vector3(
      Math.sin(cp)*Math.cos(ca), Math.cos(cp), Math.sin(cp)*Math.sin(ca)
    ).multiplyScalar(ci === 0 ? 0 : cr);
    const na = ihash01(ci*13+3)*Math.PI*2, np = ihash01(ci*13+4)*0.9;
    const n = new THREE.Vector3(Math.sin(np)*Math.cos(na), Math.cos(np), Math.sin(np)*Math.sin(na));
    const t1 = Math.abs(n.y) > 0.92 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
    const e1 = t1.clone().addScaledVector(n, -t1.dot(n)).normalize();
    const e2 = new THREE.Vector3().crossVectors(n, e1);
    const twist = ihash01(ci*13+5)*0.6;
    for(let p=0; p<PET; p++){
      const pa = (p/PET)*Math.PI*2 + twist;
      const dirP = e1.clone().multiplyScalar(Math.cos(pa)).addScaledVector(e2, Math.sin(pa));
      const side = e1.clone().multiplyScalar(-Math.sin(pa)).addScaledVector(e2, Math.cos(pa)).multiplyScalar(size*0.42);
      const mid = center.clone().addScaledVector(dirP, size*0.55).addScaledVector(n, size*0.42);
      const tip = center.clone().addScaledVector(dirP, size).addScaledVector(n, size*0.25);
      const b = pos.length/3;
      pos.push(center.x, center.y, center.z);
      pos.push(mid.x - side.x, mid.y - side.y, mid.z - side.z);
      pos.push(mid.x + side.x, mid.y + side.y, mid.z + side.z);
      pos.push(tip.x, tip.y, tip.z);
      uv.push(0,0.5,  0.5,0,  0.5,1,  1,0.5);
      idx.push(b, b+1, b+3,  b, b+3, b+2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildBlossoms(S, anchors, material, cap = Infinity){
  const B = S.blossom;
  if (!B || !B.count) return null;
  const N = Math.min(B.count, cap);
  const geo = buildBlossomGeometry(S);
  const mesh = new THREE.InstancedMesh(geo, material, N);
  mesh.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  const col = new THREE.Color();
  const P = B.palette;
  const sj = B.sizeJitter || [0.8, 1.3];
  for(let i=0;i<N;i++){
    const a = anchors[Math.floor(rand()*anchors.length)];
    const p = a.p.clone().addScaledVector(a.t, rr(-0.01, 0.03));
    p.x += rr(-0.014, 0.014); p.y += rr(-0.014, 0.014); p.z += rr(-0.014, 0.014);
    e.set(rr(0, Math.PI*2), rr(0, Math.PI*2), rr(0, Math.PI*2));
    q.setFromEuler(e);
    const s = rr(sj[0], sj[1]);
    m.compose(p, q, sc.set(s, s, s));
    mesh.setMatrixAt(i, m);
    col.setHSL(rr(P.h[0], P.h[1]) % 1, rr(P.s[0], P.s[1]), rr(P.l[0], P.l[1]), THREE.SRGBColorSpace);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
