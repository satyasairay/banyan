// src/rng.js
import { MathUtils } from "three";
var lerp = MathUtils.lerp;
function mulberry32(a) {
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var rng = mulberry32(1892);
var reseed = (seed) => {
  rng = mulberry32(seed);
};
var rand = () => rng();
var rr = (a, b) => a + (b - a) * rng();
var rrOf = (u, a, b) => a + (b - a) * u;
function ihash01(n) {
  n = Math.imul(n ^ n >>> 16, 73244475);
  n = Math.imul(n ^ n >>> 16, 73244475);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function hashN(x, y, z) {
  let h = Math.imul(x | 0, 668265261) ^ Math.imul(y | 0, 374761393) ^ Math.imul(z | 0, 2654435761);
  h = Math.imul(h ^ h >>> 15, 2246822507);
  h = Math.imul(h ^ h >>> 13, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf), sz = zf * zf * (3 - 2 * zf);
  const n000 = hashN(xi, yi, zi), n100 = hashN(xi + 1, yi, zi), n010 = hashN(xi, yi + 1, zi), n110 = hashN(xi + 1, yi + 1, zi), n001 = hashN(xi, yi, zi + 1), n101 = hashN(xi + 1, yi, zi + 1), n011 = hashN(xi, yi + 1, zi + 1), n111 = hashN(xi + 1, yi + 1, zi + 1);
  return lerp(
    lerp(lerp(n000, n100, sx), lerp(n010, n110, sx), sy),
    lerp(lerp(n001, n101, sx), lerp(n011, n111, sx), sy),
    sz
  );
}
function fbm(x, y, z, oct) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s / (1 - Math.pow(0.5, oct));
}

// src/skeleton.js
import * as THREE from "three";
var clamp = THREE.MathUtils.clamp;
var lerp2 = THREE.MathUtils.lerp;
function arcTable(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return c;
}
function growSkeleton(S) {
  const branches = [];
  const anchors = [];
  let trunkPts = [], trunkRadii = [];
  const scaffoldIds = [], propRootIds = [];
  const F = S.habit.field, FORM = S.habit.form || "dome";
  let domeY;
  if (FORM === "pads") {
    const K = S.habit.pads || {};
    const pl = K.lobes ?? 5, pa = K.amp ?? 0.3, pp = K.phase ?? 0.7;
    domeY = (r, az) => F.base + F.amp * Math.exp(-(r * r) / F.falloff) * (1 - pa + pa * Math.pow(0.5 + 0.5 * Math.cos(az * pl + pp), 1.4));
  } else if (FORM === "cascade") {
    const K = S.habit.cascade || {};
    const rise = K.riseRadius ?? 0.5, drop = K.drop ?? 1.8, reach = K.reach ?? 2.4;
    domeY = (r) => F.base + F.amp * Math.exp(-(r * r) / F.falloff) - drop * THREE.MathUtils.smoothstep(r, rise, reach);
  } else if (FORM === "cone") {
    domeY = (r) => F.base + F.amp * Math.max(0, 1 - r / F.falloff);
  } else {
    domeY = (r) => F.base + F.amp * Math.exp(-(r * r) / F.falloff);
  }
  const CLAMP_Y = S.habit.clampY ?? 0.5;
  function registerBranch(br) {
    br.id = branches.length;
    branches.push(br);
    return br.id;
  }
  function addLeafAnchors(br) {
    const A = S.foliage.anchor;
    const cum = arcTable(br.pts), total = cum[cum.length - 1];
    if (total < 0.04) return;
    const step = A.step;
    for (let s = total * A.startFrac; s < total; s += step * rr(A.jitter[0], A.jitter[1])) {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      const p = br.pts[i - 1].clone().lerp(br.pts[i], f);
      const r = lerp2(br.radii[i - 1], br.radii[i], f);
      if (r > A.maxTwigRadius) continue;
      const t = br.pts[i].clone().sub(br.pts[i - 1]).normalize();
      const tt = s / total;
      const w = 1 + Math.round(A.tipWeight * tt * tt) + (tt > A.tipThresh ? A.tipBonus : 0);
      for (let k = 0; k < w; k++) anchors.push({ p, t, id: br.id });
    }
  }
  function growBranch(o) {
    const R = S.recursion;
    const steps = clamp(Math.round(o.len / 0.11), 4, 16);
    const ds = o.len / steps;
    const pts = [o.start.clone()];
    const dir = o.dir.clone().normalize();
    const seed = branches.length * 3.77 + 11.3;
    for (let i = 1; i <= steps; i++) {
      const p = pts[i - 1];
      const nx = fbm(p.x * 1.7 + seed, p.y * 1.7, p.z * 1.7, 3) - 0.5;
      const ny = fbm(p.x * 1.7 + 9.1, p.y * 1.7 + seed, p.z * 1.7, 3) - 0.5;
      const nz = fbm(p.x * 1.7, p.y * 1.7 + 4.7, p.z * 1.7 + seed, 3) - 0.5;
      dir.addScaledVector(new THREE.Vector3(nx, ny, nz), o.wig * 2.2);
      if (o.steer > 0) {
        const r = Math.hypot(p.x, p.z);
        dir.y += clamp(domeY(r, Math.atan2(p.z, p.x)) + (o.domeOff || 0) - p.y, -CLAMP_Y, CLAMP_Y) * S.habit.steer * o.steer;
        if (r > 0.05) dir.addScaledVector(new THREE.Vector3(p.x / r, 0, p.z / r), S.habit.outward * o.steer);
      }
      dir.normalize();
      pts.push(p.clone().addScaledVector(dir, ds));
    }
    const radii = pts.map((_, i) => lerp2(o.r0, o.r1, Math.pow(i / steps, 0.85)));
    pts.push(pts[steps].clone().addScaledVector(dir, Math.max(0.015, o.r1 * 1.5)));
    radii.push(8e-4);
    const br = {
      parent: o.parent,
      depth: o.depth,
      kind: o.kind || "branch",
      pts,
      radii,
      gnarl: o.gnarl ?? R.gnarlByDepth[o.depth],
      lobes: o.lobes || null
    };
    const id = registerBranch(br);
    if (o.depth >= 2) addLeafAnchors(br);
    if (o.depth >= 1 && o.depth < R.maxDepth && o.r1 > R.minRadius) {
      const cum = arcTable(pts), total = cum[steps];
      const childDepth = o.depth + 1;
      const spacing = R.spacing[o.depth];
      const lenTab = R.lenByDepth[childDepth];
      let phi = rr(0, Math.PI * 2);
      for (let s = total * rr(0.28, 0.4); s < total * 0.92; s += spacing * rr(0.8, 1.3)) {
        let i = 1;
        while (i < steps && cum[i] < s) i++;
        const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
        const p = pts[i - 1].clone().lerp(pts[i], f);
        const rHere = lerp2(radii[i - 1], radii[i], f);
        const T = pts[i].clone().sub(pts[i - 1]).normalize();
        const up = Math.abs(T.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const N = up.clone().addScaledVector(T, -up.dot(T)).normalize();
        const B = new THREE.Vector3().crossVectors(T, N);
        phi += Math.PI + rr(-0.9, 0.9);
        const cd = T.clone().multiplyScalar(0.55).addScaledVector(N, Math.cos(phi) * 0.9).addScaledVector(B, Math.sin(phi) * 0.9).add(new THREE.Vector3(0, R.upBias, 0)).normalize();
        const cr0 = Math.min(rHere * rr(R.childRadius[0], R.childRadius[1]), rHere * 0.85);
        if (cr0 < R.minRadius) continue;
        growBranch({
          start: p.clone().addScaledVector(cd, -rHere * 0.4),
          dir: cd,
          len: rr(lenTab[0], lenTab[1]),
          r0: cr0,
          r1: childDepth === R.maxDepth ? 45e-4 : cr0 * rr(0.28, 0.4),
          depth: childDepth,
          parent: id,
          domeOff: (o.domeOff || 0) + rr(-0.04, 0.04),
          wig: R.wig[childDepth],
          steer: R.steer[childDepth]
        });
      }
      const endT = pts[steps].clone().sub(pts[steps - 1]).normalize();
      const perp = new THREE.Vector3(rr(-1, 1), rr(-0.3, 0.3), rr(-1, 1)).cross(endT);
      if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0);
      perp.normalize();
      const endR = o.r1;
      for (const sgn of [1, -1]) {
        const a = sgn * rr(0.28, 0.6);
        const cd = endT.clone().applyAxisAngle(perp, a).normalize();
        const cr0 = endR * rr(0.7, 0.85);
        if (cr0 < 5e-3) continue;
        growBranch({
          start: pts[steps].clone().addScaledVector(cd, -endR * 0.3),
          dir: cd,
          len: rr(lenTab[0], lenTab[1]) * rr(0.85, 1.1),
          r0: cr0,
          r1: childDepth === R.maxDepth ? 45e-4 : cr0 * rr(0.28, 0.4),
          depth: childDepth,
          parent: id,
          domeOff: (o.domeOff || 0) + rr(-0.04, 0.04),
          wig: R.wig[childDepth],
          steer: R.steer[childDepth]
        });
      }
    }
    const ST = S.strands;
    if (ST && br.kind === "branch" && o.depth === (ST.fromDepth ?? R.maxDepth)) {
      const nS = Math.round(rr(ST.perTip[0], ST.perTip[1]));
      const cum2 = arcTable(pts), total2 = cum2[cum2.length - 1];
      for (let k = 0; k < nS; k++) {
        const s = total2 * rr(0.35, 1);
        let i2 = 1;
        while (i2 < cum2.length - 1 && cum2[i2] < s) i2++;
        const f2 = (s - cum2[i2 - 1]) / Math.max(1e-6, cum2[i2] - cum2[i2 - 1]);
        const start = pts[i2 - 1].clone().lerp(pts[i2], f2);
        const Tv = pts[i2].clone().sub(pts[i2 - 1]).normalize();
        const len = rr(ST.len[0], ST.len[1]);
        const d = Tv.clone().multiplyScalar(0.45).add(new THREE.Vector3(rr(-0.3, 0.3), -0.35, rr(-0.3, 0.3))).normalize();
        const stepsS = clamp(Math.round(len / 0.07), 5, 18);
        const dsS = len / stepsS;
        const sway = ST.sway ?? 0.1, grav = ST.gravity ?? 0.45;
        const sp = [start.clone()];
        const seedS = branches.length * 3.77 + 6.1;
        for (let j = 1; j <= stepsS; j++) {
          const p2 = sp[j - 1];
          d.x += (fbm(p2.x * 2.3 + seedS, p2.y * 2.3, p2.z * 2.3, 3) - 0.5) * sway;
          d.z += (fbm(p2.x * 2.3, p2.y * 2.3 + seedS, p2.z * 2.3 + 3.3, 3) - 0.5) * sway;
          d.y -= grav * 0.22;
          d.normalize();
          const nxt = p2.clone().addScaledVector(d, dsS);
          if (nxt.y < 0.06) break;
          sp.push(nxt);
        }
        if (sp.length < 3) continue;
        const r0S = ST.r0 ?? 7e-3;
        const rS = sp.map((_, j) => lerp2(r0S, 16e-4, j / (sp.length - 1)));
        const sbr = {
          parent: id,
          depth: o.depth + 1,
          kind: "strand",
          pts: sp,
          radii: rS,
          gnarl: ST.gnarl ?? 0.05,
          lobes: null
        };
        registerBranch(sbr);
        addLeafAnchors(sbr);
      }
    }
    return id;
  }
  function trunkPointAt(t) {
    const i = clamp(Math.floor(t * 12), 0, 11);
    const f = t * 12 - i;
    return { p: trunkPts[i].clone().lerp(trunkPts[i + 1], f), r: lerp2(trunkRadii[i], trunkRadii[i + 1], f) };
  }
  const leanAz = rr(0, Math.PI * 2);
  const lean = new THREE.Vector3(Math.cos(leanAz), 0, Math.sin(leanAz)).multiplyScalar(S.trunk.lean);
  const TRUNK_H = S.trunk.height, TRUNK_R0 = S.trunk.r0, TRUNK_R1 = S.trunk.r1;
  {
    const stepsT = 12;
    for (let i = 0; i <= stepsT; i++) {
      const t = i / stepsT;
      const wx = (fbm(t * 2.5 + 3.1, 7.7, 1.2, 3) - 0.5) * S.trunk.wobble;
      const wz = (fbm(1.9, t * 2.5 + 5.3, 8.8, 3) - 0.5) * S.trunk.wobble;
      trunkPts.push(new THREE.Vector3(lean.x * t * t + wx * t, -0.03 + (TRUNK_H + 0.03) * t, lean.z * t * t + wz * t));
      trunkRadii.push(lerp2(TRUNK_R0, TRUNK_R1, Math.pow(t, S.trunk.radiusPow)));
    }
  }
  const trunk = {
    parent: -1,
    depth: 0,
    kind: "trunk",
    pts: trunkPts,
    radii: trunkRadii,
    gnarl: S.trunk.gnarl,
    lobes: {
      count: S.trunk.lobes.count,
      phase: rr(0, Math.PI * 2),
      base: S.trunk.lobes.base,
      amp: S.trunk.lobes.amp,
      sharp: S.trunk.lobes.sharp,
      span: S.trunk.lobes.span,
      mode: S.trunk.lobes.mode
    }
  };
  const trunkId = registerBranch(trunk);
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  {
    const SC = S.scaffolds || {};
    const nLow = SC.low ?? 1, nUpper = SC.upper ?? 5, nApex = SC.apex ?? 3;
    const elevR = SC.elevation || [0.3, 0.55];
    const lowLen = SC.lowLen ?? 1.25, upperLen = SC.upperLen || [1.25, 1.7], apexLen = SC.apexLen || [0.45, 0.7];
    const lowAt = SC.lowAt ?? 0.6, upperAt = SC.upperAt || [0.8, 1];
    const lowY = SC.lowElev ?? 0.28;
    const lowR0 = SC.lowR0 || [0.42, 0.5], upperR0 = SC.upperR0 || [0.5, 0.62], apexR0 = SC.apexR0 || [0.42, 0.5];
    const lowDome = SC.lowDomeOff || [-0.3, -0.15], upperDome = SC.upperDomeOff || [-0.12, 0.15], apexDome = SC.apexDomeOff || [0, 0.1];
    const az0 = rr(0, Math.PI * 2);
    for (let i = 0; i < nLow; i++) {
      const az = i === 0 ? az0 : az0 + 2.3 * i + rr(-0.3, 0.3);
      const at = trunkPointAt(lowAt);
      const d0 = new THREE.Vector3(Math.cos(az), lowY, Math.sin(az)).normalize();
      scaffoldIds.push(growBranch({
        start: at.p.clone().addScaledVector(d0, -at.r * 0.35),
        dir: d0,
        len: lowLen,
        r0: at.r * rr(lowR0[0], lowR0[1]),
        r1: 0.028,
        depth: 1,
        parent: trunkId,
        wig: 0.1,
        steer: 0.8,
        domeOff: rr(lowDome[0], lowDome[1])
      }));
    }
    for (let i = 0; i < nUpper; i++) {
      const az = az0 + GOLD * (i + 1) + rr(-0.35, 0.35);
      const at2 = trunkPointAt(rr(upperAt[0], upperAt[1]));
      const elev = rr(elevR[0], elevR[1]);
      const d = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
      scaffoldIds.push(growBranch({
        start: at2.p.clone().addScaledVector(d, -at2.r * 0.35),
        dir: d,
        len: rr(upperLen[0], upperLen[1]),
        r0: at2.r * rr(upperR0[0], upperR0[1]),
        r1: 0.03,
        depth: 1,
        parent: trunkId,
        wig: 0.1,
        steer: 1,
        domeOff: rr(upperDome[0], upperDome[1])
      }));
    }
    for (let i = 0; i < nApex; i++) {
      const az = rr(0, Math.PI * 2);
      const d = new THREE.Vector3(Math.cos(az) * 0.4, 1, Math.sin(az) * 0.4).normalize();
      const at3 = trunkPointAt(1);
      scaffoldIds.push(growBranch({
        start: at3.p.clone().addScaledVector(d, -at3.r * 0.3),
        dir: d,
        len: rr(apexLen[0], apexLen[1]),
        r0: at3.r * rr(apexR0[0], apexR0[1]),
        r1: 0.025,
        depth: 1,
        parent: trunkId,
        wig: 0.1,
        steer: 1,
        domeOff: rr(apexDome[0], apexDome[1])
      }));
    }
  }
  const PR = S.propRoots;
  if (PR) {
    const PROP_COUNT = PR.count;
    const cands = [];
    for (const sid of scaffoldIds) {
      const br = branches[sid];
      const cum = arcTable(br.pts), total = cum[cum.length - 1];
      for (let tf = 0.4; tf <= 0.85; tf += 0.15) {
        const s = total * tf;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
        const p = br.pts[i - 1].clone().lerp(br.pts[i], f);
        const r = lerp2(br.radii[i - 1], br.radii[i], f);
        const rad = Math.hypot(p.x, p.z);
        if (p.y > PR.eligibility.minY && rad > PR.eligibility.minRad && rad < PR.eligibility.maxRad)
          cands.push({ p, limbR: r, az: Math.atan2(p.z, p.x), parent: sid });
      }
    }
    cands.sort(() => rand() - 0.5);
    const chosen = [];
    for (const minSep of PR.minAzimuthSep) {
      for (const c of cands) {
        if (chosen.length >= PROP_COUNT) break;
        if (chosen.includes(c)) continue;
        let ok = true;
        for (const q of chosen) {
          let d = Math.abs(c.az - q.az);
          d = Math.min(d, Math.PI * 2 - d);
          if (d < minSep) {
            ok = false;
            break;
          }
        }
        if (ok) chosen.push(c);
      }
      if (chosen.length >= PROP_COUNT) break;
    }
    let thickLeft = PR.thick;
    for (const c of chosen) {
      const isThick = thickLeft-- > 0;
      const topR = rr(PR.topR[0], PR.topR[1]);
      const botR = isThick ? rr(PR.thickR[0], PR.thickR[1]) : rr(PR.thinR[0], PR.thinR[1]);
      const drop = c.p.y;
      const steps2 = Math.max(8, Math.round(drop / 0.12));
      const pts = [c.p.clone()];
      const radii = [Math.min(c.limbR * 0.9, 0.055)];
      const seed = branches.length * 3.77;
      const driftAz = rr(0, Math.PI * 2), driftAmt = rr(-0.02, 0.12);
      for (let i = 1; i <= steps2; i++) {
        const t = i / steps2;
        const prev = pts[i - 1];
        const sx = (fbm(prev.x * 3 + seed, t * 4, prev.z * 3, 3) - 0.5) * 0.08;
        const sz = (fbm(prev.x * 3, t * 4 + seed, prev.z * 3 + 2.2, 3) - 0.5) * 0.08;
        pts.push(new THREE.Vector3(
          c.p.x + Math.cos(driftAz) * driftAmt * t + sx * Math.sin(t * Math.PI),
          c.p.y * (1 - t),
          c.p.z + Math.sin(driftAz) * driftAmt * t + sz * Math.sin(t * Math.PI)
        ));
        radii.push(lerp2(topR, botR, THREE.MathUtils.smoothstep(t, 0.45, 0.95)));
      }
      pts.push(pts[steps2].clone().setY(-0.05));
      radii.push(botR * 0.9);
      const br = {
        parent: c.parent,
        depth: 1,
        kind: "prop",
        pts,
        radii,
        gnarl: PR.gnarl,
        lobes: { count: Math.floor(rr(4, 7)), phase: rr(0, Math.PI * 2), base: 0.5, amp: 0.55, sharp: 2.2, span: 0.16, mode: "end" }
      };
      propRootIds.push(registerBranch(br));
      const feet = PR.feet;
      for (let k = 0; k < feet; k++) {
        const fz = rr(0, Math.PI * 2);
        const fd = new THREE.Vector3(Math.cos(fz), 0, Math.sin(fz));
        const fl = rr(0.12, 0.28);
        const fpts = [], fradii = [];
        const base = pts[steps2].clone().setY(botR * 0.5);
        const fsteps = 4;
        for (let i2 = 0; i2 <= fsteps; i2++) {
          const t2 = i2 / fsteps;
          fpts.push(base.clone().addScaledVector(fd, fl * t2).setY(Math.max(6e-3, botR * 0.5 * (1 - t2) * (1 - t2))));
          fradii.push(lerp2(botR * 0.45, 4e-3, Math.pow(t2, 0.7)));
        }
        registerBranch({ parent: branches.length - 1, depth: 2, kind: "root", pts: fpts, radii: fradii, gnarl: 0.18, lobes: null });
      }
    }
  }
  const SR = S.surfaceRoots;
  if (SR) {
    const N_ROOTS = SR.count;
    const az0 = rr(0, Math.PI * 2);
    for (let i = 0; i < N_ROOTS; i++) {
      const az = az0 + i / N_ROOTS * Math.PI * 2 + rr(-0.25, 0.25);
      const dirH = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const len = rr(SR.length[0], SR.length[1]);
      const r0 = rr(SR.r0[0], SR.r0[1]);
      const startH = rr(SR.startHeight[0], SR.startHeight[1]);
      const stepsR = 6;
      const pts = [], radii = [];
      const seed = branches.length * 3.77;
      for (let k = 0; k <= stepsR; k++) {
        const t = k / stepsR;
        const meander = (fbm(t * 3 + seed, seed * 0.3, t * 2.7, 3) - 0.5) * 0.22 * t;
        const perp = new THREE.Vector3(-dirH.z, 0, dirH.x);
        pts.push(new THREE.Vector3(0, 0, 0).addScaledVector(dirH, 0.16 + len * t).addScaledVector(perp, meander).setY(Math.max(6e-3, startH * Math.pow(1 - t, 1.7))));
        radii.push(lerp2(r0, 5e-3, Math.pow(t, 0.75)));
      }
      registerBranch({ parent: trunkId, depth: 1, kind: "root", pts, radii, gnarl: SR.gnarl, lobes: null });
    }
  }
  return { branches, anchors, trunkPts, trunkRadii, scaffoldIds, propRootIds };
}

// src/mesher.js
import * as THREE2 from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
var clamp2 = THREE2.MathUtils.clamp;
var lerp3 = THREE2.MathUtils.lerp;
var smoothstep = THREE2.MathUtils.smoothstep;
function computeFrames(pts) {
  const n = pts.length, T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(new THREE2.Vector3().subVectors(b, a).normalize());
  }
  const up = Math.abs(T[0].y) > 0.92 ? new THREE2.Vector3(1, 0, 0) : new THREE2.Vector3(0, 1, 0);
  let N0 = up.clone().addScaledVector(T[0], -up.dot(T[0])).normalize();
  N.push(N0);
  B.push(new THREE2.Vector3().crossVectors(T[0], N0).normalize());
  const q = new THREE2.Quaternion();
  for (let i = 1; i < n; i++) {
    q.setFromUnitVectors(T[i - 1], T[i]);
    const Ni = N[i - 1].clone().applyQuaternion(q);
    Ni.addScaledVector(T[i], -Ni.dot(T[i])).normalize();
    N.push(Ni);
    B.push(new THREE2.Vector3().crossVectors(T[i], Ni).normalize());
  }
  return { T, N, B };
}
function flareAt(br, pts, i, cum, total) {
  const lob = br.lobes;
  if (!lob) return 0;
  if (lob.mode === "ground") return Math.pow(Math.max(0, 1 - pts[i].y / lob.span), 1.6);
  return Math.pow(Math.max(0, 1 - (total - cum[i]) / lob.span), 1.6);
}
function tubeGeometry(br, maxRadialSegs = 26) {
  let pts = br.pts, radii = br.radii;
  if (br.kind === "root" || br.kind === "prop") {
    const tipFloor = br.kind === "root" ? 0.016 : 0.02;
    radii = radii.map((r) => Math.max(r, tipFloor));
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const dir = last.clone().sub(prev).normalize();
    pts = pts.concat([last.clone().addScaledVector(dir, tipFloor * 0.9)]);
    radii = radii.concat([tipFloor * 0.35]);
  }
  if (br.kind === "trunk") {
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const dir = last.clone().sub(prev).normalize();
    const r = radii[radii.length - 1];
    pts = pts.concat([
      last.clone().addScaledVector(dir, r * 0.45),
      last.clone().addScaledVector(dir, r * 0.8),
      last.clone().addScaledVector(dir, r * 1)
    ]);
    radii = radii.concat([r * 0.62, r * 0.3, 8e-3]);
  }
  const n = pts.length;
  const { T, N, B } = computeFrames(pts);
  const maxR = Math.max(...radii);
  const segs = Math.min(maxRadialSegs, maxR > 0.16 ? 26 : maxR > 0.08 ? 16 : maxR > 0.035 ? 11 : maxR > 0.016 ? 8 : 6);
  const cum = arcTable(pts), total = cum[n - 1];
  const collarAmt = br.kind === "branch" ? 0.85 : 0;
  const collarSpan = total * 0.25;
  const rootLike = br.kind === "root" || br.kind === "prop";
  const posA = [], norA = [], uvA = [], colA = [], idx = [];
  const rad = new THREE2.Vector3(), nrm = new THREE2.Vector3();
  for (let i = 0; i < n; i++) {
    const iP = Math.max(0, i - 1), iN = Math.min(n - 1, i + 1);
    const slope = (radii[iP] - radii[iN]) / Math.max(1e-5, cum[iN] - cum[iP]);
    const f = flareAt(br, pts, i, cum, total);
    let collarMul = 1, collarAo = 1;
    if (collarAmt > 0 && collarSpan > 1e-5) {
      const tc = clamp2(cum[i] / collarSpan, 0, 1);
      const swell = collarAmt * (1 - tc) * (1 - tc);
      collarMul = 1 + swell;
      collarAo = 1 - swell * 0.55;
    }
    for (let j = 0; j <= segs; j++) {
      const th = j / segs * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th);
      rad.set(0, 0, 0).addScaledVector(N[i], cs).addScaledVector(B[i], sn);
      let mul = 1, ao = 1;
      if (br.lobes && f > 1e-4) {
        const w = Math.pow(0.5 + 0.5 * Math.sin(th * br.lobes.count + br.lobes.phase), br.lobes.sharp);
        mul = 1 + f * (br.lobes.base + br.lobes.amp * w);
        ao = 1 - f * (1 - w) * 0.42;
      }
      let g = 1 + br.gnarl * (fbm(cs * 1.3 + br.id * 0.719, cum[i] * 2.4, sn * 1.3 - br.id * 0.377, 3) - 0.5) * 2;
      g = Math.max(0.62, g);
      let rootMul = 1, rootAo = 1, horizSpread = 1, vertSquash = 1;
      if (rootLike && total > 1e-5) {
        const startCollar = Math.pow(1 - clamp2(cum[i] / Math.min(0.18, total), 0, 1), 2);
        const groundBlend = Math.pow(1 - smoothstep(0.01, 0.18, pts[i].y), 1.4);
        const endBlend = Math.pow(clamp2(cum[i] / total, 0, 1), 2);
        const rootCollar = (br.kind === "prop" ? startCollar * 0.18 : startCollar * 0.32) + groundBlend * endBlend * 0.16;
        rootMul += rootCollar;
        rootAo -= Math.min(0.24, rootCollar * 0.34 + groundBlend * 0.06);
        horizSpread += groundBlend * endBlend * 0.12;
        vertSquash -= groundBlend * endBlend * 0.08;
      }
      const Rr = Math.max(6e-4, radii[i] * mul * g * collarMul * rootMul);
      let px = pts[i].x + rad.x * Rr * horizSpread;
      let py = pts[i].y + rad.y * Rr * vertSquash;
      let pz = pts[i].z + rad.z * Rr * horizSpread;
      if (rootLike && pts[i].y < 0.035 && rad.y < -0.35) py = Math.max(-4e-3, py);
      posA.push(px, py, pz);
      nrm.copy(rad).addScaledVector(T[i], slope).normalize();
      norA.push(nrm.x, nrm.y, nrm.z);
      uvA.push(j / segs, cum[i] * 1.6);
      const gAo = ao * collarAo * rootAo * clamp2(0.72 + pts[i].y * 1.8, 0.72, 1);
      colA.push(gAo, gAo, gAo);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE2.BufferGeometry();
  geo.setAttribute("position", new THREE2.Float32BufferAttribute(posA, 3));
  geo.setAttribute("normal", new THREE2.Float32BufferAttribute(norA, 3));
  geo.setAttribute("uv", new THREE2.Float32BufferAttribute(uvA, 2));
  geo.setAttribute("color", new THREE2.Float32BufferAttribute(colA, 3));
  geo.setIndex(idx);
  return geo;
}
function buildWoodGeometry(branches, maxRadialSegs = 26) {
  return mergeGeometries(branches.map((br) => tubeGeometry(br, maxRadialSegs)));
}

// src/materials.js
import * as THREE3 from "three";
function makeBarkMaterial(S) {
  const Bk = S.bark;
  const smooth = Bk.style === "smooth";
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
  const mat = new THREE3.MeshStandardMaterial({
    color: 16777215,
    roughness: 0.87,
    metalness: 0,
    vertexColors: true,
    envMapIntensity: 0.25
  });
  mat.userData.barkVisualDetail = { macro: 0, cracks: 0, knots: 0, relief: 0 };
  mat.onBeforeCompile = (sh) => {
    const detail = mat.userData.barkVisualDetail || {};
    sh.uniforms.uBumpAmt = { value: Bk.bump };
    sh.uniforms.uStria = { value: Bk.striaScale };
    sh.uniforms.uMottle = { value: Bk.mottleScale };
    sh.uniforms.uCrevice = { value: new THREE3.Vector3(Bk.crevice[0], Bk.crevice[1], Bk.crevice[2]) };
    sh.uniforms.uRidge = { value: new THREE3.Vector3(Bk.ridge[0], Bk.ridge[1], Bk.ridge[2]) };
    sh.uniforms.uBarkMacro = { value: detail.macro ?? 0 };
    sh.uniforms.uBarkCrack = { value: detail.cracks ?? 0 };
    sh.uniforms.uBarkKnot = { value: detail.knots ?? 0 };
    sh.uniforms.uBarkRelief = { value: detail.relief ?? 0 };
    if (smooth) {
      const lc = Bk.lenticel || [0.42, 0.36, 0.33];
      sh.uniforms.uLentic = { value: new THREE3.Vector3(lc[0], lc[1], lc[2]) };
    }
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;\nvarying vec2 vBUv;").replace("#include <project_vertex>", "#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBUv = uv;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
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
${BARKH_GLSL}`).replace("#include <map_fragment>", `#include <map_fragment>
${MAP_GLSL}`).replace("#include <roughnessmap_fragment>", smooth ? `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - (gBarkH-0.5)*0.3 - lenticels()*0.1, 0.35, 1.0);` : `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - (gBarkH-0.5)*0.18, 0.55, 1.0);`).replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
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
function restyleBark(mat, S) {
  const sh = mat && mat.userData.shader;
  if (!sh) return false;
  sh.uniforms.uBumpAmt.value = S.bark.bump;
  sh.uniforms.uStria.value = S.bark.striaScale;
  sh.uniforms.uMottle.value = S.bark.mottleScale;
  sh.uniforms.uCrevice.value.set(S.bark.crevice[0], S.bark.crevice[1], S.bark.crevice[2]);
  sh.uniforms.uRidge.value.set(S.bark.ridge[0], S.bark.ridge[1], S.bark.ridge[2]);
  if (sh.uniforms.uLentic && S.bark.lenticel)
    sh.uniforms.uLentic.value.set(S.bark.lenticel[0], S.bark.lenticel[1], S.bark.lenticel[2]);
  return true;
}
function setBarkVisualDetail(mat, detail = {}) {
  if (!mat) return false;
  const next = {
    macro: detail.macro ?? 0,
    cracks: detail.cracks ?? 0,
    knots: detail.knots ?? 0,
    relief: detail.relief ?? 0
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
function makeLeafMaterial() {
  const leafMat = new THREE3.MeshPhysicalMaterial({
    color: 16777215,
    roughness: 0.46,
    metalness: 0,
    side: THREE3.DoubleSide,
    clearcoat: 0.25,
    clearcoatRoughness: 0.32,
    sheen: 0.15,
    sheenColor: new THREE3.Color(9416294),
    sheenRoughness: 0.6,
    envMapIntensity: 0.25
  });
  leafMat.userData.leafVisualDetail = { variation: 0, edge: 1, vein: 1, subsurface: 1 };
  leafMat.onBeforeCompile = (sh) => {
    const detail = leafMat.userData.leafVisualDetail || {};
    sh.uniforms.uSunView = { value: new THREE3.Vector3(0, 1, 0) };
    sh.uniforms.uSunColor = { value: new THREE3.Color(16773602).multiplyScalar(0.16) };
    sh.uniforms.uLeafVar = { value: detail.variation ?? 0 };
    sh.uniforms.uLeafEdge = { value: detail.edge ?? 1 };
    sh.uniforms.uLeafVein = { value: detail.vein ?? 1 };
    sh.uniforms.uLeafSubsurface = { value: detail.subsurface ?? 1 };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
attribute vec4 aLeafMorph;
varying vec2 vLUv;
varying vec4 vLeafMorph;
uniform float uLeafVar;`).replace("#include <uv_vertex>", "#include <uv_vertex>\nvLUv = uv;").replace("#include <begin_vertex>", `#include <begin_vertex>
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
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec2 vLUv;
varying vec4 vLeafMorph;
uniform vec3 uSunView;
uniform vec3 uSunColor;
uniform float uLeafVar;
uniform float uLeafEdge;
uniform float uLeafVein;
uniform float uLeafSubsurface;`).replace("#include <color_fragment>", `#include <color_fragment>
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
}`).replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + uLeafVar*(smoothstep(0.36, 0.50, abs(vLUv.y - 0.5))*0.09 - 0.04), 0.30, 1.0);
if (!gl_FrontFacing) roughnessFactor = min(1.0, roughnessFactor + 0.32);`).replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
{
  float backlit = clamp(-dot(normal, uSunView), 0.0, 1.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * uLeafSubsurface * pow(backlit, 1.6);
}`);
    leafMat.userData.shader = sh;
  };
  return leafMat;
}
function setLeafVisualDetail(mat, detail = {}) {
  if (!mat) return false;
  const next = {
    variation: detail.variation ?? 0,
    edge: detail.edge ?? 1,
    vein: detail.vein ?? 1,
    subsurface: detail.subsurface ?? 1
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
function makeBlossomMaterial() {
  return new THREE3.MeshPhysicalMaterial({
    color: 16777215,
    roughness: 0.55,
    metalness: 0,
    side: THREE3.DoubleSide,
    sheen: 0.4,
    sheenColor: new THREE3.Color(16766950),
    sheenRoughness: 0.5,
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.25
  });
}

// src/leaves.js
import * as THREE4 from "three";
var clamp3 = THREE4.MathUtils.clamp;
function buildLeafGeometry(S) {
  const Bl = S.foliage.blade;
  const L = Bl.length, outline = Bl.outline || "ovate";
  const LSEG = outline === "lobed" ? 14 : 8, WSEG = 5;
  const maxHW = L * Bl.widthRatio;
  const keel = Bl.keel ?? 0.34, recurve = Bl.recurve ?? 0.38;
  const droop = Bl.droop ?? 0.16, lift = Bl.lift ?? 0.03;
  const nLobes = Bl.lobes ?? 4;
  const halfWidth = (u) => {
    if (outline === "lobed") {
      const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.9)), 0.55);
      const sinu = 0.68 + 0.32 * Math.pow(Math.abs(Math.sin(Math.PI * u * nLobes)), 0.8);
      return maxHW * env * sinu;
    }
    if (outline === "narrow")
      return maxHW * Math.pow(Math.sin(Math.PI * u), 0.45);
    if (outline === "needle")
      return maxHW * (1 - u * 0.85);
    return maxHW * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.78)), 0.72);
  };
  const pos = [], uv = [], idx = [];
  for (let iu = 0; iu <= LSEG; iu++) {
    const u = iu / LSEG;
    const hw = halfWidth(u);
    for (let iv = 0; iv <= WSEG; iv++) {
      const v01 = iv / WSEG;
      const v = v01 * 2 - 1;
      const av = Math.abs(v);
      const x = u * L;
      const z = v * hw;
      let y = 0;
      y += av * hw * keel;
      y -= THREE4.MathUtils.smoothstep(av, 0.55, 1) * hw * recurve;
      y -= u * u * L * droop;
      y += (1 - u) * (1 - u) * L * lift;
      pos.push(x, y, z);
      uv.push(u, v01);
    }
  }
  for (let iu = 0; iu < LSEG; iu++) for (let iv = 0; iv < WSEG; iv++) {
    const a = iu * (WSEG + 1) + iv, b = a + WSEG + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE4.BufferGeometry();
  g.setAttribute("position", new THREE4.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE4.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function gradeLeafColors(S, mesh, grade, baseOut, adjust = null) {
  const P = S.foliage.palette;
  const n = mesh.count;
  const col = new THREE4.Color();
  for (let i = 0; i < n; i++) {
    const g = i * 8;
    const sun = grade[g];
    let h = P.h + rrOf(grade[g + 1], -P.hJitter, P.hJitter) - sun * P.sunHue;
    let s = rrOf(grade[g + 2], P.s[0], P.s[1]);
    let l = P.lBase + sun * P.lSun + rrOf(grade[g + 3], -P.lJitter, P.lJitter);
    if (grade[g + 4] < P.senescent.rate) {
      h = rrOf(grade[g + 5], P.senescent.h[0], P.senescent.h[1]);
      s = rrOf(grade[g + 6], P.senescent.s[0], P.senescent.s[1]);
      l = rrOf(grade[g + 7], P.senescent.l[0], P.senescent.l[1]);
    }
    if (adjust) {
      h += adjust.hueShift || 0;
      s = clamp3(s * (adjust.satMul ?? 1), 0, 1);
      l = clamp3(l * (adjust.lightMul ?? 1), 0, 1);
    }
    col.setHSL(h, s, l, THREE4.SRGBColorSpace);
    mesh.setColorAt(i, col);
    baseOut[i * 3] = col.r;
    baseOut[i * 3 + 1] = col.g;
    baseOut[i * 3 + 2] = col.b;
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
function buildTuftGeometry(S) {
  const Bl = S.foliage.blade, T = S.foliage.tuft || {};
  const L = Bl.length;
  const needles = T.needles ?? 28;
  const spread = T.spread ?? 1.15;
  const halfW = Math.max(12e-4, L * Bl.widthRatio * 0.1);
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < needles; i++) {
    const az = i * GOLD + ihash01(i * 7 + 1) * 0.7;
    const pol = spread * (0.28 + 0.72 * Math.sqrt(ihash01(i * 7 + 2)));
    const len = L * (0.7 + 0.6 * ihash01(i * 7 + 3));
    const dir = new THREE4.Vector3(Math.sin(pol) * Math.cos(az), Math.cos(pol), Math.sin(pol) * Math.sin(az));
    const tipY = -len * 0.1 * ihash01(i * 7 + 4);
    const sx = -Math.sin(az) * halfW, sz = Math.cos(az) * halfW;
    const bx = dir.x * len * 0.05, by = dir.y * len * 0.05, bz = dir.z * len * 0.05;
    const b = pos.length / 3;
    pos.push(bx - sx, by, bz - sz);
    pos.push(bx + sx, by, bz + sz);
    pos.push(dir.x * len, dir.y * len + tipY, dir.z * len);
    uv.push(0.05, 0.2, 0.05, 0.8, 1, 0.5);
    idx.push(b, b + 1, b + 2);
  }
  const g = new THREE4.BufferGeometry();
  g.setAttribute("position", new THREE4.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE4.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function buildLeaves(S, anchors, material, leafCap = Infinity) {
  const P = S.foliage.palette;
  const N = Math.min(S.leafCount, leafCap);
  const leafGeo = S.foliage.system === "tufts" ? buildTuftGeometry(S) : buildLeafGeometry(S);
  const leafMorph = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    leafMorph[i * 4] = ihash01(i * 11 + 1);
    leafMorph[i * 4 + 1] = ihash01(i * 11 + 2);
    leafMorph[i * 4 + 2] = ihash01(i * 11 + 3);
    leafMorph[i * 4 + 3] = ihash01(i * 11 + 4);
  }
  leafGeo.setAttribute("aLeafMorph", new THREE4.InstancedBufferAttribute(leafMorph, 4));
  const leaves = new THREE4.InstancedMesh(leafGeo, material, N);
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  const leafBranch = new Uint16Array(N);
  const leafBaseColor = new Float32Array(N * 3);
  const leafGrade = new Float64Array(N * 8);
  {
    const positions = [];
    const m = new THREE4.Matrix4();
    const xA = new THREE4.Vector3(), yA = new THREE4.Vector3(), zA = new THREE4.Vector3();
    const sc = new THREE4.Vector3();
    for (let i = 0; i < N; i++) {
      const a = anchors[Math.floor(rand() * anchors.length)];
      const t = a.t;
      const p1 = Math.abs(t.y) > 0.92 ? new THREE4.Vector3(1, 0, 0) : new THREE4.Vector3(0, 1, 0);
      const n1 = p1.clone().addScaledVector(t, -p1.dot(t)).normalize();
      const b1 = new THREE4.Vector3().crossVectors(t, n1);
      const ang = rr(0, Math.PI * 2);
      const radial = n1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(b1, Math.sin(ang));
      const pos = a.p.clone().addScaledVector(t, rr(-0.02, 0.05)).addScaledVector(radial, rr(6e-3, 0.035));
      xA.copy(t).multiplyScalar(rr(0.35, 0.8)).addScaledVector(radial, rr(0.5, 1)).normalize();
      xA.y -= rr(0.05, 0.45);
      xA.normalize();
      const up = new THREE4.Vector3(rr(-0.18, 0.18), 1, rr(-0.18, 0.18)).normalize();
      zA.crossVectors(xA, up);
      if (zA.lengthSq() < 1e-4) zA.set(1, 0, 0).cross(xA);
      zA.normalize();
      yA.crossVectors(zA, xA);
      const s = rr(S.foliage.scale[0], S.foliage.scale[1]);
      m.makeBasis(xA, yA, zA);
      sc.set(s, s, s);
      m.scale(sc);
      m.setPosition(pos);
      leaves.setMatrixAt(i, m);
      leafBranch[i] = a.id;
      positions.push(pos);
    }
    const centroid = new THREE4.Vector3();
    positions.forEach((p) => centroid.add(p));
    centroid.divideScalar(N);
    let maxR = 0, minY = 1e9, maxY = -1e9;
    for (const p of positions) {
      maxR = Math.max(maxR, Math.hypot(p.x - centroid.x, p.z - centroid.z));
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    for (let i = 0; i < N; i++) {
      const p = positions[i];
      const relR = clamp3(Math.hypot(p.x - centroid.x, p.z - centroid.z) / maxR, 0, 1);
      const relY = clamp3((p.y - minY) / (maxY - minY), 0, 1);
      const g = i * 8;
      leafGrade[g] = clamp3(relR * 0.6 + relY * 0.5 + rrOf(rand(), -0.18, 0.18), 0, 1);
      leafGrade[g + 1] = rand();
      leafGrade[g + 2] = rand();
      leafGrade[g + 3] = rand();
      leafGrade[g + 4] = rand();
      if (leafGrade[g + 4] < P.senescent.rate) {
        leafGrade[g + 5] = rand();
        leafGrade[g + 6] = rand();
        leafGrade[g + 7] = rand();
      } else {
        leafGrade[g + 5] = ihash01(i * 3 + 1);
        leafGrade[g + 6] = ihash01(i * 3 + 2);
        leafGrade[g + 7] = ihash01(i * 3 + 3);
      }
    }
    gradeLeafColors(S, leaves, leafGrade, leafBaseColor);
  }
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) {
    leaves.instanceColor.needsUpdate = true;
    leaves.instanceColor.setUsage(THREE4.DynamicDrawUsage);
  }
  leaves.computeBoundingSphere();
  return { leaves, leafBranch, leafBaseColor, leafGrade };
}
function buildBlossomGeometry(S) {
  const B = S.blossom;
  const size = B.size ?? 0.028;
  const cluster = B.clusterSize ?? 3, cr = B.clusterRadius ?? 0.02;
  const PET = 5;
  const pos = [], uv = [], idx = [];
  for (let ci = 0; ci < cluster; ci++) {
    const ca = ihash01(ci * 13 + 1) * Math.PI * 2, cp = Math.acos(2 * ihash01(ci * 13 + 2) - 1);
    const center = new THREE4.Vector3(
      Math.sin(cp) * Math.cos(ca),
      Math.cos(cp),
      Math.sin(cp) * Math.sin(ca)
    ).multiplyScalar(ci === 0 ? 0 : cr);
    const na = ihash01(ci * 13 + 3) * Math.PI * 2, np = ihash01(ci * 13 + 4) * 0.9;
    const n = new THREE4.Vector3(Math.sin(np) * Math.cos(na), Math.cos(np), Math.sin(np) * Math.sin(na));
    const t1 = Math.abs(n.y) > 0.92 ? new THREE4.Vector3(1, 0, 0) : new THREE4.Vector3(0, 1, 0);
    const e1 = t1.clone().addScaledVector(n, -t1.dot(n)).normalize();
    const e2 = new THREE4.Vector3().crossVectors(n, e1);
    const twist = ihash01(ci * 13 + 5) * 0.6;
    for (let p = 0; p < PET; p++) {
      const pa = p / PET * Math.PI * 2 + twist;
      const dirP = e1.clone().multiplyScalar(Math.cos(pa)).addScaledVector(e2, Math.sin(pa));
      const side = e1.clone().multiplyScalar(-Math.sin(pa)).addScaledVector(e2, Math.cos(pa)).multiplyScalar(size * 0.42);
      const mid = center.clone().addScaledVector(dirP, size * 0.55).addScaledVector(n, size * 0.42);
      const tip = center.clone().addScaledVector(dirP, size).addScaledVector(n, size * 0.25);
      const b = pos.length / 3;
      pos.push(center.x, center.y, center.z);
      pos.push(mid.x - side.x, mid.y - side.y, mid.z - side.z);
      pos.push(mid.x + side.x, mid.y + side.y, mid.z + side.z);
      pos.push(tip.x, tip.y, tip.z);
      uv.push(0, 0.5, 0.5, 0, 0.5, 1, 1, 0.5);
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
  }
  const g = new THREE4.BufferGeometry();
  g.setAttribute("position", new THREE4.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE4.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function buildBlossoms(S, anchors, material, cap = Infinity) {
  const B = S.blossom;
  if (!B || !B.count) return null;
  const N = Math.min(B.count, cap);
  const geo = buildBlossomGeometry(S);
  const mesh = new THREE4.InstancedMesh(geo, material, N);
  mesh.castShadow = true;
  const m = new THREE4.Matrix4(), q = new THREE4.Quaternion(), e = new THREE4.Euler(), sc = new THREE4.Vector3();
  const col = new THREE4.Color();
  const P = B.palette;
  const sj = B.sizeJitter || [0.8, 1.3];
  for (let i = 0; i < N; i++) {
    const a = anchors[Math.floor(rand() * anchors.length)];
    const p = a.p.clone().addScaledVector(a.t, rr(-0.01, 0.03));
    p.x += rr(-0.014, 0.014);
    p.y += rr(-0.014, 0.014);
    p.z += rr(-0.014, 0.014);
    e.set(rr(0, Math.PI * 2), rr(0, Math.PI * 2), rr(0, Math.PI * 2));
    q.setFromEuler(e);
    const s = rr(sj[0], sj[1]);
    m.compose(p, q, sc.set(s, s, s));
    mesh.setMatrixAt(i, m);
    col.setHSL(rr(P.h[0], P.h[1]) % 1, rr(P.s[0], P.s[1]), rr(P.l[0], P.l[1]), THREE4.SRGBColorSpace);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// src/picking.js
import * as THREE5 from "three";
function setupPicking({ renderer, camera, hud, getState }) {
  const raycaster = new THREE5.Raycaster();
  const pointerNdc = new THREE5.Vector2();
  let pointerDirty = false;
  let hovering = false;
  const pulses = [];
  const HI = new THREE5.Color(2.5, 2.25, 0.75);
  function setPointer(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = (e.clientX - rect.left) / rect.width * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }
  function pickLeaf() {
    const { leaves } = getState();
    if (!leaves) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(leaves, false);
    return hits.length ? hits[0] : null;
  }
  renderer.domElement.addEventListener("pointermove", (e) => {
    setPointer(e);
    pointerDirty = true;
  });
  let downX = 0, downY = 0, downT = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downT = performance.now();
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved > 6 || performance.now() - downT > 450) return;
    setPointer(e);
    const hit = pickLeaf();
    if (!hit || hit.instanceId === void 0) return;
    const { leaves, leafBranch, branches } = getState();
    const id = hit.instanceId;
    const m = new THREE5.Matrix4();
    leaves.getMatrixAt(id, m);
    const p = new THREE5.Vector3().setFromMatrixPosition(m).applyMatrix4(leaves.matrixWorld);
    const bid = leafBranch[id];
    const br = branches[bid];
    hud.innerHTML = `LEAF   #${id}
world  (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})
branch B${bid} <span class="dim">&middot; depth ${br.depth} &middot; parent B${br.parent}</span>`;
    console.log(`[banyan] leaf #${id} | world (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) | branch B${bid}`);
    const existing = pulses.find((q) => q.id === id);
    if (existing) existing.start = performance.now();
    else pulses.push({ id, start: performance.now() });
  });
  const tmpCol = new THREE5.Color(), baseCol = new THREE5.Color();
  function updatePulses(now) {
    const { leaves, leafBaseColor } = getState();
    if (!pulses.length || !leaves) return;
    let write = false;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const q = pulses[i];
      const e = (now - q.start) / 600;
      baseCol.setRGB(leafBaseColor[q.id * 3], leafBaseColor[q.id * 3 + 1], leafBaseColor[q.id * 3 + 2]);
      if (e >= 1) {
        leaves.setColorAt(q.id, baseCol);
        pulses.splice(i, 1);
      } else {
        const s = Math.sin(Math.min(e, 1) * Math.PI);
        tmpCol.copy(baseCol).lerp(HI, s * 0.92);
        leaves.setColorAt(q.id, tmpCol);
      }
      write = true;
    }
    if (write) leaves.instanceColor.needsUpdate = true;
  }
  function updateHover() {
    if (!pointerDirty) return;
    pointerDirty = false;
    const hit = pickLeaf();
    const h = !!hit;
    if (h !== hovering) {
      hovering = h;
      renderer.domElement.style.cursor = h ? "pointer" : "";
    }
  }
  return { pulses, updatePulses, updateHover };
}

// src/quality.js
var QUALITY = {
  high: { leafCap: Infinity, shadowMapSize: 2048, maxRadialSegs: 26, pixelRatioCap: 2 },
  mobile: { leafCap: 3400, shadowMapSize: 512, maxRadialSegs: 14, pixelRatioCap: 1.5 }
};
function quality(S) {
  const q = S.quality && S.quality !== "auto" ? S.quality : typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 760 ? "mobile" : "high";
  return QUALITY[q] || QUALITY.high;
}

// src/export.js
import * as THREE6 from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries as mergeGeometries2 } from "three/addons/utils/BufferGeometryUtils.js";
function bakeInstances(inst, colorBoost = 1) {
  const src = inst.geometry;
  const vertsPer = src.getAttribute("position").count;
  const m = new THREE6.Matrix4();
  const col = new THREE6.Color();
  const parts = [];
  for (let i = 0; i < inst.count; i++) {
    inst.getMatrixAt(i, m);
    const g = src.clone().applyMatrix4(m);
    if (inst.instanceColor) {
      col.fromBufferAttribute(inst.instanceColor, i);
      col.r = Math.min(1, col.r * colorBoost);
      col.g = Math.min(1, col.g * colorBoost);
      col.b = Math.min(1, col.b * colorBoost);
    } else col.set(1, 1, 1);
    const colors = new Float32Array(vertsPer * 3);
    for (let v = 0; v < vertsPer; v++) {
      colors[v * 3] = col.r;
      colors[v * 3 + 1] = col.g;
      colors[v * 3 + 2] = col.b;
    }
    g.setAttribute("color", new THREE6.BufferAttribute(colors, 3));
    parts.push(g);
  }
  const merged = mergeGeometries2(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}
function buildExportGroup({ woodGeometry, leaves, blossoms, spec, leafColorBoost = 1.35 }) {
  const group = new THREE6.Group();
  group.name = `banyan-seed-${spec.seed}`;
  const bark = spec.bark;
  const woodMat = new THREE6.MeshStandardMaterial({
    name: "bark-vertexcolor",
    color: new THREE6.Color(bark.ridge[0], bark.ridge[1], bark.ridge[2]),
    vertexColors: true,
    roughness: 0.87,
    metalness: 0
  });
  const wood = new THREE6.Mesh(woodGeometry.clone(), woodMat);
  wood.name = "wood";
  group.add(wood);
  if (leaves && leaves.count > 0) {
    const leafMesh = new THREE6.Mesh(bakeInstances(leaves, leafColorBoost), new THREE6.MeshStandardMaterial({
      name: "leaf-vertexcolor",
      color: 16777215,
      vertexColors: true,
      roughness: 0.5,
      metalness: 0,
      side: THREE6.DoubleSide
    }));
    leafMesh.name = "leaves";
    group.add(leafMesh);
  }
  if (blossoms && blossoms.count > 0) {
    const blossomMesh = new THREE6.Mesh(bakeInstances(blossoms, 1), new THREE6.MeshStandardMaterial({
      name: "blossom-vertexcolor",
      color: 16777215,
      vertexColors: true,
      roughness: 0.6,
      metalness: 0,
      side: THREE6.DoubleSide
    }));
    blossomMesh.name = "blossoms";
    group.add(blossomMesh);
  }
  return group;
}
function exportGLB({ woodGeometry, leaves, blossoms, spec, leafColorBoost }) {
  const group = buildExportGroup({ woodGeometry, leaves, blossoms, spec, leafColorBoost });
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      group,
      (result) => resolve(result),
      // ArrayBuffer when binary:true
      (err) => reject(err),
      { binary: true }
    );
  });
}

// src/scenes.js
import * as THREE7 from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// scenes/white-studio.scenespec.json
var white_studio_scenespec_default = {
  $schema: "scenespec/v1",
  id: "white-studio",
  name: "White Studio",
  seed: 1,
  background: { type: "color", value: "#ffffff" },
  ibl: { source: "room", intensity: 1 },
  lights: [
    {
      role: "key",
      type: "directional",
      color: "#fff1e2",
      intensity: 2.9,
      position: [4.2, 7.5, 3.2],
      shadow: { frustum: "auto-fit-tree", mapSize: 1024, bias: -3e-4, normalBias: 0.05 }
    },
    { role: "fill", type: "hemisphere", sky: "#f0f4fa", ground: "#d9d3c8", intensity: 0.5 }
  ],
  ground: {
    type: "shadowcatcher",
    shadowOpacity: 0.12,
    shadowColor: "#000000",
    fade: { color: "#ffffff", inner: 2.1, outer: 4.3 },
    contact: { color: "#3b342d", warm: "#6c604f", opacity: 0.1, radius: 1.65 }
  },
  atmosphere: {},
  props: [],
  post: [],
  camera: { position: [3.05, 2, 4.95], target: [0, 0.88, 0], fov: 50 },
  treeOverrides: {
    envMapIntensity: 1,
    exposure: 1.05,
    backlight: { color: "#fff1e2", intensity: 0.16 },
    leafGrade: { hueShift: 0, satMul: 1, lightMul: 1 },
    visualDetail: {
      bark: { macro: 0.58, cracks: 0.88, knots: 0.58, relief: 0.94 },
      foliage: { variation: 0.74, edge: 0.78, vein: 1.18, subsurface: 1 }
    }
  }
};

// scenes/golden-hour.scenespec.json
var golden_hour_scenespec_default = {
  $schema: "scenespec/v1",
  id: "golden-hour",
  name: "Golden Hour Grove",
  seed: 27,
  background: { type: "gradient", top: "#e8b06a", bottom: "#f4e2c0", curve: 1.3 },
  ibl: { source: "gradient", intensity: 1, sky: "#f0c98a", horizon: "#f6e6c4", ground: "#6b5a3c" },
  lights: [
    {
      role: "key",
      type: "directional",
      color: "#ffd9a8",
      intensity: 2.7,
      position: [-3.5, 4, -2.8],
      shadow: { frustum: "auto-fit-tree", mapSize: 1024, bias: -3e-4, normalBias: 0.05 }
    },
    { role: "fill", type: "hemisphere", sky: "#f4d7a0", ground: "#5a4a30", intensity: 0.54 },
    { role: "bounce", type: "directional", color: "#ffe9c2", intensity: 0.5, position: [4.5, 1.6, 2.5] }
  ],
  ground: {
    type: "shadowcatcher",
    shadowOpacity: 0.16,
    shadowColor: "#4a341c",
    fade: { color: "#f4e2c0", inner: 2.4, outer: 5.2 },
    contact: { color: "#5b351c", warm: "#8b5a2c", opacity: 0.24, radius: 1.85 }
  },
  atmosphere: {
    fog: { type: "exp2", color: "#ecd3a2", density: 0.014 },
    particles: { preset: "motes", count: 140, color: "#ffe6b0", area: [4.2, 3.2], size: 0.018, opacity: 0.6 }
  },
  props: [],
  post: [
    { pass: "bloom", strength: 0.3, radius: 0.56, threshold: 0.78 },
    { pass: "grade", lift: "#080604", gain: "#fff0d0", saturation: 1.04, contrast: 1.08, vignette: 0.14 }
  ],
  camera: { position: [3.3, 1.8, 4.6], target: [0, 1, 0], fov: 50 },
  treeOverrides: {
    envMapIntensity: 0.52,
    exposure: 1,
    backlight: { color: "#ffd9a8", intensity: 0.4 },
    leafGrade: { hueShift: -8e-3, satMul: 1.03, lightMul: 1.06 },
    visualDetail: {
      bark: { macro: 0.7, cracks: 0.82, knots: 0.52, relief: 0.86 },
      foliage: { variation: 0.82, edge: 0.82, vein: 1.12, subsurface: 1.18 }
    }
  }
};

// scenes/firefly-night.scenespec.json
var firefly_night_scenespec_default = {
  $schema: "scenespec/v1",
  id: "firefly-night",
  name: "Firefly Night Garden",
  seed: 9,
  background: {
    type: "gradient",
    top: "#040914",
    bottom: "#0e1c34",
    curve: 1.15
  },
  ibl: {
    source: "gradient",
    intensity: 0.5,
    sky: "#1a2f52",
    horizon: "#0e1a30",
    ground: "#05070c"
  },
  lights: [
    {
      role: "key",
      type: "directional",
      color: "#bcd2ff",
      intensity: 0.9,
      position: [
        -3.4,
        7.2,
        -3
      ],
      shadow: {
        frustum: "auto-fit-tree",
        mapSize: 1024,
        bias: -3e-4,
        normalBias: 0.05
      }
    },
    {
      role: "fill",
      type: "hemisphere",
      sky: "#16233d",
      ground: "#050607",
      intensity: 0.35
    },
    {
      role: "lantern",
      type: "point",
      color: "#ffb45e",
      intensity: 5.5,
      position: [
        1.55,
        0.62,
        1.1
      ],
      distance: 7,
      decay: 1.8,
      flicker: 0.12
    }
  ],
  ground: {
    type: "mesh",
    material: "moss",
    fade: {
      color: "#0e1c34",
      inner: 2.2,
      outer: 4.8
    }
  },
  atmosphere: {
    fog: {
      type: "exp2",
      color: "#0a1424",
      density: 0.034
    },
    particles: {
      preset: "fireflies",
      count: 170,
      color: "#d8ff7a",
      area: [
        3.8,
        2.6
      ],
      size: 0.05
    }
  },
  props: [
    {
      src: "procedural:lantern",
      position: [
        1.55,
        0,
        1.1
      ],
      color: "#ffb45e"
    }
  ],
  post: [
    {
      pass: "bloom",
      strength: 0.8,
      radius: 0.6,
      threshold: 0.6
    }
  ],
  camera: {
    position: [
      3.2,
      1.6,
      4.4
    ],
    target: [
      0,
      1,
      0
    ],
    fov: 50
  },
  treeOverrides: {
    envMapIntensity: 0.12,
    exposure: 1,
    backlight: {
      color: "#bcd2ff",
      intensity: 0.1
    },
    leafGrade: {
      hueShift: 0.045,
      satMul: 0.5,
      lightMul: 0.5
    }
  }
};

// scenes/ink-wash.scenespec.json
var ink_wash_scenespec_default = {
  $schema: "scenespec/v1",
  id: "ink-wash",
  name: "Ink-Wash Garden",
  seed: 5,
  background: { type: "color", value: "#f2ecdd" },
  ibl: { source: "gradient", intensity: 0.7, sky: "#ffffff", horizon: "#efe9da", ground: "#b9b2a2" },
  lights: [
    {
      role: "key",
      type: "directional",
      color: "#ffffff",
      intensity: 1.7,
      position: [3, 7.6, 4],
      shadow: { frustum: "auto-fit-tree", mapSize: 1024, bias: -3e-4, normalBias: 0.05 }
    },
    { role: "fill", type: "hemisphere", sky: "#ffffff", ground: "#cfc8b8", intensity: 0.85 }
  ],
  ground: {
    type: "shadowcatcher",
    material: "inkstrokes",
    shadowOpacity: 0.14,
    shadowColor: "#2a2e38",
    fade: { color: "#f2ecdd", inner: 1.9, outer: 4.4 }
  },
  atmosphere: {
    particles: { preset: "inkleaves", count: 42, color: "#262a33", area: [3.2, 3], size: 0.055 }
  },
  props: [],
  post: [
    { pass: "inkwash", paper: "#f2ecdd", ink: "#232630", desat: 0.82, grain: 0.05, vignette: 0.3 }
  ],
  camera: { position: [3.6, 1.5, 4.2], target: [0, 0.95, 0], fov: 48 },
  treeOverrides: {
    envMapIntensity: 0.15,
    exposure: 1.05,
    backlight: { color: "#ffffff", intensity: 0.05 },
    leafGrade: { hueShift: 0.28, satMul: 0.12, lightMul: 0.5 }
  }
};

// src/scenes.js
var SCENES = {
  [white_studio_scenespec_default.id]: white_studio_scenespec_default,
  [golden_hour_scenespec_default.id]: golden_hour_scenespec_default,
  [firefly_night_scenespec_default.id]: firefly_night_scenespec_default,
  [ink_wash_scenespec_default.id]: ink_wash_scenespec_default
};
var NOISE_GLSL = (
  /* glsl */
  `
float phash(vec3 p){ p = fract(p*0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float pnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(phash(i),phash(i+vec3(1,0,0)),f.x), mix(phash(i+vec3(0,1,0)),phash(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(phash(i+vec3(0,0,1)),phash(i+vec3(1,0,1)),f.x), mix(phash(i+vec3(0,1,1)),phash(i+vec3(1,1,1)),f.x), f.y), f.z); }
float pfbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s += a*pnoise3(p); p*=2.03; a*=0.5; } return s*1.07; }
`
);
function makeStoneMaterial(opts, disposables) {
  const o = Object.assign({
    base: "#b8a276",
    dark: "#7c6a4a",
    moss: "#5d6b3a",
    mossAmt: 0.55,
    grid: 0,
    roughness: 0.93
  }, opts);
  const mat = new THREE7.MeshStandardMaterial({
    color: 16777215,
    roughness: o.roughness,
    metalness: 0,
    vertexColors: true,
    envMapIntensity: 0.35
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSBase = { value: new THREE7.Color(o.base) };
    sh.uniforms.uSDark = { value: new THREE7.Color(o.dark) };
    sh.uniforms.uSMoss = { value: new THREE7.Color(o.moss) };
    sh.uniforms.uSMossAmt = { value: o.mossAmt };
    sh.uniforms.uSGrid = { value: o.grid };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSWP;\nvarying vec3 vSNW;").replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvSNW = normalize(mat3(modelMatrix) * objectNormal);").replace("#include <project_vertex>", "#include <project_vertex>\nvSWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vSWP; varying vec3 vSNW;
uniform vec3 uSBase; uniform vec3 uSDark; uniform vec3 uSMoss;
uniform float uSMossAmt; uniform float uSGrid;
${NOISE_GLSL}`).replace("#include <map_fragment>", `#include <map_fragment>
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
}`).replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - (pfbm(vSWP*3.1)-0.5)*0.12, 0.6, 1.0);`);
    mat.userData.shader = sh;
  };
  disposables.push(mat);
  return mat;
}
var PROPS = {
  /* Sandstone block wall being "gripped" by time: coursed blocks with jitter,
     ruin factor knocks blocks out (more toward the top). */
  ruinWall(p, rng2, env) {
    const bw = 0.46, bh = 0.28, bd = 0.34;
    const len = p.length ?? 5, hgt = p.height ?? 2, ruin = p.ruin ?? 0.4;
    const rows = Math.max(1, Math.round(hgt / bh));
    const cols = Math.max(2, Math.round(len / bw));
    const colH = [];
    for (let c = 0; c < cols; c++) colH.push(rows * (1 - ruin * Math.pow(rng2(), 0.55)));
    for (let c = 1; c < cols - 1; c++) colH[c] = colH[c] * 0.6 + (colH[c - 1] + colH[c + 1]) * 0.2;
    const geos = [];
    const m = new THREE7.Matrix4(), q = new THREE7.Quaternion(), e = new THREE7.Euler();
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * bh;
      const off = r % 2 ? bw * 0.5 : 0;
      for (let c = 0; c < cols; c++) {
        if (r >= colH[c]) continue;
        if (r > colH[c] - 1.7 && rng2() < 0.35) continue;
        const g = new THREE7.BoxGeometry(
          bw * (0.94 + rng2() * 0.1),
          bh * (0.92 + rng2() * 0.1),
          bd * (0.9 + rng2() * 0.16)
        );
        e.set((rng2() - 0.5) * 0.05, (rng2() - 0.5) * 0.08, (rng2() - 0.5) * 0.05);
        q.setFromEuler(e);
        m.compose(
          new THREE7.Vector3(-len / 2 + off + c * bw + (rng2() - 0.5) * 0.03, y + (rng2() - 0.5) * 0.012, (rng2() - 0.5) * 0.05),
          q,
          new THREE7.Vector3(1, 1, 1)
        );
        g.applyMatrix4(m);
        const t = 0.82 + rng2() * 0.3, warm = 0.97 + rng2() * 0.06;
        const n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          col[i * 3] = t * warm;
          col[i * 3 + 1] = t;
          col[i * 3 + 2] = t * (2 - warm);
        }
        g.setAttribute("color", new THREE7.BufferAttribute(col, 3));
        geos.push(g);
      }
    }
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    env.disposables.push(merged);
    const mesh = new THREE7.Mesh(merged, env.stoneMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },
  /* Fallen masonry + weathered stones scattered around the base (never inside
     the trunk footprint). */
  rubble(p, rng2, env) {
    const count = p.count ?? 20, R = p.radius ?? 3;
    const geos = [];
    const m = new THREE7.Matrix4(), q = new THREE7.Quaternion(), e = new THREE7.Euler();
    for (let i = 0; i < count; i++) {
      const a = rng2() * Math.PI * 2;
      const r = 1.15 + Math.sqrt(rng2()) * (R - 1.15);
      const s = 0.05 + rng2() * rng2() * 0.2;
      const block = rng2() < 0.45;
      let g;
      if (block) {
        const b = new THREE7.BoxGeometry(s * 1.5, s, s * 1.1);
        g = b.toNonIndexed();
        b.dispose();
      } else {
        g = new THREE7.IcosahedronGeometry(s, 1);
      }
      if (!block) {
        const pos = g.attributes.position;
        for (let v = 0; v < pos.count; v++) {
          const k = 0.75 + rng2() * 0.5;
          pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * (0.55 + rng2() * 0.3), pos.getZ(v) * k);
        }
        g.computeVertexNormals();
      }
      e.set(rng2() * 0.6 - 0.3, rng2() * Math.PI * 2, rng2() * 0.6 - 0.3);
      q.setFromEuler(e);
      m.compose(new THREE7.Vector3(Math.cos(a) * r, s * 0.28, Math.sin(a) * r), q, new THREE7.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      const t = 0.8 + rng2() * 0.3;
      const n = g.attributes.position.count, col = new Float32Array(n * 3).fill(t);
      g.setAttribute("color", new THREE7.BufferAttribute(col, 3));
      geos.push(g);
    }
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    env.disposables.push(merged);
    const mesh = new THREE7.Mesh(merged, env.stoneMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },
  /* Volumetric-ish light shafts: crossed additive planes aligned to the key
     light direction, softly animated by fbm. Cheap on purpose (SS3.1: "earn
     its volumetrics last"). */
  lightShafts(p, rng2, env) {
    const group = new THREE7.Group();
    const count = p.count ?? 4;
    const color = new THREE7.Color(p.color ?? "#ffe7b8");
    const mat = new THREE7.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE7.DoubleSide,
      blending: THREE7.AdditiveBlending,
      uniforms: { uColor: { value: color }, uOpacity: { value: p.opacity ?? 0.16 }, uTime: { value: 0 } },
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
    const dir = env.keyDir.clone();
    const quat = new THREE7.Quaternion().setFromUnitVectors(new THREE7.Vector3(0, 1, 0), dir);
    for (let i = 0; i < count; i++) {
      const a = rng2() * Math.PI * 2, r = 0.5 + rng2() * 1.3;
      const anchor = new THREE7.Vector3(Math.cos(a) * r, 1.1 + rng2() * 1.3, Math.sin(a) * r);
      const w = 0.35 + rng2() * 0.6;
      const geo = new THREE7.PlaneGeometry(w, 7);
      env.disposables.push(geo);
      const shaft = new THREE7.Group();
      shaft.quaternion.copy(quat);
      shaft.position.copy(anchor);
      const m1 = new THREE7.Mesh(geo, mat), m2 = new THREE7.Mesh(geo, mat);
      m2.rotation.y = Math.PI / 2;
      m1.renderOrder = m2.renderOrder = 6;
      shaft.add(m1, m2);
      group.add(shaft);
    }
    return group;
  },
  /* A small paper lantern -- gives the firefly scene's point light a visible
     source (and the bloom pass something warm to catch). */
  lantern(p, rng2, env) {
    const group = new THREE7.Group();
    const c = new THREE7.Color(p.color ?? "#ffb45e");
    const postMat = new THREE7.MeshStandardMaterial({ color: 1709330, roughness: 0.9 });
    const paperMat = new THREE7.MeshStandardMaterial({
      color: 2364677,
      emissive: c,
      emissiveIntensity: 2.4,
      roughness: 0.6
    });
    const postGeo = new THREE7.CylinderGeometry(0.016, 0.02, 0.42, 8);
    const bodyGeo = new THREE7.CylinderGeometry(0.07, 0.088, 0.17, 12, 1, true);
    const capGeo = new THREE7.CylinderGeometry(0.03, 0.095, 0.045, 12);
    [postMat, paperMat, postGeo, bodyGeo, capGeo].forEach((d) => env.disposables.push(d));
    const post = new THREE7.Mesh(postGeo, postMat);
    post.position.y = 0.21;
    const body = new THREE7.Mesh(bodyGeo, paperMat);
    body.position.y = 0.52;
    const cap = new THREE7.Mesh(capGeo, postMat);
    cap.position.y = 0.63;
    post.castShadow = true;
    group.add(post, body, cap);
    return group;
  }
};
function softPointsMaterial({ color, size, opacity, blink }, env) {
  const mat = new THREE7.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE7.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPx: { value: 600 },
      uColor: { value: new THREE7.Color(color) },
      uSize: { value: size },
      uOpacity: { value: opacity }
    },
    vertexShader: `attribute float aSeed; uniform float uTime, uPx, uSize; varying float vA;
void main(){
  vec3 p = position;
  float s = aSeed*6.2831853;
  p.x += sin(uTime*0.21 + s*3.0)*0.45 + sin(uTime*0.43 + s*7.0)*0.1;
  p.y += sin(uTime*0.16 + s*5.0)*0.28;
  p.z += cos(uTime*0.19 + s*4.0)*0.45 + cos(uTime*0.37 + s*6.0)*0.1;
  ${blink ? `float blink = 0.5 + 0.5*sin(uTime*(1.4 + aSeed*2.4) + s*11.0); vA = smoothstep(0.35, 0.95, blink);` : `vA = 0.55 + 0.45*sin(uTime*0.5 + s*9.0);`}
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * uPx / max(0.6, -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float core = exp(-dot(d,d)*24.0);
  ${blink ? `gl_FragColor = vec4(uColor * (0.4 + 2.6*vA), core * (0.12 + 0.88*vA));` : `gl_FragColor = vec4(uColor, core * uOpacity * vA);`}
}`
  });
  env.disposables.push(mat);
  env.timeMats.push(mat);
  env.pointMats.push(mat);
  return mat;
}
function buildDriftPoints(p, rng2, env, { blink }) {
  const N = p.count ?? 150, R = (p.area && p.area[0]) ?? 4, H = (p.area && p.area[1]) ?? 3;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = rng2() * Math.PI * 2, r = Math.sqrt(rng2()) * R;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0.1 + rng2() * H;
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = rng2();
  }
  const geo = new THREE7.BufferGeometry();
  geo.setAttribute("position", new THREE7.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE7.BufferAttribute(seed, 1));
  env.disposables.push(geo);
  const mat = softPointsMaterial({
    color: p.color ?? "#ffffff",
    size: p.size ?? 0.03,
    opacity: p.opacity ?? 0.6,
    blink
  }, env);
  const pts = new THREE7.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
