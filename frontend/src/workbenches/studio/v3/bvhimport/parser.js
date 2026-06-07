// ArchDisc Studio V3 — Real .bvh motion-capture parser (slice 887).
//
// Implements the Biovision Hierarchy (BVH) text-format spec as used by
// Mixamo, the CMU Mocap library, Motion Capture Society sample sets,
// MotionBuilder export, and most consumer mocap rigs (Xsens / Rokoko /
// Perception Neuron all support .bvh).
//
// Format reminder:
//
//   HIERARCHY
//   ROOT Hips
//   {
//     OFFSET  0.0 0.0 0.0
//     CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
//     JOINT Spine
//     {
//       OFFSET  0.0 10.0 0.0
//       CHANNELS 3 Zrotation Xrotation Yrotation
//       JOINT Chest { ... }
//       End Site
//       {
//         OFFSET 0.0 5.0 0.0
//       }
//     }
//   }
//   MOTION
//   Frames: 240
//   Frame Time: 0.0333333
//   <frame 0 channels>
//   <frame 1 channels>
//   ...
//
// We tokenize on whitespace + braces, walk the hierarchy recursively,
// then read the flat MOTION matrix and split it back out by per-joint
// channel order. No eval / new Function — pure JS.

// ── Tokenizer ───────────────────────────────────────────────────────

// Splits a BVH source into ordered tokens. Braces are their own tokens
// regardless of whitespace ("{" attached to a joint name is still its
// own token), as are newlines (used to detect the end of CHANNELS).
export function tokenize(text) {
  if (typeof text !== 'string') return [];
  const toks = [];
  const len = text.length;
  let i = 0;
  let buf = '';
  const flush = () => { if (buf.length) { toks.push(buf); buf = ''; } };
  while (i < len) {
    const c = text[i];
    if (c === '{' || c === '}') {
      flush();
      toks.push(c);
      i++;
      continue;
    }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { flush(); i++; continue; }
    if (c === ' ' || c === '\t') { flush(); i++; continue; }
    buf += c;
    i++;
  }
  flush();
  return toks;
}

// ── HIERARCHY recursive parse ───────────────────────────────────────

// A skeleton node:
//   { name, type: 'root'|'joint'|'end', offset:[x,y,z], channels:[…],
//     channelIndex (offset into MOTION row), children:[…], parent }
//
// `channels` is a list like ['Xposition','Yposition','Zposition',
// 'Zrotation','Xrotation','Yrotation']. End Site nodes carry no
// channels.

function _expect(toks, idx, want) {
  if (idx >= toks.length) throw new Error(`unexpected EOF (wanted "${want}")`);
  if (toks[idx] !== want) {
    throw new Error(`expected "${want}" at token ${idx} ("${toks[idx]}")`);
  }
  return idx + 1;
}

function _readFloat(toks, idx) {
  if (idx >= toks.length) throw new Error('unexpected EOF in float');
  const v = Number(toks[idx]);
  if (!Number.isFinite(v)) throw new Error(`bad float "${toks[idx]}" at token ${idx}`);
  return [v, idx + 1];
}

function _readInt(toks, idx) {
  const [v, ni] = _readFloat(toks, idx);
  return [Math.trunc(v), ni];
}

// Parse a single OFFSET <x> <y> <z> triple, returning [offset, nextIdx].
function _parseOffset(toks, idx) {
  idx = _expect(toks, idx, 'OFFSET');
  const [x, i1] = _readFloat(toks, idx);
  const [y, i2] = _readFloat(toks, i1);
  const [z, i3] = _readFloat(toks, i2);
  return [[x, y, z], i3];
}

// Parse CHANNELS <N> <ch1> <ch2> ... <chN>.
function _parseChannels(toks, idx) {
  idx = _expect(toks, idx, 'CHANNELS');
  const [n, i1] = _readInt(toks, idx);
  if (n < 0 || n > 9) throw new Error(`bad CHANNELS count ${n} at token ${idx}`);
  const chans = [];
  let cur = i1;
  for (let k = 0; k < n; k++) {
    if (cur >= toks.length) throw new Error('unexpected EOF in CHANNELS');
    chans.push(toks[cur]);
    cur++;
  }
  return [chans, cur];
}

