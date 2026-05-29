/**
 * ArchDisc Studio — Clarifier.
 *
 * Picks the highest-leverage clarifying questions for a Studio 3D
 * authoring prompt before the planner emits a plan. Works without an
 * LLM via a static decision-tree keyed on the prompt's domain
 * (modeling / sculpting / texturing / rigging / animation / vfx-sim /
 * rendering / compositing). A connected provider can be asked for
 * sharper follow-up questions later — the static fallback always
 * works so the loop never blocks on the user.
 *
 * Usage:
 *   const { domain, kit } = pickClarificationKit(userPrompt);
 *   const answered = await uiAskUser(kit.questions);
 *   const merged   = applyAnswers(kit, answered);
 *   await planFor({ userPrompt, clarifications: merged, domain });
 */

const DOMAIN_KEYWORDS = {
  modeling: [
    'model', 'cube', 'sphere', 'mesh', 'low poly', 'high poly',
    'hardsurface', 'hard surface', 'primitive', 'box modeling',
    'subdivision', 'topology',
  ],
  sculpting: [
    'sculpt', 'zbrush', 'organic', 'character', 'creature', 'bust',
    'clay', 'dynamesh', 'multires', 'brush', 'mask',
    'rock', 'boulder', 'terrain bump',
  ],
  'uv-texture': [
    'uv', 'unwrap', 'texture', 'pbr', 'substance', 'mari',
    'paint', 'roughness', 'metalness', 'normal map', 'albedo',
    'bake', 'udim',
  ],
  rigging: [
    'rig', 'rigging', 'armature', 'bone', 'skeleton',
    'ik', 'fk', 'skin weight', 'pose',
  ],
  animation: [
    'animate', 'keyframe', 'animation', 'walk cycle', 'spin',
    'turntable', 'timeline', 'sequencer', 'cinematic',
  ],
  'vfx-sim': [
    'simulation', 'sim', 'physics', 'cloth', 'softbody',
    'fluid', 'smoke', 'fire', 'particles', 'niagara', 'fracture',
    'destruction',
  ],
  rendering: [
    'render', 'cycles', 'eevee', 'lookdev', 'hdri',
    'light', 'lighting', 'lookbook', 'product viz',
    'archviz', 'arch viz', 'visualization',
  ],
  compositing: [
    'comp', 'compositing', 'bloom', 'vignette', 'dof',
    'chromatic', 'film grain', 'lens flare', 'tone map', 'post',
  ],
};

/** Score the prompt against each Studio discipline. */
export function detectDomain(prompt) {
  if (!prompt) return { domain: 'modeling', confidence: 0 };
  const p = prompt.toLowerCase();
  let best = { domain: 'modeling', confidence: 0 };
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let hits = 0;
    for (const k of keywords) if (p.includes(k.toLowerCase())) hits++;
    const conf = hits / keywords.length;
    if (conf > best.confidence) best = { domain, confidence: conf, hits };
  }
  return best;
}

