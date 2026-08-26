// Skeleton grower: trunk -> scaffolds -> recursive branches -> aerial prop roots
// -> surface-root flare, plus weighted leaf anchor slots.
// EVERY placement decision draws from the shared rng stream in a fixed order --
// do not reorder, add, or remove rr()/rand() calls (determinism guardrail).
import * as THREE from 'three';
import { rr, rand, fbm } from './rng.js';

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

export function arcTable(pts){ const c=[0]; for(let i=1;i<pts.length;i++) c.push(c[i-1]+pts[i].distanceTo(pts[i-1])); return c; }

/* Grow the whole skeleton from spec S. Returns
   { branches, anchors, trunkPts, trunkRadii, scaffoldIds, propRootIds }
   branch = { id, parent, depth, kind, pts[], radii[], gnarl, lobes|null } */
export function growSkeleton(S){
  const branches = [];
  const anchors = [];          // weighted leaf anchor slots {p, t, id}
  let trunkPts = [], trunkRadii = [];
  const scaffoldIds = [], propRootIds = [];

  /* habit field (TreeSpec/v1 habit.form): the y-surface the steer term seeks.
     'dome' (default, also 'bottle') is the original banyan gaussian -- numerically
     identical when habit.form is absent. 'pads' modulates the dome by azimuth
     lobes (niwaki plateaus); 'cascade' subtracts a radial drop so the field goes
     BELOW the branch mid-growth and the steer term flips sign (weeping habits);
     'cone' is a linear falloff for excurrent-ish silhouettes. */
  const F = S.habit.field, FORM = S.habit.form || 'dome';
  let domeY;
  if (FORM === 'pads'){
    const K = S.habit.pads || {};
    const pl = K.lobes ?? 5, pa = K.amp ?? 0.3, pp = K.phase ?? 0.7;
    domeY = (r, az)=> F.base + F.amp*Math.exp(-(r*r)/F.falloff) * (1 - pa + pa*Math.pow(0.5+0.5*Math.cos(az*pl + pp), 1.4));
  } else if (FORM === 'cascade'){
    const K = S.habit.cascade || {};
    const rise = K.riseRadius ?? 0.5, drop = K.drop ?? 1.8, reach = K.reach ?? 2.4;
    domeY = (r)=> F.base + F.amp*Math.exp(-(r*r)/F.falloff) - drop*THREE.MathUtils.smoothstep(r, rise, reach);
  } else if (FORM === 'cone'){
    domeY = (r)=> F.base + F.amp*Math.max(0, 1 - r/F.falloff);
  } else {
    domeY = (r)=> F.base + F.amp*Math.exp(-(r*r)/F.falloff);
  }
  const CLAMP_Y = S.habit.clampY ?? 0.5;   // steer clamp; cascade habits widen it
  function registerBranch(br){ br.id = branches.length; branches.push(br); return br.id; }

  function addLeafAnchors(br){
    const A = S.foliage.anchor;
    const cum = arcTable(br.pts), total = cum[cum.length-1];
    if (total < 0.04) return;
    const step = A.step;
    for(let s = total*A.startFrac; s < total; s += step*rr(A.jitter[0], A.jitter[1])){
      // locate segment
      let i=1; while(i<cum.length-1 && cum[i]<s) i++;
      const f = (s-cum[i-1])/Math.max(1e-6, cum[i]-cum[i-1]);
      const p = br.pts[i-1].clone().lerp(br.pts[i], f);
      const r = lerp(br.radii[i-1], br.radii[i], f);
      if (r > A.maxTwigRadius) continue;
      const t = br.pts[i].clone().sub(br.pts[i-1]).normalize();
      const tt = s/total;
      const w = 1 + Math.round(A.tipWeight*tt*tt) + (tt>A.tipThresh ? A.tipBonus : 0);
      for(let k=0;k<w;k++) anchors.push({ p, t, id: br.id });
    }
  }

  function growBranch(o){
    // o: {start, dir, len, r0, r1, depth, parent, wig, steer, kind, gnarl, lobes}
    const R = S.recursion;
    const steps = clamp(Math.round(o.len/0.11), 4, 16);
    const ds = o.len/steps;
    const pts = [o.start.clone()];
    const dir = o.dir.clone().normalize();
    const seed = branches.length*3.77 + 11.3;
    for(let i=1;i<=steps;i++){
      const p = pts[i-1];
      const nx = fbm(p.x*1.7+seed, p.y*1.7,     p.z*1.7,      3)-0.5;
      const ny = fbm(p.x*1.7+9.1,  p.y*1.7+seed, p.z*1.7,     3)-0.5;
      const nz = fbm(p.x*1.7,      p.y*1.7+4.7, p.z*1.7+seed, 3)-0.5;
      dir.addScaledVector(new THREE.Vector3(nx,ny,nz), o.wig*2.2);
      if(o.steer > 0){
        const r = Math.hypot(p.x, p.z);
        dir.y += clamp(domeY(r, Math.atan2(p.z, p.x)) + (o.domeOff||0) - p.y, -CLAMP_Y, CLAMP_Y) * S.habit.steer * o.steer;
        if (r > 0.05) dir.addScaledVector(new THREE.Vector3(p.x/r, 0, p.z/r), S.habit.outward*o.steer);
      }
      dir.normalize();
      pts.push(p.clone().addScaledVector(dir, ds));
    }
    const radii = pts.map((_,i)=> lerp(o.r0, o.r1, Math.pow(i/steps, 0.85)));
    // pointed tip
    pts.push(pts[steps].clone().addScaledVector(dir, Math.max(0.015, o.r1*1.5)));
    radii.push(0.0008);

    const br = { parent:o.parent, depth:o.depth, kind:o.kind||'branch', pts, radii,
                 gnarl:o.gnarl ?? R.gnarlByDepth[o.depth], lobes:o.lobes||null };
    const id = registerBranch(br);
    if (o.depth >= 2) addLeafAnchors(br);

    // -------- children --------
    if (o.depth >= 1 && o.depth < R.maxDepth && o.r1 > R.minRadius){
      const cum = arcTable(pts), total = cum[steps];
      const childDepth = o.depth + 1;
      const spacing = R.spacing[o.depth];
      const lenTab = R.lenByDepth[childDepth];
      let phi = rr(0, Math.PI*2);
      // side branches
      for(let s = total*rr(0.28,0.4); s < total*0.92; s += spacing*rr(0.8,1.3)){
        let i=1; while(i<steps && cum[i]<s) i++;
        const f = (s-cum[i-1])/Math.max(1e-6, cum[i]-cum[i-1]);
        const p = pts[i-1].clone().lerp(pts[i], f);
        const rHere = lerp(radii[i-1], radii[i], f);
        const T = pts[i].clone().sub(pts[i-1]).normalize();
        const up = Math.abs(T.y)>0.92 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
        const N = up.clone().addScaledVector(T, -up.dot(T)).normalize();
        const B = new THREE.Vector3().crossVectors(T, N);
        phi += Math.PI + rr(-0.9, 0.9);
        const cd = T.clone().multiplyScalar(0.55)
          .addScaledVector(N, Math.cos(phi)*0.9)
          .addScaledVector(B, Math.sin(phi)*0.9)
          .add(new THREE.Vector3(0, R.upBias, 0)).normalize();
        const cr0 = Math.min(rHere*rr(R.childRadius[0],R.childRadius[1]), rHere*0.85);
        if (cr0 < R.minRadius) continue;
        growBranch({ start: p.clone().addScaledVector(cd, -rHere*0.4),
                     dir: cd, len: rr(lenTab[0], lenTab[1]), r0: cr0,
                     r1: childDepth===R.maxDepth ? 0.0045 : cr0*rr(0.28,0.4),
                     depth: childDepth, parent: id, domeOff: (o.domeOff||0)+rr(-0.04,0.04),
                     wig: R.wig[childDepth],
                     steer: R.steer[childDepth] });
      }
      // terminal fork
      const endT = pts[steps].clone().sub(pts[steps-1]).normalize();
      const perp = new THREE.Vector3(rr(-1,1), rr(-0.3,0.3), rr(-1,1)).cross(endT);
      if (perp.lengthSq() < 1e-4) perp.set(1,0,0);
      perp.normalize();
      const endR = o.r1;
      for(const sgn of [1,-1]){
        const a = sgn * rr(0.28, 0.6);
        const cd = endT.clone().applyAxisAngle(perp, a).normalize();
        const cr0 = endR*rr(0.7, 0.85);
        if (cr0 < 0.005) continue;
        growBranch({ start: pts[steps].clone().addScaledVector(cd, -endR*0.3),
                     dir: cd, len: rr(lenTab[0], lenTab[1])*rr(0.85,1.1), r0: cr0,
                     r1: childDepth===R.maxDepth ? 0.0045 : cr0*rr(0.28,0.4),
                     depth: childDepth, parent: id, domeOff: (o.domeOff||0)+rr(-0.04,0.04),
                     wig: R.wig[childDepth],
                     steer: R.steer[childDepth] });
      }
    }

    // -------- pendant strands (TreeSpec/v1 `strands`, weeping habits) --------
    // Long, thin, gravity-following chains hanging from the outer branches.
    // GATED on S.strands: absent (banyan and all non-weeping species) this
    // consumes NO rng draws, so existing streams are untouched.
    const ST = S.strands;
    if (ST && br.kind === 'branch' && o.depth === (ST.fromDepth ?? R.maxDepth)){
      const nS = Math.round(rr(ST.perTip[0], ST.perTip[1]));
      const cum2 = arcTable(pts), total2 = cum2[cum2.length-1];
      for(let k=0;k<nS;k++){
        const s = total2 * rr(0.35, 1.0);
        let i2=1; while(i2<cum2.length-1 && cum2[i2]<s) i2++;
        const f2 = (s-cum2[i2-1])/Math.max(1e-6, cum2[i2]-cum2[i2-1]);
        const start = pts[i2-1].clone().lerp(pts[i2], f2);
        const Tv = pts[i2].clone().sub(pts[i2-1]).normalize();
        const len = rr(ST.len[0], ST.len[1]);
        const d = Tv.clone().multiplyScalar(0.45)
          .add(new THREE.Vector3(rr(-0.3,0.3), -0.35, rr(-0.3,0.3))).normalize();
        const stepsS = clamp(Math.round(len/0.07), 5, 18);
        const dsS = len/stepsS;
        const sway = ST.sway ?? 0.10, grav = ST.gravity ?? 0.45;
        const sp = [start.clone()];
        const seedS = branches.length*3.77 + 6.1;
        for(let j=1;j<=stepsS;j++){
          const p2 = sp[j-1];
          d.x += (fbm(p2.x*2.3+seedS, p2.y*2.3, p2.z*2.3, 3)-0.5)*sway;
          d.z += (fbm(p2.x*2.3, p2.y*2.3+seedS, p2.z*2.3+3.3, 3)-0.5)*sway;
          d.y -= grav*0.22;
          d.normalize();
          const nxt = p2.clone().addScaledVector(d, dsS);
          if (nxt.y < 0.06) break;                 // never plunge into the ground
          sp.push(nxt);
        }
        if (sp.length < 3) continue;
        const r0S = ST.r0 ?? 0.007;
        const rS = sp.map((_,j)=> lerp(r0S, 0.0016, j/(sp.length-1)));
        const sbr = { parent:id, depth:o.depth+1, kind:'strand', pts:sp, radii:rS,
                      gnarl:ST.gnarl ?? 0.05, lobes:null };
        registerBranch(sbr);
        addLeafAnchors(sbr);
      }
    }
    return id;
  }

  function trunkPointAt(t){
    const i = clamp(Math.floor(t*12), 0, 11);
    const f = t*12 - i;
    return { p: trunkPts[i].clone().lerp(trunkPts[i+1], f), r: lerp(trunkRadii[i], trunkRadii[i+1], f) };
  }

  /* ---------- trunk ---------- */
  const leanAz = rr(0, Math.PI*2);
  const lean = new THREE.Vector3(Math.cos(leanAz), 0, Math.sin(leanAz)).multiplyScalar(S.trunk.lean);
  const TRUNK_H = S.trunk.height, TRUNK_R0 = S.trunk.r0, TRUNK_R1 = S.trunk.r1;
  {
    const stepsT = 12;
    for(let i=0;i<=stepsT;i++){
      const t = i/stepsT;
      const wx = (fbm(t*2.5+3.1, 7.7, 1.2, 3)-0.5)*S.trunk.wobble;
      const wz = (fbm(1.9, t*2.5+5.3, 8.8, 3)-0.5)*S.trunk.wobble;
      trunkPts.push(new THREE.Vector3(lean.x*t*t + wx*t, -0.03 + (TRUNK_H+0.03)*t, lean.z*t*t + wz*t));
      trunkRadii.push(lerp(TRUNK_R0, TRUNK_R1, Math.pow(t, S.trunk.radiusPow)));
    }
  }
  const trunk = { parent:-1, depth:0, kind:'trunk', pts:trunkPts, radii:trunkRadii, gnarl:S.trunk.gnarl,
    lobes:{ count:S.trunk.lobes.count, phase:rr(0,Math.PI*2), base:S.trunk.lobes.base, amp:S.trunk.lobes.amp,
            sharp:S.trunk.lobes.sharp, span:S.trunk.lobes.span, mode:S.trunk.lobes.mode } };
  const trunkId = registerBranch(trunk);

  /* ---------- scaffolds (major limbs) ----------
     TreeSpec/v1 `scaffolds{}`: counts / trunk attach points / elevation / length
     / radius-fraction / domeOff ranges. Every default below is the original
     banyan literal, and with the defaults the rng draw order is byte-identical
     to the pre-species code (verify/run.mjs guards this). */
  const GOLD = Math.PI*(3-Math.sqrt(5));
  {
    const SC = S.scaffolds || {};
    const nLow = SC.low ?? 1, nUpper = SC.upper ?? 5, nApex = SC.apex ?? 3;
    const elevR = SC.elevation || [0.30, 0.55];
    const lowLen = SC.lowLen ?? 1.25, upperLen = SC.upperLen || [1.25, 1.7], apexLen = SC.apexLen || [0.45, 0.7];
    const lowAt = SC.lowAt ?? 0.6, upperAt = SC.upperAt || [0.8, 1.0];
    const lowY = SC.lowElev ?? 0.28;
    const lowR0 = SC.lowR0 || [0.42, 0.5], upperR0 = SC.upperR0 || [0.5, 0.62], apexR0 = SC.apexR0 || [0.42, 0.5];
    const lowDome = SC.lowDomeOff || [-0.3, -0.15], upperDome = SC.upperDomeOff || [-0.12, 0.15], apexDome = SC.apexDomeOff || [0.0, 0.1];
    // low aged limb(s) -- az0 is ALWAYS drawn (upper azimuths build on it)
    const az0 = rr(0, Math.PI*2);
    for(let i=0;i<nLow;i++){
      const az = i === 0 ? az0 : az0 + 2.3*i + rr(-0.3, 0.3);
      const at = trunkPointAt(lowAt);
      const d0 = new THREE.Vector3(Math.cos(az), lowY, Math.sin(az)).normalize();
      scaffoldIds.push(growBranch({ start: at.p.clone().addScaledVector(d0,-at.r*0.35), dir: d0,
        len: lowLen, r0: at.r*rr(lowR0[0],lowR0[1]), r1: 0.028, depth: 1, parent: trunkId, wig: 0.10, steer: 0.8, domeOff: rr(lowDome[0],lowDome[1]) }));
    }
    // upper scaffolds
    for(let i=0;i<nUpper;i++){
      const az = az0 + GOLD*(i+1) + rr(-0.35, 0.35);
      const at2 = trunkPointAt(rr(upperAt[0], upperAt[1]));
      const elev = rr(elevR[0], elevR[1]);
      const d = new THREE.Vector3(Math.cos(az)*Math.cos(elev), Math.sin(elev), Math.sin(az)*Math.cos(elev)).normalize();
      scaffoldIds.push(growBranch({ start: at2.p.clone().addScaledVector(d,-at2.r*0.35), dir: d,
        len: rr(upperLen[0], upperLen[1]), r0: at2.r*rr(upperR0[0],upperR0[1]), r1: 0.03, depth: 1, parent: trunkId, wig: 0.10, steer: 1.0, domeOff: rr(upperDome[0],upperDome[1]) }));
    }
    // apex stubs (crown fill)
    for(let i=0;i<nApex;i++){
      const az = rr(0, Math.PI*2);
      const d = new THREE.Vector3(Math.cos(az)*0.4, 1, Math.sin(az)*0.4).normalize();
      const at3 = trunkPointAt(1.0);
      scaffoldIds.push(growBranch({ start: at3.p.clone().addScaledVector(d,-at3.r*0.3), dir: d,
        len: rr(apexLen[0], apexLen[1]), r0: at3.r*rr(apexR0[0],apexR0[1]), r1: 0.025, depth: 1, parent: trunkId, wig: 0.1, steer: 1.0, domeOff: rr(apexDome[0],apexDome[1]) }));
    }
  }

  /* ---------- aerial prop roots (banyan signature) ----------
     `propRoots: null` (most species) skips the block entirely; count 0 with the
     block present keeps the original draw behavior. */
  const PR = S.propRoots;
  if (PR) {
    const PROP_COUNT = PR.count;
    // candidates on scaffolds
    const cands = [];
    for(const sid of scaffoldIds){
      const br = branches[sid];
      const cum = arcTable(br.pts), total = cum[cum.length-1];
      for(let tf=0.4; tf<=0.85; tf+=0.15){
        const s = total*tf;
        let i=1; while(i<cum.length-1 && cum[i]<s) i++;
        const f = (s-cum[i-1])/Math.max(1e-6, cum[i]-cum[i-1]);
        const p = br.pts[i-1].clone().lerp(br.pts[i], f);
        const r = lerp(br.radii[i-1], br.radii[i], f);
        const rad = Math.hypot(p.x, p.z);
        if (p.y > PR.eligibility.minY && rad > PR.eligibility.minRad && rad < PR.eligibility.maxRad)
          cands.push({ p, limbR: r, az: Math.atan2(p.z, p.x), parent: sid });
      }
    }
    // greedy azimuth spread
    cands.sort(()=> rand()-0.5);
    const chosen = [];
    for(const minSep of PR.minAzimuthSep){
      for(const c of cands){
        if (chosen.length >= PROP_COUNT) break;
        if (chosen.includes(c)) continue;
        let ok = true;
        for(const q of chosen){
          let d = Math.abs(c.az - q.az); d = Math.min(d, Math.PI*2-d);
          if (d < minSep) { ok = false; break; }
        }
        if (ok) chosen.push(c);
      }
      if (chosen.length >= PROP_COUNT) break;
    }
    let thickLeft = PR.thick;
    for(const c of chosen){
      const isThick = thickLeft-- > 0;
      const topR = rr(PR.topR[0], PR.topR[1]);
      const botR = isThick ? rr(PR.thickR[0], PR.thickR[1]) : rr(PR.thinR[0], PR.thinR[1]);
      const drop = c.p.y;
      const steps2 = Math.max(8, Math.round(drop/0.12));
      const pts = [c.p.clone()];
      const radii = [Math.min(c.limbR*0.9, 0.055)];
      const seed = branches.length*3.77;
      const driftAz = rr(0, Math.PI*2), driftAmt = rr(-0.02, 0.12);
      for(let i=1;i<=steps2;i++){
        const t = i/steps2;
        const prev = pts[i-1];
        const sx = (fbm(prev.x*3+seed, t*4, prev.z*3, 3)-0.5)*0.08;
        const sz = (fbm(prev.x*3, t*4+seed, prev.z*3+2.2, 3)-0.5)*0.08;
        pts.push(new THREE.Vector3(
          c.p.x + Math.cos(driftAz)*driftAmt*t + sx*Math.sin(t*Math.PI),
          c.p.y * (1-t),
          c.p.z + Math.sin(driftAz)*driftAmt*t + sz*Math.sin(t*Math.PI)
        ));
        radii.push(lerp(topR, botR, THREE.MathUtils.smoothstep(t, 0.45, 0.95)));
      }
      pts.push(pts[steps2].clone().setY(-0.05)); radii.push(botR*0.9); // sink into ground
      const br = { parent:c.parent, depth:1, kind:'prop', pts, radii, gnarl:PR.gnarl,
        lobes:{ count:Math.floor(rr(4,7)), phase:rr(0,Math.PI*2), base:0.5, amp:0.55, sharp:2.2, span:0.16, mode:'end' } };
      propRootIds.push(registerBranch(br));
      // small feet
      const feet = PR.feet;
      for(let k=0;k<feet;k++){
        const fz = rr(0, Math.PI*2);
        const fd = new THREE.Vector3(Math.cos(fz), 0, Math.sin(fz));
        const fl = rr(0.12, 0.28);
        const fpts = [], fradii = [];
        const base = pts[steps2].clone().setY(botR*0.5);
        const fsteps = 4;
        for(let i2=0;i2<=fsteps;i2++){
          const t2 = i2/fsteps;
          fpts.push(base.clone().addScaledVector(fd, fl*t2).setY(Math.max(0.006, botR*0.5*(1-t2)*(1-t2))));
          fradii.push(lerp(botR*0.45, 0.004, Math.pow(t2, 0.7)));
        }
        registerBranch({ parent: branches.length-1, depth:2, kind:'root', pts:fpts, radii:fradii, gnarl:0.18, lobes:null });
      }
    }
  }

  /* ---------- surface roots at the base (root flare) ---------- */
  const SR = S.surfaceRoots;
  if (SR) {
    const N_ROOTS = SR.count;
    const az0 = rr(0, Math.PI*2);
    for(let i=0;i<N_ROOTS;i++){
      const az = az0 + (i/N_ROOTS)*Math.PI*2 + rr(-0.25, 0.25);
      const dirH = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const len = rr(SR.length[0], SR.length[1]);
      const r0 = rr(SR.r0[0], SR.r0[1]);
      const startH = rr(SR.startHeight[0], SR.startHeight[1]);
      const stepsR = 6;
      const pts = [], radii = [];
      const seed = branches.length*3.77;
      for(let k=0;k<=stepsR;k++){
        const t = k/stepsR;
        const meander = (fbm(t*3+seed, seed*0.3, t*2.7, 3)-0.5)*0.22*t;
        const perp = new THREE.Vector3(-dirH.z, 0, dirH.x);
        pts.push(new THREE.Vector3(0,0,0)
          .addScaledVector(dirH, 0.16 + len*t)
          .addScaledVector(perp, meander)
          .setY(Math.max(0.006, startH*Math.pow(1-t, 1.7))));
        radii.push(lerp(r0, 0.005, Math.pow(t, 0.75)));
      }
      registerBranch({ parent: trunkId, depth:1, kind:'root', pts, radii, gnarl:SR.gnarl, lobes:null });
    }
  }

  return { branches, anchors, trunkPts, trunkRadii, scaffoldIds, propRootIds };
}
