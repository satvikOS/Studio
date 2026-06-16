// ArchDisc Studio V3 — Rigging Director (full rig + organic movement).
//
// Real skeletal rigging, not canned clips: builds a THREE bone hierarchy, skins a mesh
// to it with smooth 2-bone blend weights (organic joint deformation, not rigid), and
// drives it with overlapping eased motion — traveling sine waves, phase offsets per
// joint, follow-through — so limbs/spines/tentacles move ORGANICALLY (the 12-principles
// feel: ease, overlap, secondary action) rather than robotically.
//
// window.__studioRig({preset,frames,resolution}) → { frames:[dataURL] } the e2e/render
// queue writes to PNG and ffmpeg-encodes. Presets: tentacle, spine-flex, arm-reach,
// quadruped-step, creature-idle. Composes with the animation director's camera language.

const TAU = Math.PI * 2;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Build a skinned bone-chain limb (tube skinned to a chain of bones along +Y).
function buildChainLimb(THREE, { bones = 8, length = 4, radius = 0.5, taper = 0.45, radial = 16, color = 0x9a6b4f }) {
  const seg = length / bones;
  const heightSeg = bones * 3;
  const geo = new THREE.CylinderGeometry(radius * taper, radius, length, radial, heightSeg, true);
  geo.translate(0, length / 2, 0); // base at origin, grows +Y
  const pos = geo.attributes.position;
  const skinIndex = [], skinWeight = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const fb = Math.max(0, Math.min(bones - 1.0001, y / seg)); // float bone coord
    const b0 = Math.floor(fb), b1 = Math.min(bones - 1, b0 + 1);
    const w1 = fb - b0, w0 = 1 - w1; // smooth blend across the joint → organic bend
    skinIndex.push(b0, b1, 0, 0); skinWeight.push(w0, w1, 0, 0);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const boneArr = []; let prev = null;
  for (let i = 0; i < bones; i++) {
    const b = new THREE.Bone(); b.position.y = i === 0 ? 0 : seg;
    if (prev) prev.add(b); boneArr.push(b); prev = b;
  }
  const skeleton = new THREE.Skeleton(boneArr);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04 });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(boneArr[0]); mesh.bind(skeleton);
  return { mesh, bones: boneArr, seg };
}

// Per-preset pose function: (bones, t∈[0,1]) → set bone rotations (organic).
const PRESETS = {
  tentacle(rig, t) {
    const b = rig.bones; const k = 0.55, amp = 0.42, speed = TAU * 1.5;
    for (let i = 0; i < b.length; i++) {
      b[i].rotation.z = Math.sin(t * speed - i * k) * amp * (0.4 + i / b.length); // wave grows toward tip
      b[i].rotation.x = Math.cos(t * speed * 0.7 - i * k * 1.3) * amp * 0.5 * (i / b.length);
    }
  },
  'spine-flex'(rig, t) {
    const b = rig.bones; const bend = Math.sin(t * TAU) * 0.5;
    for (let i = 0; i < b.length; i++) { b[i].rotation.z = bend * (i / b.length) * 1.1; b[i].rotation.x = Math.sin(t * TAU + i * 0.3) * 0.06; }
  },
  'arm-reach'(rig, t) {
    const b = rig.bones; const e = ease((Math.sin(t * TAU) + 1) / 2); // reach out and back, eased
    // shoulder lifts, mid curls (elbow), tip follows through late (overlap)
    for (let i = 0; i < b.length; i++) {
      const phase = Math.max(0, e - i * 0.06);
      b[i].rotation.z = -0.9 * phase * (1 - i / b.length * 0.4);
      b[i].rotation.x = 0.2 * Math.sin(phase * Math.PI);
    }
  },
  'quadruped-step'(rig, t) {
    const b = rig.bones; for (let i = 0; i < b.length; i++) b[i].rotation.x = Math.sin(t * TAU * 2 - i * 0.5) * 0.3;
  },
  'creature-idle'(rig, t) {
    const b = rig.bones; const breath = Math.sin(t * TAU) * 0.12;
    for (let i = 0; i < b.length; i++) { b[i].rotation.z = Math.sin(t * TAU * 0.5 - i * 0.4) * 0.18 + breath * (i / b.length); b[i].rotation.x = Math.cos(t * TAU * 0.4 - i * 0.3) * 0.1; }
  },
};
export const RIG_PRESETS = Object.keys(PRESETS);

export async function studioRig({ preset = 'tentacle', frames = 60, resolution = '1080p', scene = null } = {}) {
  const THREE = (typeof window !== 'undefined' && window.__archdiscTHREE) || null;
  if (!THREE) throw new Error('rigDirector: __archdiscTHREE unavailable');
  const RES = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160] };
  const [W, H] = RES[resolution] || RES['1080p'];
  const pose = PRESETS[preset] || PRESETS.tentacle;

  const rigScene = new THREE.Scene();
  const SKY = new THREE.Color(0x223040); rigScene.background = SKY;
  rigScene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202020, 1.0));
  const key = new THREE.DirectionalLight(0xfff2dc, 3.2); key.position.set(5, 8, 6); rigScene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 1.4); rim.position.set(-6, 3, -5); rigScene.add(rim);
  const rig = buildChainLimb(THREE, preset === 'arm-reach' ? { bones: 6, length: 4, radius: 0.45 } : { bones: 9, length: 5, radius: 0.55 });
  const root = new THREE.Group(); root.add(rig.mesh);
  // head rides the TIP bone (parented), so it follows the organic bend instead of floating.
  if (preset === 'creature-idle' || preset === 'tentacle') { const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 18), rig.mesh.material); head.position.y = rig.seg * 0.7; rig.bones[rig.bones.length - 1].add(head); }
  rigScene.add(root);
  // ground
  const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; rigScene.add(ground);

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const rend = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  rend.setPixelRatio(1); rend.setSize(W, H, false);
  rend.toneMapping = THREE.ACESFilmicToneMapping; rend.toneMappingExposure = 1.2; rend.outputColorSpace = THREE.SRGBColorSpace;
  const cam = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);

  const out = []; const n = Math.max(2, frames | 0);
  for (let f = 0; f < n; f++) {
    const t = f / n; // looping cycle
    pose(rig, t);
    rig.mesh.skeleton.bones[0].updateMatrixWorld(true);
    // slow hero orbit so motion + form both read
    const a = -0.5 + (f / n) * 0.7;
    cam.position.set(Math.cos(a) * 10, 4.5, Math.sin(a) * 10 + 4); cam.lookAt(0, 2.6, 0);
    rend.render(rigScene, cam);
    out.push(canvas.toDataURL('image/png'));
  }
  try { rend.forceContextLoss(); } catch (_) {}
  return { frames: out, width: W, height: H, preset, count: out.length, bones: rig.bones.length };
}

export function installRigDirector() {
  if (typeof window === 'undefined') return;
  window.__studioRig = (opts) => studioRig(opts || {});
  window.__studioRigPresets = RIG_PRESETS;
}

export default installRigDirector;