const KITS = {
  modeling: {
    name: 'Modeling / hard-surface',
    questions: [
      { id: 'reference', q: 'Reference image / file URL (or "none")?',  required: false, default: 'none', type: 'string' },
      { id: 'primary_kind', q: 'Primary primitive kind?',                required: true,  default: 'cube', type: 'enum',
        options: ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'torus-knot', 'icosahedron', 'plane', 'suzanne'] },
      { id: 'body_count',   q: 'Approximate body count?',                required: true,  default: 3, type: 'number' },
      { id: 'palette',      q: 'Colour palette?',                        required: false, default: 'natural',  type: 'enum',
        options: ['natural', 'monochrome', 'pastel', 'neon', 'metallic'] },
      { id: 'symmetry',     q: 'Symmetric build?',                       required: false, default: 'yes', type: 'enum',
        options: ['yes', 'no'] },
    ],
  },
  sculpting: {
    name: 'Sculpting / organic',
    questions: [
      { id: 'subject',      q: 'Subject (creature / character / prop / terrain)?',  required: true,  default: 'rock formation', type: 'string' },
      { id: 'base_mesh',    q: 'Base mesh kind?',                                    required: true,  default: 'icosahedron',     type: 'enum',
        options: ['icosahedron', 'sphere', 'voxel-sphere', 'suzanne', 'cube'] },
      { id: 'brush_radius', q: 'Brush radius (0-1 of body size)?',                   required: false, default: 0.15, type: 'number' },
      { id: 'brush_mode',   q: 'Primary brush?',                                     required: false, default: 'draw', type: 'enum',
        options: ['draw', 'inflate', 'crease', 'pinch', 'flatten', 'grab', 'smooth'] },
      { id: 'weathering',   q: 'Apply weathering / erosion?',                        required: false, default: 'medium', type: 'enum',
        options: ['none', 'light', 'medium', 'heavy'] },
    ],
  },
  'uv-texture': {
    name: 'Texturing / UV',
    questions: [
      { id: 'pbr_target',     q: 'PBR target?',                  required: true,  default: 'metallic-roughness', type: 'enum',
        options: ['metallic-roughness', 'specular-glossiness'] },
      { id: 'tile_density',   q: 'Texture tile density (1-8)?',  required: false, default: 2, type: 'number' },
      { id: 'pattern',        q: 'Pattern?',                     required: false, default: 'noise', type: 'enum',
        options: ['noise', 'voronoi', 'wave', 'brick', 'magic', 'color-ramp'] },
      { id: 'bake_passes',    q: 'Bake passes?',                 required: false, default: 'ao+normal', type: 'enum',
        options: ['none', 'ao', 'ao+normal', 'ao+normal+position'] },
    ],
  },
  rigging: {
    name: 'Rigging',
    questions: [
      { id: 'chain_length', q: 'Bone-chain length?', required: true,  default: 6, type: 'number' },
      { id: 'ik',           q: 'Add IK solver?',     required: false, default: 'yes', type: 'enum', options: ['yes', 'no'] },
    ],
  },
  animation: {
    name: 'Animation',
    questions: [
      { id: 'duration_s',  q: 'Duration (s)?',  required: true,  default: 4, type: 'number' },
      { id: 'fps',         q: 'Frame rate?',     required: false, default: 30, type: 'number' },
      { id: 'easing',      q: 'Easing?',         required: false, default: 'bezier', type: 'enum',
        options: ['linear', 'constant', 'bezier'] },
    ],
  },
  'vfx-sim': {
    name: 'VFX / simulation',
    questions: [
      { id: 'sim_kind',     q: 'Simulation kind?', required: true,  default: 'rigidbody', type: 'enum',
        options: ['rigidbody', 'softbody', 'cloth', 'particles', 'ocean', 'fog'] },
      { id: 'duration_s',   q: 'Duration (s)?',    required: false, default: 2, type: 'number' },
    ],
  },
  rendering: {
    name: 'Rendering',
    questions: [
      { id: 'engine',       q: 'Render engine?',          required: true,  default: 'eevee', type: 'enum',
        options: ['eevee', 'cycles', 'workbench'] },
      { id: 'lighting',     q: 'Lighting setup?',         required: false, default: 'three-point', type: 'enum',
        options: ['three-point', 'hdri', 'sun-only', 'cinematic'] },
      { id: 'world',        q: 'World background?',       required: false, default: 'hdri', type: 'enum',
        options: ['hdri', 'solid', 'fog', 'cell'] },
    ],
  },
  compositing: {
    name: 'Compositing / post',
    questions: [
      { id: 'tone_map',     q: 'Tone map?',          required: false, default: 'aces', type: 'enum',
        options: ['aces', 'filmic', 'standard'] },
      { id: 'bloom',        q: 'Add bloom?',         required: false, default: 'yes', type: 'enum', options: ['yes', 'no'] },
      { id: 'vignette',     q: 'Add vignette?',      required: false, default: 'yes', type: 'enum', options: ['yes', 'no'] },
      { id: 'film_grain',   q: 'Film grain?',        required: false, default: 'no',  type: 'enum', options: ['yes', 'no'] },
    ],
  },
};

/** Pick the clarification kit matching the user's prompt. */
export function pickClarificationKit(prompt) {
  const detected = detectDomain(prompt);
  const kit = KITS[detected.domain] || KITS.modeling;
  return { domain: detected.domain, confidence: detected.confidence, kit };
}

/** Merge user answers onto the kit's defaults. */
export function applyAnswers(kit, answers) {
  const merged = {};
  for (const q of kit.questions) {
    merged[q.id] = (answers && q.id in answers && answers[q.id] !== undefined && answers[q.id] !== null)
      ? answers[q.id] : q.default;
  }
  return merged;
}

/** Required questions still unanswered (planner shouldn't start until these resolve). */
export function unansweredRequired(kit, answers) {
  return kit.questions.filter((q) =>
    q.required && (!answers || answers[q.id] === undefined || answers[q.id] === null)
  );
}
