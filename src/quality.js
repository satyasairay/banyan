// Quality presets (SS1.4 #5) -- PERFORMANCE scope only. 'high' is the canonical
// reference output; 'mobile' trades leaf instances / shadow res / tube segments /
// DPR for frame rate. The skeleton generator itself never reads these.
// shadowMapSize is a CAP on the SceneSpec's requested shadow map (Phase 3):
// effective = min(scene.lights[key].shadow.mapSize, preset cap). White Studio
// requests 1024, so 'high' behaves exactly as before; Temple Ruin may use 2048.
export const QUALITY = {
  high:   { leafCap: Infinity, shadowMapSize: 2048, maxRadialSegs: 26, pixelRatioCap: 2   },
  mobile: { leafCap: 3400,     shadowMapSize: 512,  maxRadialSegs: 14, pixelRatioCap: 1.5 }
};

export function quality(S){
  const q = (S.quality && S.quality !== 'auto') ? S.quality
          : ((typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 760) ? 'mobile' : 'high');
  return QUALITY[q] || QUALITY.high;
}
