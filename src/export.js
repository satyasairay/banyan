// GLB export (SS1.4 #9) -- VERTEX-COLOR-ONLY, and honestly so:
// the procedural GLSL bark relief and the leaf vein/backlight shading are
// computed in-shader and CANNOT survive glTF. What exports cleanly:
//   - the full wood mesh with its ambient-occlusion vertex colors
//   - every leaf blade baked to real geometry with its per-instance color
//     as COLOR_0 vertex colors
//   - every blossom cluster baked the same way (cherry family; Phase 4)
//   - plain PBR materials (mid-bark base tone; double-sided leaves/blossoms)
// A bake-bark-to-texture path is a possible future upgrade (see roadmap SS1.4 #9).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* Bake one InstancedMesh (leaves or blossoms) into a single vertex-colored
   geometry: every instance matrix is applied to a clone of the source blade,
   and its per-instance color becomes COLOR_0. colorBoost lifts albedo to
   approximate the engine sheen/backlight that plain glTF PBR cannot carry. */
function bakeInstances(inst, colorBoost = 1){
  const src = inst.geometry;
  const vertsPer = src.getAttribute('position').count;
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const parts = [];
  for (let i = 0; i < inst.count; i++){
    inst.getMatrixAt(i, m);
    const g = src.clone().applyMatrix4(m);
    if (inst.instanceColor){
      col.fromBufferAttribute(inst.instanceColor, i);
      col.r = Math.min(1, col.r*colorBoost); col.g = Math.min(1, col.g*colorBoost); col.b = Math.min(1, col.b*colorBoost);
    } else col.set(1, 1, 1);
    const colors = new Float32Array(vertsPer * 3);
    for (let v = 0; v < vertsPer; v++){ colors[v*3] = col.r; colors[v*3+1] = col.g; colors[v*3+2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  parts.forEach(g => g.dispose());
  return merged;
}

/* Build an export-ready Group from a built tree.
   leafColorBoost: plain PBR viewers lack the engine sheen/clearcoat/backlight,
   so raw leaf albedo reads darker than the live render. The default 1.35 lift
   approximates the engine perceived brightness; pass 1.0 for untouched colors. */
export function buildExportGroup({ woodGeometry, leaves, blossoms, spec, leafColorBoost = 1.35 }){
  const group = new THREE.Group();
  group.name = `banyan-seed-${spec.seed}`;

  // ---- wood: keep the AO vertex colors, tint with the bark ridge tone ----
  const bark = spec.bark;
  const woodMat = new THREE.MeshStandardMaterial({
    name: 'bark-vertexcolor',
    color: new THREE.Color(bark.ridge[0], bark.ridge[1], bark.ridge[2]),
    vertexColors: true, roughness: 0.87, metalness: 0.0
  });
  const wood = new THREE.Mesh(woodGeometry.clone(), woodMat);
  wood.name = 'wood';
  group.add(wood);

  // ---- leaves: bake every instance into one geometry, color -> COLOR_0 ----
  if (leaves && leaves.count > 0){
    const leafMesh = new THREE.Mesh(bakeInstances(leaves, leafColorBoost), new THREE.MeshStandardMaterial({
      name: 'leaf-vertexcolor',
      color: 0xffffff, vertexColors: true,
      roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide
    }));
    leafMesh.name = 'leaves';
    group.add(leafMesh);
  }

  // ---- blossoms: same bake (cherry family second instancer; Phase 4) ----
  if (blossoms && blossoms.count > 0){
    const blossomMesh = new THREE.Mesh(bakeInstances(blossoms, 1.0), new THREE.MeshStandardMaterial({
      name: 'blossom-vertexcolor',
      color: 0xffffff, vertexColors: true,
      roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide
    }));
    blossomMesh.name = 'blossoms';
    group.add(blossomMesh);
  }
  return group;
}

/* Export a built tree as a GLB ArrayBuffer. */
export function exportGLB({ woodGeometry, leaves, blossoms, spec, leafColorBoost }){
  const group = buildExportGroup({ woodGeometry, leaves, blossoms, spec, leafColorBoost });
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject)=>{
    exporter.parse(group,
      (result)=> resolve(result),           // ArrayBuffer when binary:true
      (err)=> reject(err),
      { binary: true });
  });
}