var PARTICLES = {
  motes: (p, rng2, env) => buildDriftPoints(p, rng2, env, { blink: false }),
  fireflies: (p, rng2, env) => buildDriftPoints(p, rng2, env, { blink: true }),
  /* Falling ink leaves: a few dozen CPU-updated instanced blades tumbling down.
     All parameters come from the scene rng; motion is a pure function of time. */
  inkleaves(p, rng2, env) {
    const N = p.count ?? 40, R = (p.area && p.area[0]) ?? 3, H = (p.area && p.area[1]) ?? 3;
    const size = p.size ?? 0.055;
    const geo = new THREE7.PlaneGeometry(size * 2.4, size, 2, 1);
    {
      const v2 = geo.attributes.position;
      for (let i = 0; i < v2.count; i++) {
        const x = v2.getX(i);
        const t = Math.abs(x) / (size * 1.2);
        v2.setY(i, v2.getY(i) * (1 - t * 0.85));
      }
    }
    const mat = new THREE7.MeshBasicMaterial({ color: new THREE7.Color(p.color ?? "#262a33"), side: THREE7.DoubleSide });
    env.disposables.push(geo, mat);
    const mesh = new THREE7.InstancedMesh(geo, mat, N);
    mesh.frustumCulled = false;
    const params = [];
    for (let i = 0; i < N; i++) {
      const a = rng2() * Math.PI * 2;
      params.push({
        x0: Math.cos(a) * Math.sqrt(rng2()) * R,
        z0: Math.sin(a) * Math.sqrt(rng2()) * R,
        phase: rng2() * H,
        speed: 0.1 + rng2() * 0.16,
        sway: 0.15 + rng2() * 0.35,
        swayF: 0.4 + rng2() * 0.6,
        spinA: rng2() * Math.PI * 2,
        spinB: rng2() * Math.PI * 2,
        spinF: 0.5 + rng2() * 1.4
      });
    }
    const m = new THREE7.Matrix4(), q = new THREE7.Quaternion(), e = new THREE7.Euler(), v = new THREE7.Vector3();
    env.updaters.push((t) => {
      for (let i = 0; i < N; i++) {
        const P = params[i];
        const y = H - (t * P.speed + P.phase) % H;
        v.set(
          P.x0 + Math.sin(t * P.swayF + P.phase * 7) * P.sway,
          0.04 + y,
          P.z0 + Math.cos(t * P.swayF * 0.8 + P.phase * 5) * P.sway * 0.7
        );
        e.set(P.spinA + t * P.spinF, P.spinB + t * P.spinF * 0.6, Math.sin(t * P.spinF + P.phase) * 0.9);
        q.setFromEuler(e);
        m.compose(v, q, new THREE7.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
    return mesh;
  }
};
var GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: new THREE7.Color(0) },
    uGain: { value: new THREE7.Color(1, 1, 1) },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uVig: { value: 0 }
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
var InkWashShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE7.Vector2(1024, 768) },
    uPaper: { value: new THREE7.Color("#f2ecdd") },
    uInk: { value: new THREE7.Color("#232630") },
    uDesat: { value: 0.82 },
    uGrain: { value: 0.05 },
    uVig: { value: 0.3 }
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
function createSceneRig(ctx) {
  const { renderer, scene, camera, controls, leafMat, getTree, regradeLeaves } = ctx;
  const root = new THREE7.Group();
  root.name = "scene-rig";
  scene.add(root);
  const pmrem = new THREE7.PMREMGenerator(renderer);
  const rig = {
    spec: null,
    keyLight: null,
    keyDir: new THREE7.Vector3(0.45, 0.8, 0.35).normalize(),
    backlightColor: new THREE7.Color(16773602).multiplyScalar(0.16),
    leafGradeAdjust: null,
    // read by the demo's regradeLeaves()
    composer: null,
    _disposables: [],
    _updaters: [],
    _timeMats: [],
    // materials with a uTime uniform
    _pointMats: [],
    // point materials needing uPx on resize
    _resPasses: [],
    // passes needing uRes on resize
    _flickers: [],
    // { light, base, amt }
    _envRT: null,
    _shadowMapSpec: 1024,
    _quality: { shadowMapSize: 2048 },
    _t0: null
  };
  function clear() {
    while (root.children.length) root.remove(root.children[0]);
    for (const d of rig._disposables) {
      if (d && d.dispose) d.dispose();
    }
    rig._disposables.length = 0;
    rig._updaters.length = 0;
    rig._timeMats.length = 0;
    rig._pointMats.length = 0;
    rig._resPasses.length = 0;
    rig._flickers.length = 0;
    if (rig.composer) {
      rig.composer.dispose();
      rig.composer = null;
    }
    if (rig._envRT) {
      rig._envRT.dispose();
      rig._envRT = null;
    }
    scene.environment = null;
    scene.fog = null;
    scene.background = null;
  }
  function applyBackground(bg) {
    if (!bg || bg.type === "color") {
      renderer.setClearColor(new THREE7.Color(bg && bg.value || "#ffffff"), 1);
      return;
    }
    if (bg.type === "gradient") {
      const top = new THREE7.Color(bg.top), bottom = new THREE7.Color(bg.bottom);
      renderer.setClearColor(bottom, 1);
      const mat = new THREE7.ShaderMaterial({
        side: THREE7.BackSide,
        depthWrite: false,
        uniforms: { uTop: { value: top }, uBottom: { value: bottom }, uCurve: { value: bg.curve ?? 1.2 } },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; uniform vec3 uTop, uBottom; uniform float uCurve;
void main(){
  float t = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(uBottom, uTop, pow(t, uCurve)), 1.0);
}`
      });
      const geo = new THREE7.SphereGeometry(48, 24, 16);
      rig._disposables.push(mat, geo);
      const sky = new THREE7.Mesh(geo, mat);
      sky.renderOrder = -10;
      sky.frustumCulled = false;
      root.add(sky);
    }
  }
  function applyIBL(ibl) {
    if (!ibl || ibl.source === "none") {
      scene.environment = null;
      return;
    }
    if (ibl.source === "room") {
      rig._envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    } else if (ibl.source === "gradient") {
      const es = new THREE7.Scene();
      const mat = new THREE7.ShaderMaterial({
        side: THREE7.BackSide,
        uniforms: {
          uSky: { value: new THREE7.Color(ibl.sky ?? "#ffffff") },
          uHor: { value: new THREE7.Color(ibl.horizon ?? "#dddddd") },
          uGnd: { value: new THREE7.Color(ibl.ground ?? "#444444") }
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; uniform vec3 uSky, uHor, uGnd;
void main(){
  float y = normalize(vP).y;
  vec3 c = y > 0.0 ? mix(uHor, uSky, pow(y, 0.7)) : mix(uHor, uGnd, pow(-y, 0.55));
  gl_FragColor = vec4(c, 1.0);
}`
      });
      const sphere = new THREE7.Mesh(new THREE7.SphereGeometry(10, 24, 16), mat);
      const blobMat = new THREE7.MeshBasicMaterial({
        color: new THREE7.Color(rig.keyLight ? rig.keyLight.color : 16777215).multiplyScalar(4)
      });
      const blob = new THREE7.Mesh(new THREE7.SphereGeometry(1.1, 12, 8), blobMat);
      blob.position.copy(rig.keyDir).multiplyScalar(7.5);
      es.add(sphere, blob);
      rig._envRT = pmrem.fromScene(es, 0.04);
      sphere.geometry.dispose();
      mat.dispose();
      blob.geometry.dispose();
      blobMat.dispose();
    } else if (ibl.source === "hdri" && ibl.url) {
      new RGBELoader().load(ibl.url, (tex) => {
        tex.mapping = THREE7.EquirectangularReflectionMapping;
        rig._envRT = pmrem.fromEquirectangular(tex);
        tex.dispose();
        scene.environment = rig._envRT.texture;
        rig.applyTreeOverrides();
      });
    }
    if (rig._envRT) scene.environment = rig._envRT.texture;
    if ("environmentIntensity" in scene) scene.environmentIntensity = ibl.intensity ?? 1;
  }
  function applyShadowMapSize() {
    const key = rig.keyLight;
    if (!key) return;
    const px = Math.min(rig._shadowMapSpec, rig._quality.shadowMapSize || 2048);
    if (key.shadow.mapSize.x !== px) {
      key.shadow.mapSize.set(px, px);
      if (key.shadow.map) key.shadow.map.setSize(px, px);
    }
  }
  function applyLights(lights) {
    const L = lights || [];
    let keySpec = L.find((l) => l.role === "key");
    if (!keySpec) keySpec = { type: "directional", color: "#ffffff", intensity: 2, position: [4, 7, 3], shadow: {} };
    const key = new THREE7.DirectionalLight(new THREE7.Color(keySpec.color), keySpec.intensity);
    key.position.fromArray(keySpec.position);
    key.castShadow = true;
    const sh = keySpec.shadow || {};
    key.shadow.bias = sh.bias ?? -3e-4;
    key.shadow.normalBias = sh.normalBias ?? 0.05;
    rig._shadowMapSpec = sh.mapSize ?? 1024;
    rig.keyLight = key;
    rig.keyDir.copy(key.position).normalize();
    applyShadowMapSize();
    root.add(key, key.target);
    for (const l of L) {
      if (l === keySpec) continue;
      if (l.type === "hemisphere") {
        root.add(new THREE7.HemisphereLight(new THREE7.Color(l.sky), new THREE7.Color(l.ground), l.intensity ?? 0.5));
      } else if (l.type === "directional") {
        const d = new THREE7.DirectionalLight(new THREE7.Color(l.color), l.intensity ?? 1);
        d.position.fromArray(l.position || [0, 5, 0]);
        root.add(d, d.target);
      } else if (l.type === "point") {
        const pt = new THREE7.PointLight(new THREE7.Color(l.color), l.intensity ?? 1, l.distance ?? 0, l.decay ?? 2);
        pt.position.fromArray(l.position || [0, 1, 0]);
        root.add(pt);
        if (l.flicker) rig._flickers.push({ light: pt, base: pt.intensity, amt: l.flicker });
      } else if (l.type === "ambient") {
        root.add(new THREE7.AmbientLight(new THREE7.Color(l.color), l.intensity ?? 0.3));
      }
    }
  }
  function applyGround(g, sceneRng) {
    if (!g || g.type === "none") return;
    if (g.type === "mesh" && g.material) {
      const R = (g.fade && g.fade.outer || 4.5) + 2.5;
      const geo = new THREE7.CircleGeometry(R, 64).rotateX(-Math.PI / 2);
      const n = geo.attributes.position.count;
      geo.setAttribute("color", new THREE7.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      rig._disposables.push(geo);
      let mat;
      if (g.material === "sandstone") {
        mat = makeStoneMaterial({ base: "#b3a077", dark: "#6e5f45", moss: "#55663a", mossAmt: 0.5, grid: 1 }, rig._disposables);
      } else if (g.material === "moss") {
        mat = makeStoneMaterial({ base: "#1c2b1e", dark: "#0b120c", moss: "#2c4a2e", mossAmt: 0.75, grid: 0, roughness: 0.98 }, rig._disposables);
      } else {
        mat = new THREE7.MeshStandardMaterial({ color: 8947848, roughness: 0.95 });
        rig._disposables.push(mat);
      }
      const ground = new THREE7.Mesh(geo, mat);
      ground.receiveShadow = true;
      root.add(ground);
    } else {
      const shadowMat = new THREE7.ShadowMaterial({ opacity: g.shadowOpacity ?? 0.12 });
      if (g.shadowColor) shadowMat.color = new THREE7.Color(g.shadowColor);
      rig._disposables.push(shadowMat);
      const geo = new THREE7.PlaneGeometry(26, 26).rotateX(-Math.PI / 2);
      rig._disposables.push(geo);
      const catcher = new THREE7.Mesh(geo, shadowMat);
      catcher.receiveShadow = true;
      catcher.renderOrder = 1;
      root.add(catcher);
      if (g.material === "inkstrokes") {
        const smat = new THREE7.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { uInk: { value: new THREE7.Color("#2b2f3a") }, uSeed: { value: sceneRng() * 100 | 0 } },
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
        const sgeo = new THREE7.PlaneGeometry(14, 14).rotateX(-Math.PI / 2).translate(0, 8e-4, 0);
        rig._disposables.push(smat, sgeo);
        const strokes = new THREE7.Mesh(sgeo, smat);
        strokes.renderOrder = 0;
        root.add(strokes);
      }
    }
    if (g.fade) {
      const fmat = new THREE7.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uInner: { value: g.fade.inner ?? 2.1 },
          uOuter: { value: g.fade.outer ?? 4.3 },
          uColor: { value: new THREE7.Color(g.fade.color ?? "#ffffff") }
        },
        vertexShader: `varying vec3 vWp; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWp = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
        fragmentShader: `varying vec3 vWp; uniform float uInner, uOuter; uniform vec3 uColor;
void main(){ float a = smoothstep(uInner, uOuter, length(vWp.xz)); gl_FragColor = vec4(uColor, a); }`
      });
      const fgeo = new THREE7.PlaneGeometry(26, 26).rotateX(-Math.PI / 2).translate(0, 15e-4, 0);
      rig._disposables.push(fmat, fgeo);
      const fade = new THREE7.Mesh(fgeo, fmat);
      fade.renderOrder = 2;
      root.add(fade);
    }
    if (g.contact) {
      const c = g.contact;
      const contactMat = new THREE7.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE7.Color(c.color ?? "#4a341c") },
          uWarm: { value: new THREE7.Color(c.warm ?? c.color ?? "#6a4b2a") },
          uRadius: { value: c.radius ?? 1.7 },
          uOpacity: { value: c.opacity ?? 0.18 },
          uSeed: { value: sceneRng() * 1e3 | 0 }
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
      const contactGeo = new THREE7.PlaneGeometry(5.8, 5.8, 1, 1).rotateX(-Math.PI / 2).translate(0, 22e-4, 0);
      rig._disposables.push(contactMat, contactGeo);
      const contact = new THREE7.Mesh(contactGeo, contactMat);
      contact.renderOrder = 3;
      root.add(contact);
    }
  }
  function applyAtmosphere(a, sceneRng) {
    if (!a) return;
    if (a.fog) {
      scene.fog = a.fog.type === "linear" ? new THREE7.Fog(new THREE7.Color(a.fog.color), a.fog.near ?? 4, a.fog.far ?? 30) : new THREE7.FogExp2(new THREE7.Color(a.fog.color), a.fog.density ?? 0.02);
    }
    if (a.particles && PARTICLES[a.particles.preset]) {
      const env = {
        disposables: rig._disposables,
        timeMats: rig._timeMats,
        pointMats: rig._pointMats,
        updaters: rig._updaters
      };
      root.add(PARTICLES[a.particles.preset](a.particles, sceneRng, env));
    }
  }
  function applyProps(props, sceneRng) {
    if (!props || !props.length) return;
    const env = {
      disposables: rig._disposables,
      timeMats: rig._timeMats,
      pointMats: rig._pointMats,
      updaters: rig._updaters,
      keyDir: rig.keyDir,
      stoneMat: null
    };
    for (const p of props) {
      const name = String(p.src || "").replace(/^procedural:/, "");
      const builder = PROPS[name];
      if (!builder) continue;
      if ((name === "ruinWall" || name === "rubble") && !env.stoneMat) {
        env.stoneMat = makeStoneMaterial({}, rig._disposables);
      }
      const obj = builder(p, sceneRng, env);
      if (p.position) obj.position.fromArray(p.position);
      if (p.rotationY) obj.rotation.y = p.rotationY;
      root.add(obj);
    }
  }
  function applyPost(post) {
    const list = post || [];
    if (!list.length) return;
    const size = renderer.getSize(new THREE7.Vector2());
    const rt = new THREE7.WebGLRenderTarget(size.x, size.y, { type: THREE7.HalfFloatType, samples: 0 });
    const composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.addPass(new RenderPass(scene, camera));
    for (const p of list) {
      if (p.pass === "bloom") {
        composer.addPass(new UnrealBloomPass(
          new THREE7.Vector2(size.x, size.y),
          p.strength ?? 0.4,
          p.radius ?? 0.5,
          p.threshold ?? 0.85
        ));
      }
    }
    composer.addPass(new OutputPass());
    for (const p of list) {
      if (p.pass === "grade") {
        const pass = new ShaderPass(GradeShader);
        pass.uniforms.uLift.value.set(p.lift ?? "#000000");
        pass.uniforms.uGain.value.set(p.gain ?? "#ffffff");
        pass.uniforms.uSat.value = p.saturation ?? 1;
        pass.uniforms.uContrast.value = p.contrast ?? 1;
        pass.uniforms.uVig.value = p.vignette ?? 0;
        composer.addPass(pass);
      } else if (p.pass === "inkwash") {
        const pass = new ShaderPass(InkWashShader);
        pass.uniforms.uPaper.value.set(p.paper ?? "#f2ecdd");
        pass.uniforms.uInk.value.set(p.ink ?? "#232630");
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
  rig.apply = function(spec) {
    clear();
    rig.spec = spec;
    const sceneRng = mulberry32((spec.seed ?? 1) >>> 0);
    applyLights(spec.lights);
    applyBackground(spec.background);
    applyIBL(spec.ibl);
    applyGround(spec.ground, sceneRng);
    applyAtmosphere(spec.atmosphere, sceneRng);
    applyProps(spec.props, sceneRng);
    applyPost(spec.post);
    if (spec.camera) {
      if (spec.camera.fov) {
        camera.fov = spec.camera.fov;
        camera.updateProjectionMatrix();
      }
      if (spec.camera.position) camera.position.fromArray(spec.camera.position);
      if (spec.camera.target) controls.target.fromArray(spec.camera.target);
      controls.update();
    }
    rig.applyTreeOverrides();
    rig.fitShadows();
    rig.setSize(renderer.domElement.clientWidth || 1, renderer.domElement.clientHeight || 1);
    console.log(`[banyan] scene=${spec.id}`);
  };
  rig.applyTreeOverrides = function() {
    const o = rig.spec && rig.spec.treeOverrides || {};
    renderer.toneMappingExposure = o.exposure ?? 1.05;
    const env = o.envMapIntensity ?? 1;
    const t = getTree();
    for (const m of [t.barkMat, leafMat, t.blossomMat]) {
      if (!m) continue;
      if (m.envMap !== scene.environment) {
        m.envMap = scene.environment;
        m.needsUpdate = true;
      }
      m.envMapIntensity = env;
    }
    const bl = o.backlight || {};
    rig.backlightColor.set(bl.color ?? "#fff1e2").multiplyScalar(bl.intensity ?? 0.16);
    const g = o.leafGrade;
    rig.leafGradeAdjust = g && ((g.hueShift || 0) !== 0 || (g.satMul ?? 1) !== 1 || (g.lightMul ?? 1) !== 1) ? { hueShift: g.hueShift || 0, satMul: g.satMul ?? 1, lightMul: g.lightMul ?? 1 } : null;
    const vd = o.visualDetail || {};
    setLeafVisualDetail(leafMat, vd.foliage || {});
    setBarkVisualDetail(t.barkMat, vd.bark || {});
    regradeLeaves();
  };
  rig.fitShadows = function() {
    const key = rig.keyLight;
    if (!key) return;
    const { wood, leaves, blossoms } = getTree();
    const box = new THREE7.Box3();
    if (wood) {
      wood.geometry.computeBoundingBox();
      box.union(wood.geometry.boundingBox);
    }
    if (leaves) {
      leaves.computeBoundingBox();
      box.union(leaves.boundingBox);
    }
    if (blossoms) {
      blossoms.computeBoundingBox();
      box.union(blossoms.boundingBox);
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE7.Sphere());
    const c = sphere.center, r = Math.max(1, sphere.radius);
    const dist = Math.max(6, r * 2.2);
    key.position.copy(c).addScaledVector(rig.keyDir, dist);
    key.target.position.copy(c);
    key.target.updateMatrixWorld();
    const cam = key.shadow.camera;
    const m = r * 1.06;
    cam.left = -m;
    cam.right = m;
    cam.top = m;
    cam.bottom = -m;
    cam.near = Math.max(0.5, dist - r * 1.2);
    cam.far = dist + r * 1.2 + Math.max(0, box.max.y) / Math.max(0.2, rig.keyDir.y);
    cam.updateProjectionMatrix();
  };
  rig.setQuality = function(Qx) {
    rig._quality = Qx;
    applyShadowMapSize();
  };
  rig.setSize = function(w, h) {
    if (rig.composer) {
      rig.composer.setPixelRatio(renderer.getPixelRatio());
      rig.composer.setSize(w, h);
    }
    const px = h * renderer.getPixelRatio() / (2 * Math.tan(THREE7.MathUtils.degToRad(camera.fov * 0.5)));
    for (const m of rig._pointMats) m.uniforms.uPx.value = px;
    for (const p of rig._resPasses) p.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  };
  rig.update = function(nowMs) {
    if (rig._t0 === null) rig._t0 = nowMs;
    const t = (nowMs - rig._t0) / 1e3;
    for (const m of rig._timeMats) m.uniforms.uTime.value = t;
    for (const u of rig._updaters) u(t);
    for (const f of rig._flickers) {
      f.light.intensity = f.base * (1 + f.amt * (Math.sin(t * 9.3) + 0.5 * Math.sin(t * 23.7) + Math.sin(t * 5.1)) / 2.5);
    }
  };
  rig.render = function() {
    if (rig.composer) rig.composer.render();
    else renderer.render(scene, camera);
  };
  return rig;
}

// src/spec/banyan.treespec.json
var banyan_treespec_default = {
  seed: 1892,
  leafCount: 6800,
  quality: "auto",
  habit: {
    field: { base: 1.08, amp: 0.92, falloff: 2 },
    steer: 0.22,
    outward: 0.05
  },
  trunk: {
    height: 1.15,
    r0: 0.3,
    r1: 0.185,
    lean: 0.09,
    wobble: 0.1,
    radiusPow: 0.8,
    gnarl: 0.13,
    lobes: { count: 7, base: 0.55, amp: 0.6, sharp: 2.4, span: 0.38, mode: "ground" }
  },
  recursion: {
    maxDepth: 4,
    minRadius: 55e-4,
    spacing: { "1": 0.28, "2": 0.18, "3": 0.15 },
    lenByDepth: { "2": [0.5, 0.95], "3": [0.28, 0.52], "4": [0.14, 0.27] },
    wig: [0, 0.1, 0.15, 0.2, 0.26],
    steer: [0, 1, 0.85, 0.8, 0.6],
    childRadius: [0.52, 0.7],
    upBias: 0.12,
    gnarlByDepth: [0.16, 0.12, 0.09, 0.07, 0.05]
  },
  propRoots: {
    count: 6,
    thick: 2,
    gnarl: 0.15,
    feet: 2,
    minAzimuthSep: [0.6, 0.45, 0.25, 0],
    eligibility: { minY: 0.7, minRad: 0.55, maxRad: 2.3 },
    topR: [0.028, 0.04],
    thickR: [0.125, 0.15],
    thinR: [0.065, 0.105]
  },
  surfaceRoots: {
    count: 8,
    gnarl: 0.17,
    length: [0.4, 0.8],
    r0: [0.07, 0.11],
    startHeight: [0.08, 0.14]
  },
  foliage: {
    blade: { length: 0.135, widthRatio: 0.33 },
    anchor: {
      step: 0.045,
      startFrac: 0.18,
      jitter: [0.75, 1.3],
      maxTwigRadius: 0.04,
      tipWeight: 2.2,
      tipThresh: 0.85,
      tipBonus: 3
    },
    scale: [0.8, 1.25],
    palette: {
      h: 0.34,
      hJitter: 0.015,
      sunHue: 0.012,
      s: [0.6, 0.75],
      lBase: 0.06,
      lSun: 0.065,
      lJitter: 0.012,
      senescent: { rate: 0.02, h: [0.13, 0.2], s: [0.55, 0.7], l: [0.28, 0.36] }
    }
  },
  bark: {
    crevice: [0.045, 0.036, 0.028],
    ridge: [0.155, 0.132, 0.106],
    striaScale: 3.2,
    mottleScale: 6.5,
    bump: 0.9
  }
};

// src/spec/dead-winter-oak.treespec.json
var dead_winter_oak_treespec_default = {
  $schema: "treespec/v1",
  id: "dead-winter-oak",
  seed: 4242,
  leafCount: 0,
  quality: "auto",
  habit: {
    form: "dome",
    field: {
      base: 1.15,
      amp: 0.95,
      falloff: 2.6
    },
    steer: 0.2,
    outward: 0.07
  },
  trunk: {
    height: 1,
    r0: 0.24,
    r1: 0.13,
    lean: 0.14,
    wobble: 0.16,
    radiusPow: 0.85,
    gnarl: 0.22,
    lobes: {
      count: 5,
      base: 0.4,
      amp: 0.45,
      sharp: 2,
      span: 0.3,
      mode: "ground"
    }
  },
  scaffolds: {
    low: 2,
    upper: 5,
    apex: 2,
    elevation: [
      0.35,
      0.7
    ],
    lowLen: 1.1,
    upperLen: [
      1,
      1.5
    ],
    apexLen: [
      0.4,
      0.6
    ]
  },
  recursion: {
    maxDepth: 5,
    minRadius: 25e-4,
    spacing: {
      "1": 0.26,
      "2": 0.17,
      "3": 0.13,
      "4": 0.1
    },
    lenByDepth: {
      "2": [
        0.45,
        0.85
      ],
      "3": [
        0.26,
        0.5
      ],
      "4": [
        0.15,
        0.3
      ],
      "5": [
        0.08,
        0.18
      ]
    },
    wig: [
      0,
      0.12,
      0.18,
      0.24,
      0.3,
      0.34
    ],
    steer: [
      0,
      1,
      0.85,
      0.75,
      0.6,
      0.4
    ],
    childRadius: [
      0.58,
      0.78
    ],
    upBias: 0.1,
    gnarlByDepth: [
      0.2,
      0.16,
      0.13,
      0.1,
      0.08,
      0.06
    ]
  },
  propRoots: null,
  surfaceRoots: {
    count: 7,
    gnarl: 0.2,
    length: [
      0.35,
      0.7
    ],
    r0: [
      0.06,
      0.1
    ],
    startHeight: [
      0.08,
      0.14
    ]
  },
  foliage: {
    blade: {
      length: 0.11,
      widthRatio: 0.5,
      outline: "lobed",
      lobes: 4
    },
    anchor: {
      step: 0.045,
      startFrac: 0.18,
      jitter: [
        0.75,
        1.3
      ],
      maxTwigRadius: 0.04,
      tipWeight: 2.2,
      tipThresh: 0.85,
      tipBonus: 3
    },
    scale: [
      0.8,
      1.25
    ],
    palette: {
      h: 0.09,
      hJitter: 0.012,
      sunHue: 0.01,
      s: [
        0.3,
        0.45
      ],
      lBase: 0.1,
      lSun: 0.05,
      lJitter: 0.012,
      senescent: {
        rate: 0.4,
        h: [
          0.06,
          0.1
        ],
        s: [
          0.3,
          0.45
        ],
        l: [
          0.18,
          0.3
        ]
      }
    }
  },
  bark: {
    crevice: [
      0.03,
      0.026,
      0.022
    ],
    ridge: [
      0.11,
      0.098,
      0.085
    ],
    striaScale: 2.6,
    mottleScale: 5,
    bump: 1.15
  }
};

// src/spec/english-oak.treespec.json
var english_oak_treespec_default = {
  $schema: "treespec/v1",
  id: "english-oak",
  seed: 1892,
  leafCount: 7e3,
  quality: "auto",
  habit: {
    form: "dome",
    field: { base: 1.25, amp: 1, falloff: 3 },
    steer: 0.24,
    outward: 0.06
  },
  trunk: {
    height: 0.95,
    r0: 0.22,
    r1: 0.15,
    lean: 0.06,
    wobble: 0.09,
    radiusPow: 0.8,
    gnarl: 0.15,
    lobes: { count: 6, base: 0.35, amp: 0.4, sharp: 2.2, span: 0.3, mode: "ground" }
  },
  scaffolds: {
    low: 1,
    upper: 6,
    apex: 2,
    elevation: [0.4, 0.75],
    lowLen: 1.15,
    upperLen: [1.1, 1.6],
    apexLen: [0.4, 0.65],
    lowElev: 0.35
  },
  recursion: {
    maxDepth: 4,
    minRadius: 5e-3,
    spacing: { "1": 0.26, "2": 0.16, "3": 0.13 },
    lenByDepth: { "2": [0.5, 0.9], "3": [0.3, 0.55], "4": [0.16, 0.3] },
    wig: [0, 0.11, 0.16, 0.22, 0.28],
    steer: [0, 1, 0.9, 0.8, 0.65],
    childRadius: [0.52, 0.7],
    upBias: 0.14,
    gnarlByDepth: [0.16, 0.13, 0.1, 0.08, 0.06]
  },
  propRoots: null,
  surfaceRoots: {
    count: 6,
    gnarl: 0.16,
    length: [0.3, 0.55],
    r0: [0.055, 0.09],
    startHeight: [0.07, 0.12]
  },
  foliage: {
    blade: { length: 0.115, widthRatio: 0.5, outline: "lobed", lobes: 4, keel: 0.16, recurve: 0.18, droop: 0.1 },
    anchor: {
      step: 0.042,
      startFrac: 0.18,
      jitter: [0.75, 1.3],
      maxTwigRadius: 0.04,
      tipWeight: 2.2,
      tipThresh: 0.85,
      tipBonus: 3
    },
    scale: [0.8, 1.3],
    palette: {
      h: 0.29,
      hJitter: 0.014,
      sunHue: 0.014,
      s: [0.45, 0.62],
      lBase: 0.07,
      lSun: 0.06,
      lJitter: 0.012,
      senescent: { rate: 0.05, h: [0.08, 0.11], s: [0.5, 0.65], l: [0.22, 0.32] }
    }
  },
  bark: {
    crevice: [0.04, 0.036, 0.03],
    ridge: [0.13, 0.12, 0.105],
    striaScale: 4,
    mottleScale: 5.5,
    bump: 1.05
  }
};

// src/spec/cherry-blossom.treespec.json
var cherry_blossom_treespec_default = {
  $schema: "treespec/v1",
  id: "cherry-blossom",
  seed: 1892,
  leafCount: 1600,
  quality: "auto",
  habit: {
    form: "dome",
    field: {
      base: 1.15,
      amp: 0.75,
      falloff: 2.4
    },
    steer: 0.2,
    outward: 0.1
  },
  trunk: {
    height: 0.9,
    r0: 0.16,
    r1: 0.11,
    lean: 0.12,
    wobble: 0.12,
    radiusPow: 0.9,
    gnarl: 0.08,
    lobes: {
      count: 4,
      base: 0.25,
      amp: 0.3,
      sharp: 2,
      span: 0.22,
      mode: "ground"
    }
  },
  scaffolds: {
    low: 0,
    upper: 6,
    apex: 1,
    elevation: [
      0.55,
      0.95
    ],
    upperLen: [
      1.1,
      1.5
    ],
    apexLen: [
      0.35,
      0.55
    ],
    upperAt: [
      0.85,
      1
    ]
  },
  recursion: {
    maxDepth: 4,
    minRadius: 45e-4,
    spacing: {
      "1": 0.26,
      "2": 0.16,
      "3": 0.13
    },
    lenByDepth: {
      "2": [
        0.45,
        0.8
      ],
      "3": [
        0.28,
        0.5
      ],
      "4": [
        0.15,
        0.28
      ]
    },
    wig: [
      0,
      0.12,
      0.17,
      0.22,
      0.26
    ],
    steer: [
      0,
      1,
      0.8,
      0.7,
      0.5
    ],
    childRadius: [
      0.5,
      0.68
    ],
    upBias: 0.06,
    gnarlByDepth: [
      0.08,
      0.07,
      0.06,
      0.05,
      0.04
    ]
  },
  propRoots: null,
  surfaceRoots: {
    count: 5,
    gnarl: 0.1,
    length: [
      0.25,
      0.45
    ],
    r0: [
      0.04,
      0.07
    ],
    startHeight: [
      0.05,
      0.09
    ]
  },
  foliage: {
    blade: {
      length: 0.1,
      widthRatio: 0.4
    },
    anchor: {
      step: 0.045,
      startFrac: 0.2,
      jitter: [
        0.75,
        1.3
      ],
      maxTwigRadius: 0.035,
      tipWeight: 2.4,
      tipThresh: 0.85,
      tipBonus: 3
    },
    scale: [
      0.8,
      1.2
    ],
    palette: {
      h: 0.24,
      hJitter: 0.02,
      sunHue: 0.012,
      s: [
        0.4,
        0.58
      ],
      lBase: 0.09,
      lSun: 0.06,
      lJitter: 0.014,
      senescent: {
        rate: 0.03,
        h: [
          0.05,
          0.09
        ],
        s: [
          0.5,
          0.65
        ],
        l: [
          0.25,
          0.35
        ]
      }
    }
  },
  blossom: {
    count: 5200,
    clusterSize: 3,
    clusterRadius: 0.02,
    size: 0.026,
    sizeJitter: [
      0.75,
      1.35
    ],
    palette: {
      h: [
        0.93,
        1
      ],
      s: [
        0.28,
        0.55
      ],
      l: [
        0.7,
        0.88
      ]
    }
  },
  bark: {
    style: "smooth",
    crevice: [
      0.085,
      0.05,
      0.045
    ],
    ridge: [
      0.24,
      0.145,
      0.12
    ],
    lenticel: [
      0.44,
      0.38,
      0.34
    ],
    striaScale: 1.2,
    mottleScale: 3.2,
    bump: 0.35
  }
};

// src/spec/baobab.treespec.json
var baobab_treespec_default = {
  $schema: "treespec/v1",
  id: "baobab",
  seed: 777,
  leafCount: 2600,
  quality: "auto",
  habit: {
    form: "bottle",
    field: {
      base: 1.55,
      amp: 0.5,
      falloff: 1.6
    },
    steer: 0.28,
    outward: 0.06
  },
  trunk: {
    height: 1.25,
    r0: 0.42,
    r1: 0.14,
    lean: 0.03,
    wobble: 0.05,
    radiusPow: 0.62,
    gnarl: 0.06,
    lobes: {
      count: 8,
      base: 0.12,
      amp: 0.15,
      sharp: 1.5,
      span: 0.4,
      mode: "ground"
    }
  },
  scaffolds: {
    low: 0,
    upper: 5,
    apex: 3,
    elevation: [
      0.5,
      0.85
    ],
    upperLen: [
      0.85,
      1.25
    ],
    apexLen: [
      0.35,
      0.55
    ],
    upperAt: [
      0.92,
      1
    ],
    upperR0: [
      0.62,
      0.8
    ],
    apexR0: [
      0.5,
      0.62
    ]
  },
  recursion: {
    maxDepth: 3,
    minRadius: 6e-3,
    spacing: {
      "1": 0.22,
      "2": 0.15
    },
    lenByDepth: {
      "2": [
        0.3,
        0.55
      ],
      "3": [
        0.15,
        0.3
      ]
    },
    wig: [
      0,
      0.1,
      0.14,
      0.18
    ],
    steer: [
      0,
      1,
      0.9,
      0.8
    ],
    childRadius: [
      0.5,
      0.66
    ],
    upBias: 0.16,
    gnarlByDepth: [
      0.06,
      0.06,
      0.05,
      0.04
    ]
  },
  propRoots: null,
  surfaceRoots: {
    count: 5,
    gnarl: 0.08,
    length: [
      0.25,
      0.45
    ],
    r0: [
      0.09,
      0.13
    ],
    startHeight: [
      0.1,
      0.16
    ]
  },
  foliage: {
    blade: {
      length: 0.09,
      widthRatio: 0.42
    },
    anchor: {
      step: 0.045,
      startFrac: 0.25,
      jitter: [
        0.75,
        1.3
      ],
      maxTwigRadius: 0.045,
      tipWeight: 2.6,
      tipThresh: 0.85,
      tipBonus: 3
    },
    scale: [
      0.8,
      1.2
    ],
    palette: {
      h: 0.31,
      hJitter: 0.012,
      sunHue: 0.012,
      s: [
        0.5,
        0.65
      ],
      lBase: 0.08,
      lSun: 0.06,
      lJitter: 0.012,
      senescent: {
        rate: 0.03,
        h: [
          0.11,
          0.15
        ],
        s: [
          0.5,
          0.65
        ],
        l: [
          0.25,
          0.33
        ]
      }
    }
  },
  bark: {
    style: "smooth",
    crevice: [
      0.125,
      0.1,
      0.09
    ],
    ridge: [
      0.265,
      0.222,
      0.198
    ],
    lenticel: [
      0.24,
      0.2,
      0.18
    ],
    striaScale: 0.9,
    mottleScale: 2.4,
    bump: 0.3
  }
};

// src/spec/black-pine.treespec.json
var black_pine_treespec_default = {
  $schema: "treespec/v1",
  id: "black-pine",
  seed: 1892,
  leafCount: 950,
  quality: "auto",
  habit: {
    form: "pads",
    field: { base: 0.9, amp: 0.7, falloff: 2 },
    pads: { lobes: 5, amp: 0.35, phase: 0.7 },
    steer: 0.3,
    outward: 0.05
  },
  trunk: {
    height: 1,
    r0: 0.17,
    r1: 0.1,
    lean: 0.22,
    wobble: 0.07,
    radiusPow: 0.8,
    gnarl: 0.12,
    lobes: { count: 5, base: 0.3, amp: 0.3, sharp: 2, span: 0.25, mode: "ground" }
  },
  scaffolds: {
    low: 2,
    upper: 4,
    apex: 1,
    elevation: [0.05, 0.3],
    lowLen: 1.2,
    upperLen: [0.9, 1.4],
    apexLen: [0.35, 0.5],
    lowElev: 0.12,
    lowAt: 0.5
  },
  recursion: {
    maxDepth: 3,
    minRadius: 5e-3,
    spacing: { "1": 0.24, "2": 0.15 },
    lenByDepth: { "2": [0.35, 0.65], "3": [0.18, 0.35] },
    wig: [0, 0.14, 0.2, 0.24],
    steer: [0, 1, 0.95, 0.9],
    childRadius: [0.5, 0.68],
    upBias: 0.02,
    gnarlByDepth: [0.14, 0.11, 0.09, 0.07]
  },
  propRoots: null,
  surfaceRoots: {
    count: 3,
    gnarl: 0.15,
    length: [0.45, 0.75],
    r0: [0.038, 0.055],
    startHeight: [0.06, 0.1]
  },
  foliage: {
    system: "tufts",
    tuft: { needles: 30, spread: 1.15 },
    blade: { length: 0.095, widthRatio: 0.33, outline: "needle" },
    anchor: {
      step: 0.05,
      startFrac: 0.3,
      jitter: [0.8, 1.3],
      maxTwigRadius: 0.035,
      tipWeight: 2.5,
      tipThresh: 0.8,
      tipBonus: 3
    },
    scale: [0.85, 1.25],
    palette: {
      h: 0.365,
      hJitter: 0.012,
      sunHue: 0.01,
      s: [0.42, 0.58],
      lBase: 0.05,
      lSun: 0.05,
      lJitter: 0.012,
      senescent: { rate: 5e-3, h: [0.12, 0.15], s: [0.5, 0.6], l: [0.2, 0.3] }
    }
  },
  bark: {
    crevice: [0.03, 0.024, 0.02],
    ridge: [0.12, 0.1, 0.09],
    striaScale: 1.4,
    mottleScale: 7,
    bump: 1.2
  }
};

// src/spec/weeping-willow.treespec.json
var weeping_willow_treespec_default = {
  $schema: "treespec/v1",
  id: "weeping-willow",
  seed: 4242,
  leafCount: 9e3,
  quality: "auto",
  habit: {
    form: "cascade",
    field: {
      base: 1.35,
      amp: 0.8,
      falloff: 2.2
    },
    cascade: {
      riseRadius: 0.55,
      drop: 2.2,
      reach: 2.6
    },
    clampY: 0.8,
    steer: 0.3,
    outward: 0.12
  },
  trunk: {
    height: 1.05,
    r0: 0.2,
    r1: 0.13,
    lean: 0.1,
    wobble: 0.11,
    radiusPow: 0.8,
    gnarl: 0.14,
    lobes: {
      count: 6,
      base: 0.4,
      amp: 0.45,
      sharp: 2.2,
      span: 0.3,
      mode: "ground"
    }
  },
  scaffolds: {
    low: 1,
    upper: 5,
    apex: 2,
    elevation: [
      0.45,
      0.8
    ],
    lowLen: 1.2,
    upperLen: [
      1.2,
      1.7
    ],
    apexLen: [
      0.4,
      0.6
    ],
    lowElev: 0.4
  },
  recursion: {
    maxDepth: 3,
    minRadius: 5e-3,
    spacing: {
      "1": 0.26,
      "2": 0.16
    },
    lenByDepth: {
      "2": [
        0.5,
        0.9
      ],
      "3": [
        0.3,
        0.55
      ]
    },
    wig: [
      0,
      0.11,
      0.16,
      0.2
    ],
    steer: [
      0,
      1,
      0.9,
      0.85
    ],
    childRadius: [
      0.5,
      0.68
    ],
    upBias: 0.05,
    gnarlByDepth: [
      0.14,
      0.11,
      0.09,
      0.07
    ]
  },
  strands: {
    fromDepth: 3,
    perTip: [
      1,
      3
    ],
    len: [
      0.6,
      1.1
    ],
    r0: 7e-3,
    sway: 0.1,
    gravity: 0.5,
    gnarl: 0.05
  },
  propRoots: null,
  surfaceRoots: {
    count: 6,
    gnarl: 0.16,
    length: [
      0.3,
      0.55
    ],
    r0: [
      0.055,
      0.09
    ],
    startHeight: [
      0.07,
      0.12
    ]
  },
  foliage: {
    blade: {
      length: 0.085,
      widthRatio: 0.14,
      outline: "narrow",
      keel: 0.2,
      recurve: 0.1,
      droop: 0.05
    },
    anchor: {
      step: 0.032,
      startFrac: 0.1,
      jitter: [
        0.7,
        1.2
      ],
      maxTwigRadius: 0.02,
      tipWeight: 1.2,
      tipThresh: 0.9,
      tipBonus: 1
    },
    scale: [
      0.8,
      1.2
    ],
    palette: {
      h: 0.3,
      hJitter: 0.016,
      sunHue: 0.014,
      s: [
        0.45,
        0.65
      ],
      lBase: 0.08,
      lSun: 0.07,
      lJitter: 0.014,
      senescent: {
        rate: 0.02,
        h: [
          0.13,
          0.17
        ],
        s: [
          0.5,
          0.65
        ],
        l: [
          0.26,
          0.34
        ]
      }
    }
  },
  bark: {
    crevice: [
      0.04,
      0.035,
      0.028
    ],
    ridge: [
      0.14,
      0.125,
      0.1
    ],
    striaScale: 4.5,
    mottleScale: 5,
    bump: 1
  }
};

// src/species.js
var SPECIES = {
  "banyan": { name: "Banyan", spec: banyan_treespec_default, tier: "core" },
  "dead-winter-oak": { name: "Dead Winter Oak", spec: dead_winter_oak_treespec_default, tier: "free" },
  "english-oak": { name: "English Oak", spec: english_oak_treespec_default, tier: "dlc" },
  "cherry-blossom": { name: "Cherry Blossom", spec: cherry_blossom_treespec_default, tier: "dlc" },
  "baobab": { name: "Baobab", spec: baobab_treespec_default, tier: "dlc" },
  "black-pine": { name: "Japanese Black Pine", spec: black_pine_treespec_default, tier: "dlc" },
  "weeping-willow": { name: "Weeping Willow", spec: weeping_willow_treespec_default, tier: "dlc" }
};
export {
  banyan_treespec_default as BANYAN_SPEC,
  QUALITY,
  SCENES,
  SPECIES,
  arcTable,
  buildBlossomGeometry,
  buildBlossoms,
  buildExportGroup,
  buildLeafGeometry,
  buildLeaves,
  buildTuftGeometry,
  buildWoodGeometry,
  computeFrames,
  createSceneRig,
  exportGLB,
  fbm,
  flareAt,
  gradeLeafColors,
  growSkeleton,
  hashN,
  ihash01,
  makeBarkMaterial,
  makeBlossomMaterial,
  makeLeafMaterial,
  mulberry32,
  quality,
  rand,
  reseed,
  restyleBark,
  rr,
  rrOf,
  setupPicking,
  tubeGeometry,
  vnoise
};
