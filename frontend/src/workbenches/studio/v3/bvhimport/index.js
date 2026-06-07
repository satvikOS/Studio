// ArchDisc Studio V3 — Motion-capture .bvh import + player (slice 887).
//
// Closes the "no mocap input" parity gap. Exposes four ops:
//
//   __studioBVHParse({text})                → parse a BVH source string.
//   __studioBVHImportFromUrl({url, key?})   → fetch + parse + cache as a clip.
//   __studioBVHPlay({clipKey, armatureUuid, frame}) → apply one frame.
//   __studioBVHList()                       → list cached clips + meta.
//
// In addition to the four required ops we expose two diagnostic ops
// (BuildMap / Delete) so callers can preview a match without playing
// any frame, and free a clip when done.

import { registerOps } from '../common/registry.js';
import { parseBVH, exportClip } from './parser.js';
import { applyClipFrame, buildBoneMap, collectBones } from './player.js';

let _installed = false;

// Clip cache: clipKey → { clip (exportClip output), source, sizeBytes }.
const _clips = new Map();

function _autoKey(prefix) {
  let i = 1;
  let k = `${prefix}_${i}`;
  while (_clips.has(k)) { i++; k = `${prefix}_${i}`; }
  return k;
}

function _meta(key) {
  const e = _clips.get(key);
  if (!e) return null;
  const c = e.clip;
  return {
    key,
    frameCount: c.frameCount,
    frameTime: c.frameTime,
    boneCount: c.bones.length,
    totalChannels: c.totalChannels,
    sizeBytes: e.sizeBytes,
    source: e.source,
  };
}

// ── Op implementations ─────────────────────────────────────────────

function opParse({ text, key } = {}) {
  if (typeof text !== 'string' || !text.length) {
    return { ok: false, error: 'text must be a non-empty string' };
  }
  const r = parseBVH(text);
  if (!r.ok) return { ok: false, error: r.error };
  const clip = exportClip(r);
  const k = key || _autoKey('bvh');
  _clips.set(k, { clip, source: 'parse', sizeBytes: text.length });
  return {
    ok: true,
    clipKey: k,
    skeleton: {
      root: r.skeleton.root.name,
      boneCount: r.skeleton.jointsInOrder.length,
      names: r.skeleton.namesInOrder.slice(),
      totalChannels: r.skeleton.totalChannels,
    },
    clip: {
      frameCount: r.motion.frameCount,
      frameTime: r.motion.frameTime,
      durationSec: r.motion.frameCount * r.motion.frameTime,
    },
  };
}

async function opImportFromUrl({ url, key } = {}) {
  if (typeof url !== 'string' || !url.length) {
    return { ok: false, error: 'url must be a non-empty string' };
  }
  let text;
  try {
    if (typeof fetch !== 'function') return { ok: false, error: 'fetch is not available' };
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `fetch ${url} returned HTTP ${res.status}` };
    text = await res.text();
  } catch (e) {
    return { ok: false, error: `fetch failed: ${e?.message || String(e)}` };
  }
  const r = opParse({ text, key });
  if (r.ok) {
    const entry = _clips.get(r.clipKey);
    if (entry) entry.source = url;
  }
  return r;
}

function opPlay({ clipKey, armatureUuid, frame } = {}) {
  if (!clipKey || !_clips.has(clipKey)) return { ok: false, error: `unknown clipKey "${clipKey}"` };
  if (typeof armatureUuid !== 'string') return { ok: false, error: 'armatureUuid required' };
  const f = Math.trunc(Number(frame || 0));
  if (!Number.isFinite(f)) return { ok: false, error: 'frame must be a finite integer' };
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) return { ok: false, error: 'no scene' };
  const entry = _clips.get(clipKey);
  return applyClipFrame(entry.clip, scene, armatureUuid, f);
}

function opList() {
  const out = [];
  for (const k of _clips.keys()) {
    const m = _meta(k);
    if (m) out.push(m);
  }
  return { ok: true, count: out.length, clips: out };
}

function opBuildMap({ clipKey, armatureUuid } = {}) {
  if (!clipKey || !_clips.has(clipKey)) return { ok: false, error: `unknown clipKey "${clipKey}"` };
  if (typeof armatureUuid !== 'string') return { ok: false, error: 'armatureUuid required' };
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) return { ok: false, error: 'no scene' };
  const bones = collectBones(scene, armatureUuid);
  if (!bones.length) return { ok: false, error: 'no bones under armature' };
  const entry = _clips.get(clipKey);
  const clipBones = entry.clip.bones.filter((b) => b.type !== 'end').map((b) => b.name);
  const map = buildBoneMap(clipBones, bones);
  return { ok: true, ...map, clipBoneCount: clipBones.length, armatureBoneCount: bones.length };
}

function opDelete({ clipKey } = {}) {
  if (!clipKey) return { ok: false, error: 'clipKey required' };
  const had = _clips.delete(clipKey);
  return { ok: true, removed: had };
}

// ── Install entry ─────────────────────────────────────────────────

export function installBVHImport() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioBVHParse: [
      opParse,
      'Parse a .bvh source string and cache the resulting clip.',
    ],
    __studioBVHImportFromUrl: [
      opImportFromUrl,
      'Fetch a .bvh file from a URL and parse it into a cached clip.',
    ],
    __studioBVHPlay: [
      opPlay,
      'Apply one frame of a cached clip onto the named armature.',
    ],
    __studioBVHList: [
      opList,
      'List every cached .bvh clip with its frame count, frame time, bones.',
    ],
    __studioBVHBuildMap: [
      opBuildMap,
      'Preview the bone-name fuzzy match for a clip + armature.',
    ],
    __studioBVHDelete: [
      opDelete,
      'Remove a cached .bvh clip.',
    ],
  };
  registerOps(ops, 'mocap', 'Motion-capture .bvh import + player');
  return { ok: true };
}

export default installBVHImport;