// Recursively parse a JOINT / ROOT / End Site block, starting at the
// token immediately AFTER the JOINT/ROOT/End-Site keyword.
//
// Returns [node, nextIdx].
function _parseNode(toks, idx, type, parent) {
  let name;
  if (type === 'end') {
    name = 'EndSite';
    idx = _expect(toks, idx, 'Site');
  } else {
    if (idx >= toks.length) throw new Error('unexpected EOF — joint name');
    name = toks[idx]; idx++;
  }
  idx = _expect(toks, idx, '{');
  const node = {
    name,
    type,
    offset: [0, 0, 0],
    channels: [],
    channelIndex: -1,
    children: [],
    parent: parent || null,
  };
  while (idx < toks.length && toks[idx] !== '}') {
    const t = toks[idx];
    if (t === 'OFFSET') {
      const [off, ni] = _parseOffset(toks, idx);
      node.offset = off;
      idx = ni;
    } else if (t === 'CHANNELS') {
      const [chs, ni] = _parseChannels(toks, idx);
      node.channels = chs;
      idx = ni;
    } else if (t === 'JOINT') {
      idx++;
      const [child, ni] = _parseNode(toks, idx, 'joint', node);
      node.children.push(child);
      idx = ni;
    } else if (t === 'End') {
      idx++;
      const [child, ni] = _parseNode(toks, idx, 'end', node);
      node.children.push(child);
      idx = ni;
    } else {
      throw new Error(`unexpected token "${t}" inside ${type} ${name}`);
    }
  }
  idx = _expect(toks, idx, '}');
  return [node, idx];
}

