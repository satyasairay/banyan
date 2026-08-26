// Picking: hover cursor + click -> HUD (leaf id, world pos, branch/depth/parent)
// + 600 ms pulse highlight. State accessors keep it decoupled from build().
import * as THREE from 'three';

export function setupPicking({ renderer, camera, hud, getState }){
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerDirty = false;
  let hovering = false;
  const pulses = [];   // {id, start}
  const HI = new THREE.Color(2.5, 2.25, 0.75);

  function setPointer(e){
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
    pointerNdc.y = -((e.clientY - rect.top)/rect.height)*2 + 1;
  }
  function pickLeaf(){
    const { leaves } = getState();
    if (!leaves) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(leaves, false);
    return hits.length ? hits[0] : null;
  }

  renderer.domElement.addEventListener('pointermove', (e)=>{ setPointer(e); pointerDirty = true; });

  let downX = 0, downY = 0, downT = 0;
  renderer.domElement.addEventListener('pointerdown', (e)=>{ downX = e.clientX; downY = e.clientY; downT = performance.now(); });
  renderer.domElement.addEventListener('pointerup', (e)=>{
    const moved = Math.hypot(e.clientX-downX, e.clientY-downY);
    if (moved > 6 || performance.now()-downT > 450) return;
    setPointer(e);
    const hit = pickLeaf();
    if (!hit || hit.instanceId === undefined) return;
    const { leaves, leafBranch, branches } = getState();
    const id = hit.instanceId;
    const m = new THREE.Matrix4();
    leaves.getMatrixAt(id, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(leaves.matrixWorld);
    const bid = leafBranch[id];
    const br = branches[bid];
    hud.innerHTML =
      `LEAF   #${id}\n` +
      `world  (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})\n` +
      `branch B${bid} <span class="dim">&middot; depth ${br.depth} &middot; parent B${br.parent}</span>`;
    console.log(`[banyan] leaf #${id} | world (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) | branch B${bid}`);
    // restart pulse if already running
    const existing = pulses.find(q=> q.id === id);
    if (existing) existing.start = performance.now();
    else pulses.push({ id, start: performance.now() });
  });

  const tmpCol = new THREE.Color(), baseCol = new THREE.Color();
  function updatePulses(now){
    const { leaves, leafBaseColor } = getState();
    if (!pulses.length || !leaves) return;
    let write = false;
    for(let i=pulses.length-1; i>=0; i--){
      const q = pulses[i];
      const e = (now - q.start)/600;
      baseCol.setRGB(leafBaseColor[q.id*3], leafBaseColor[q.id*3+1], leafBaseColor[q.id*3+2]);
      if (e >= 1){
        leaves.setColorAt(q.id, baseCol);
        pulses.splice(i, 1);
      } else {
        const s = Math.sin(Math.min(e,1)*Math.PI);
        tmpCol.copy(baseCol).lerp(HI, s*0.92);
        leaves.setColorAt(q.id, tmpCol);
      }
      write = true;
    }
    if (write) leaves.instanceColor.needsUpdate = true;
  }

  function updateHover(){
    if (!pointerDirty) return;
    pointerDirty = false;
    const hit = pickLeaf();
    const h = !!hit;
    if (h !== hovering){
      hovering = h;
      renderer.domElement.style.cursor = h ? 'pointer' : '';
    }
  }

  return { pulses, updatePulses, updateHover };
}
