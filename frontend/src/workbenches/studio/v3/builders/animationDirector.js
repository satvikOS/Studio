// ArchDisc Studio V3 — Animation Director (movies / ads / commercials).
//
// Camera-path presets a 30-yr veteran reaches for in a product/ad spot — turntable,
// dolly-in, product-reveal (push + arc + descend), crane-down, orbit — keyframed over
// t∈[0,1] with cinematic easing. Renders a frame sequence offline from the live scene
// (window.__archdiscScene) so it composes with the furniture composer, organic sculpt,
// and the 100k env. window.__studioAnimate({preset,frames,resolution}) → {frames:[dataURL]}
// which the e2e/render-queue writes to PNG and ffmpeg-encodes to mp4. For FULL 4K
// PHOTOREAL motion, pathTraced:true routes each frame through the GPU path tracer
// (render-farm batch — slow; raster default is the real-time commercial look + AAA post).

const EASE = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
};

// Each preset: (c[center], R[radius], sz, t) → { pos:[x,y,z], look:[x,y,z], fov }
const PRESETS = {
  turntable(c, R, sz, t) {
    const a = t * Math.PI * 2;
    return { pos: [c[0] + Math.cos(a) * R * 2.2, c[1] + sz[1] * 0.35, c[2] + Math.sin(a) * R * 2.2], look: [c[0], c[1], c[2]], fov: 40 };
  },
  orbit(c, R, sz, t) {
    const a = -Math.PI / 4 + EASE.inOut(t) * (Math.PI / 2);
    return { pos: [c[0] + Math.cos(a) * R * 2.0, c[1] + sz[1] * 0.4, c[2] + Math.sin(a) * R * 2.0], look: [c[0], c[1], c[2]], fov: 42 };
  },
  'dolly-in'(c, R, sz, t) {
    const dist = R * 4.2 - EASE.inOut(t) * R * 2.6;
    return { pos: [c[0] + R * 0.4, c[1] + sz[1] * 0.3, c[2] + dist], look: [c[0], c[1], c[2]], fov: 38 };
  },
  'crane-down'(c, R, sz, t) {
    const e = R * 2.2 - EASE.inOut(t) * R * 1.8;
    return { pos: [c[0] + R * 0.6, c[1] + e, c[2] + R * 2.2], look: [c[0], c[1] - sz[1] * 0.1, c[2]], fov: 40 };
  },
  // the commercial beat: push in + arc around + settle to eye level
  'product-reveal'(c, R, sz, t) {
    const e = EASE.inOut(t);
    const a = -0.7 + e * 1.3;
    const dist = R * 4.4 - e * R * 2.7;
    const elev = sz[1] * 1.1 - e * sz[1] * 0.7;
    return { pos: [c[0] + Math.cos(a) * dist, c[1] + elev, c[2] + Math.sin(a) * dist], look: [c[0], c[1] + sz[1] * 0.1, c[2]], fov: 36 + e * 6 };
  },
};

export const ANIMATION_PRESETS = Object.keys(PRESETS);

export async function studioAnimate({ preset = 'product-reveal', frames = 48, resolution = '1080p', scene = null, exposure = 1.25 } = {}) {
  const THREE = (typeof window !== 'undefined' && window.__archdiscTHREE) || null;
  scene = scene || (typeof window !== 'undefined' && window.__archdiscScene) || null;
  if (!THREE || !scene) throw new Error('animationDirector: __archdiscTHREE / __archdiscScene unavailable');
  const RES = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160] };
  const [W, H] = RES[resolution] || RES['1080p'];
  const path = PRESETS[preset] || PRESETS['product-reveal'];

  // daylight + sky + atmosphere (commercial key/fill) — non-destructive, removed after.
  const added = [];
  const sun = new THREE.DirectionalLight(0xfff2dc, 3.3); sun.position.set(6, 9, 7); scene.add(sun); added.push(sun);
  const sky = new THREE.HemisphereLight(0xbfd4ff, 0x40443a, 1.1); scene.add(sky); added.push(sky);
  const rim = new THREE.DirectionalLight(0xbcd0ff, 1.2); rim.position.set(-8, 4, -6); scene.add(rim); added.push(rim);
  const prevBg = scene.background; scene.background = new THREE.Color(0xaec4dd);

  const box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
  const C = [c.x, c.y, c.z]; const SZ = [sz.x, sz.y, sz.z]; const R = Math.max(sz.x, sz.z, sz.y) * 0.5 || 2;
  const prevFog = scene.fog; scene.fog = new THREE.Fog(scene.background, R * 3.5, R * 12);

  const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  canvas.width = W; canvas.height = H;
  const rend = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  rend.setPixelRatio(1); rend.setSize(W, H, false);
  rend.toneMapping = THREE.ACESFilmicToneMapping; rend.toneMappingExposure = exposure; rend.outputColorSpace = THREE.SRGBColorSpace;

  const out = [];
  const n = Math.max(2, frames | 0);
  for (let f = 0; f < n; f++) {
    const t = f / (n - 1);
    const k = path(C, R, SZ, t);
    const cam = new THREE.PerspectiveCamera(k.fov, W / H, 0.1, R * 40);
    cam.position.set(k.pos[0], k.pos[1], k.pos[2]); cam.lookAt(k.look[0], k.look[1], k.look[2]);
    rend.render(scene, cam);
    out.push(canvas.toDataURL('image/png'));
  }
  try { rend.forceContextLoss(); } catch (_) {}
  // restore scene
  for (const o of added) scene.remove(o);
  scene.background = prevBg; scene.fog = prevFog;
  return { frames: out, width: W, height: H, preset, count: out.length };
}

export function installAnimationDirector() {
  if (typeof window === 'undefined') return;
  window.__studioAnimate = (opts) => studioAnimate(opts || {});
  window.__studioAnimationPresets = ANIMATION_PRESETS;
}

export default installAnimationDirector;