// Walk the tree in depth-first order and assign each JOINT/ROOT node
// a `channelIndex` (column in the MOTION matrix), then return the
// total channel count.
function _layoutChannels(root) {
  let cursor = 0;
  const flat = [];
  const walk = (n) => {
    if (n.type !== 'end') {
      n.channelIndex = cursor;
      cursor += n.channels.length;
      flat.push(n);
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return { totalChannels: cursor, jointsInOrder: flat };
}

// ── Top-level parser ───────────────────────────────────────────────

// Parse a full .bvh source string. Returns
//   { ok, skeleton, motion }
// where
//   skeleton = { root, joints: [name → node], jointsInOrder, totalChannels }
//   motion   = { frameCount, frameTime, frames: Float32Array (flat row-major) }
//
// On failure: { ok: false, error }.
export function parseBVH(text) {
  if (typeof text !== 'string' || !text.length) {
    return { ok: false, error: 'empty input' };
  }
  let toks;
  try { toks = tokenize(text); } catch (e) { return { ok: false, error: `tokenize: ${e.message}` }; }
  if (!toks.length) return { ok: false, error: 'no tokens' };

  let idx = 0;
  try {
    idx = _expect(toks, idx, 'HIERARCHY');
    if (idx >= toks.length || toks[idx] !== 'ROOT') {
      return { ok: false, error: 'expected ROOT at start of hierarchy' };
    }
    idx++;
    const [root, ni] = _parseNode(toks, idx, 'root', null);
    idx = ni;
    const layout = _layoutChannels(root);

    // Build name → node map.
    const joints = Object.create(null);
    const namesInOrder = [];
    const walk = (n) => {
      if (n.type !== 'end') {
        // Disambiguate duplicate names — give the second instance a "#2" suffix.
        let key = n.name;
        if (joints[key]) {
          let k = 2;
          while (joints[`${key}#${k}`]) k++;
          key = `${key}#${k}`;
        }
        joints[key] = n;
        n.uniqueName = key;
        namesInOrder.push(key);
      }
      for (const c of n.children) walk(c);
    };
    walk(root);

    // MOTION block.
    idx = _expect(toks, idx, 'MOTION');
    idx = _expect(toks, idx, 'Frames:');
    const [frameCount, i1] = _readInt(toks, idx);
    idx = i1;
    idx = _expect(toks, idx, 'Frame');
    idx = _expect(toks, idx, 'Time:');
    const [frameTime, i2] = _readFloat(toks, idx);
    idx = i2;

    const total = layout.totalChannels;
    if (frameCount < 0 || total <= 0) {
      return { ok: false, error: `invalid frame layout (${frameCount} × ${total})` };
    }
    const need = frameCount * total;
    const frames = new Float32Array(need);
    let cur = idx;
    for (let f = 0; f < frameCount; f++) {
      const row = f * total;
      for (let c = 0; c < total; c++) {
        if (cur >= toks.length) {
          return {
            ok: false,
            error: `truncated MOTION block (frame ${f}, channel ${c}, have ${cur}/${toks.length})`,
          };
        }
        const v = Number(toks[cur]);
        if (!Number.isFinite(v)) {
          return { ok: false, error: `bad motion value "${toks[cur]}" at frame ${f} ch ${c}` };
        }
        frames[row + c] = v;
        cur++;
      }
    }

    return {
      ok: true,
      skeleton: {
        root,
        joints,
        jointsInOrder: layout.jointsInOrder,
        namesInOrder,
        totalChannels: total,
      },
      motion: { frameCount, frameTime, frames },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Channel-order helpers ───────────────────────────────────────────

// Given a joint's channel list + the flat frame row, return
// { position?: [x,y,z], rotationOrder: 'ZXY'|..., rotation: [rx,ry,rz] (degrees) }.
//
// Channel order is preserved from the file — rotations are returned in
// the file's order so the caller can compose them right (most Mixamo
// rigs are ZXY, CMU is ZXY too, MotionBuilder export is often ZYX).
export function readJointSample(joint, row) {
  if (!joint || joint.type === 'end') return null;
  const chs = joint.channels;
  const base = joint.channelIndex;
  if (base < 0) return null;
  let px = null, py = null, pz = null;
  let rx = 0, ry = 0, rz = 0;
  let rotOrder = '';
  for (let i = 0; i < chs.length; i++) {
    const v = row[base + i];
    const c = chs[i];
    if (c === 'Xposition') px = v;
    else if (c === 'Yposition') py = v;
    else if (c === 'Zposition') pz = v;
    else if (c === 'Xrotation') { rx = v; rotOrder += 'X'; }
    else if (c === 'Yrotation') { ry = v; rotOrder += 'Y'; }
    else if (c === 'Zrotation') { rz = v; rotOrder += 'Z'; }
    // Anything else (unknown channel) is silently skipped, but its
    // column was still consumed because base+i still indexes into it.
  }
  const out = { rotation: [rx, ry, rz], rotationOrder: rotOrder || 'ZXY' };
  if (px !== null || py !== null || pz !== null) {
    out.position = [px ?? 0, py ?? 0, pz ?? 0];
  }
  return out;
}

// Read a single frame as { jointUniqueName → sample } for diagnostics
// and the __studioBVHPlay frame-by-frame surface.
export function readFrame(parsed, frameIndex) {
  if (!parsed?.ok && parsed?.skeleton == null) return null;
  const skel = parsed.skeleton || parsed;
  const motion = parsed.motion;
  if (!skel || !motion) return null;
  const { frameCount, frames } = motion;
  if (frameIndex < 0 || frameIndex >= frameCount) return null;
  const total = skel.totalChannels;
  const row = frames.subarray(frameIndex * total, frameIndex * total + total);
  const out = Object.create(null);
  for (const j of skel.jointsInOrder) {
    const s = readJointSample(j, row);
    if (s) out[j.uniqueName || j.name] = s;
  }
  return out;
}

// Build a compact JSON-serialisable "clip" form — bone names, channel
// orders, and the raw float matrix. Drops parent/children cycles.
export function exportClip(parsed) {
  if (!parsed?.ok) return null;
  const { skeleton, motion } = parsed;
  const bones = skeleton.jointsInOrder.map((j) => ({
    name: j.uniqueName || j.name,
    parent: j.parent ? (j.parent.uniqueName || j.parent.name) : null,
    offset: j.offset.slice(),
    channels: j.channels.slice(),
    channelIndex: j.channelIndex,
    type: j.type,
  }));
  return {
    bones,
    totalChannels: skeleton.totalChannels,
    frameCount: motion.frameCount,
    frameTime: motion.frameTime,
    frames: motion.frames, // Float32Array — kept by reference; copy at I/O boundary if needed
  };
}

export default parseBVH;
