// ArchDisc Studio V3 — REAL Stanford PLY (.ply) parser (slice 890).
//
// Supports both ASCII (`format ascii 1.0`) and binary little-endian
// (`format binary_little_endian 1.0`) flavours emitted by Reality
// Capture / Agisoft Metashape / Meshroom / Pix4D / open-source
// photogrammetry pipelines.
//
// Header grammar (the subset we actually parse — every line a body
// requires):
//
//   ply
//   format <ascii|binary_little_endian|binary_big_endian> <version>
//   comment ...                                 (skipped)
//   element vertex <N>
//   property <type> <name>                      (per-vertex scalar)
//   property list <countType> <itemType> <name> (lists, e.g. vertex_indices)
//   element face <M>
//   property list <countType> <itemType> vertex_indices
//   end_header
//
// Per-vertex props we handle: x, y, z, nx, ny, nz, red, green, blue,
// alpha, scalar_intensity. Anything else is read + discarded so we
// stay aligned for the rest of the row.
//
// The result is a plain `{ positions, normals, colors, indices,
// vertexCount, faceCount, hasNormals, hasColors }` object the index.js
// wrapper converts into a `THREE.BufferGeometry`. Pure JS, no deps.

const NUM_TYPES = new Set([
  'char', 'uchar', 'short', 'ushort', 'int', 'uint',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32',
  'float', 'float32', 'double', 'float64',
]);

// Map a PLY scalar type token to byte size for binary parsing.
function _typeSize(t) {
  switch (t) {
    case 'char': case 'uchar': case 'int8': case 'uint8': return 1;
    case 'short': case 'ushort': case 'int16': case 'uint16': return 2;
    case 'int': case 'uint': case 'int32': case 'uint32': return 4;
    case 'float': case 'float32': return 4;
    case 'double': case 'float64': return 8;
    default: throw new Error(`PLY: unknown type "${t}"`);
  }
}

// DataView read for a PLY scalar type.
function _readScalar(dv, offset, t, littleEndian) {
  switch (t) {
    case 'char': case 'int8':    return [dv.getInt8(offset), 1];
    case 'uchar': case 'uint8':  return [dv.getUint8(offset), 1];
    case 'short': case 'int16':  return [dv.getInt16(offset, littleEndian), 2];
    case 'ushort': case 'uint16':return [dv.getUint16(offset, littleEndian), 2];
    case 'int': case 'int32':    return [dv.getInt32(offset, littleEndian), 4];
    case 'uint': case 'uint32':  return [dv.getUint32(offset, littleEndian), 4];
    case 'float': case 'float32':return [dv.getFloat32(offset, littleEndian), 4];
    case 'double': case 'float64':return [dv.getFloat64(offset, littleEndian), 8];
    default: throw new Error(`PLY: unknown type "${t}"`);
  }
}

// Parse the header into `{ format, elements: [{name, count, props}] }`
// where each prop is `{ kind: 'scalar', name, type } | { kind: 'list',
// name, countType, itemType }`. `headerEnd` is the byte index right
// after `end_header\n` (for binary bodies).
function parsePLYHeader(text) {
  const lines = text.split(/\r?\n/);
  const header = { format: null, version: '1.0', elements: [] };
  let i = 0;
  if (lines[i] && lines[i].trim() !== 'ply') {
    throw new Error('PLY: missing magic "ply" line');
  }
  i++;
  let cur = null;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === 'end_header') { i++; break; }
    if (line === '' || line.startsWith('comment') || line.startsWith('obj_info')) continue;
    const toks = line.split(/\s+/);
    if (toks[0] === 'format') {
      header.format = toks[1];
      header.version = toks[2] || '1.0';
      continue;
    }
    if (toks[0] === 'element') {
      cur = { name: toks[1], count: parseInt(toks[2], 10), props: [] };
      header.elements.push(cur);
      continue;
    }
    if (toks[0] === 'property') {
      if (!cur) throw new Error('PLY: property before element');
      if (toks[1] === 'list') {
        cur.props.push({
          kind: 'list',
          countType: toks[2],
          itemType: toks[3],
          name: toks[4],
        });
      } else {
        if (!NUM_TYPES.has(toks[1])) throw new Error(`PLY: unsupported property type "${toks[1]}"`);
        cur.props.push({ kind: 'scalar', type: toks[1], name: toks[2] });
      }
      continue;
    }
  }
  // Compute the byte offset of end_header in the original text so
  // binary bodies know where to start.
  let bytesBeforeBody = 0;
  for (let k = 0; k < i; k++) bytesBeforeBody += lines[k].length + 1; // + \n
  return { header, bodyStartLineIdx: i, bodyStartByteOffset: bytesBeforeBody };
}

// Build the destination buffer arrays based on the vertex element's
// property set. Returns `{ positions, normals, colors, intensity,
// hasNormals, hasColors, hasIntensity }`.
function _allocVertexBuffers(elem) {
  const N = elem.count;
  const propNames = new Set(elem.props.filter((p) => p.kind === 'scalar').map((p) => p.name));
  const hasNormals = propNames.has('nx') && propNames.has('ny') && propNames.has('nz');
  const hasColors = (propNames.has('red') && propNames.has('green') && propNames.has('blue'))
                 || (propNames.has('r') && propNames.has('g') && propNames.has('b'));
  const hasIntensity = propNames.has('scalar_intensity') || propNames.has('intensity');
  return {
    positions: new Float32Array(N * 3),
    normals: hasNormals ? new Float32Array(N * 3) : null,
    colors: hasColors ? new Float32Array(N * 3) : null,
    intensity: hasIntensity ? new Float32Array(N) : null,
    hasNormals, hasColors, hasIntensity,
  };
}

// Parse the ASCII body. `lines` already excludes the header.
function _parseAsciiVertices(elem, lines, out, lineCursor) {
  const N = elem.count;
  for (let v = 0; v < N; v++) {
    const line = (lines[lineCursor.i] || '').trim();
    lineCursor.i++;
    if (!line) { v--; continue; } // tolerate blank lines
    const toks = line.split(/\s+/);
    let t = 0;
    for (const p of elem.props) {
      if (p.kind === 'list') {
        // Vertex-level lists are rare but if seen, consume the count
        // and then `count` items.
        const cnt = parseInt(toks[t++], 10);
        for (let k = 0; k < cnt; k++) t++;
        continue;
      }
      const val = parseFloat(toks[t++]);
      switch (p.name) {
        case 'x': out.positions[v * 3 + 0] = val; break;
        case 'y': out.positions[v * 3 + 1] = val; break;
        case 'z': out.positions[v * 3 + 2] = val; break;
        case 'nx': if (out.normals) out.normals[v * 3 + 0] = val; break;
        case 'ny': if (out.normals) out.normals[v * 3 + 1] = val; break;
        case 'nz': if (out.normals) out.normals[v * 3 + 2] = val; break;
        case 'red': case 'r':
          if (out.colors) out.colors[v * 3 + 0] = (p.type && (p.type === 'float' || p.type === 'float32' || p.type === 'double' || p.type === 'float64')) ? val : val / 255; break;
        case 'green': case 'g':
          if (out.colors) out.colors[v * 3 + 1] = (p.type && (p.type === 'float' || p.type === 'float32' || p.type === 'double' || p.type === 'float64')) ? val : val / 255; break;
        case 'blue': case 'b':
          if (out.colors) out.colors[v * 3 + 2] = (p.type && (p.type === 'float' || p.type === 'float32' || p.type === 'double' || p.type === 'float64')) ? val : val / 255; break;
        case 'scalar_intensity': case 'intensity':
          if (out.intensity) out.intensity[v] = val; break;
        default: break; // skip alpha/quality/etc
      }
    }
  }
}

function _parseAsciiFaces(elem, lines, lineCursor) {
  const indices = [];
  const M = elem.count;
  for (let f = 0; f < M; f++) {
    const line = (lines[lineCursor.i] || '').trim();
    lineCursor.i++;
    if (!line) { f--; continue; }
    const toks = line.split(/\s+/);
    let t = 0;
    for (const p of elem.props) {
      if (p.kind === 'list' && (p.name === 'vertex_indices' || p.name === 'vertex_index')) {
        const cnt = parseInt(toks[t++], 10);
        const verts = [];
        for (let k = 0; k < cnt; k++) verts.push(parseInt(toks[t++], 10));
        if (cnt === 3) {
          indices.push(verts[0], verts[1], verts[2]);
        } else if (cnt === 4) {
          // Triangulate quad → two tris.
          indices.push(verts[0], verts[1], verts[2]);
          indices.push(verts[0], verts[2], verts[3]);
        } else if (cnt > 4) {
          // Fan triangulation.
          for (let k = 1; k < cnt - 1; k++) {
            indices.push(verts[0], verts[k], verts[k + 1]);
          }
        }
      } else if (p.kind === 'list') {
        const cnt = parseInt(toks[t++], 10);
        for (let k = 0; k < cnt; k++) t++;
      } else {
        t++; // skip scalar face property
      }
    }
  }
  return indices;
}

function _parseBinaryVertices(elem, dv, byteOff, out, littleEndian) {
  let off = byteOff;
  const N = elem.count;
  for (let v = 0; v < N; v++) {
    for (const p of elem.props) {
      if (p.kind === 'list') {
        // Read count.
        const [cnt, cSize] = _readScalar(dv, off, p.countType, littleEndian);
        off += cSize;
        const itemSize = _typeSize(p.itemType);
        off += cnt * itemSize;
        continue;
      }
      const [val, size] = _readScalar(dv, off, p.type, littleEndian);
      off += size;
      switch (p.name) {
        case 'x': out.positions[v * 3 + 0] = val; break;
        case 'y': out.positions[v * 3 + 1] = val; break;
        case 'z': out.positions[v * 3 + 2] = val; break;
        case 'nx': if (out.normals) out.normals[v * 3 + 0] = val; break;
        case 'ny': if (out.normals) out.normals[v * 3 + 1] = val; break;
        case 'nz': if (out.normals) out.normals[v * 3 + 2] = val; break;
        case 'red': case 'r':
          if (out.colors) out.colors[v * 3 + 0] = (p.type === 'float' || p.type === 'float32' || p.type === 'double' || p.type === 'float64') ? val : val / 255; break;
        case 'green': case 'g':
          if (out.colors) out.colors[v * 3 + 1] = (p.type === 'float' || p.type === 'float32' || p.type === 'double' || p.type === 'float64') ? val : val / 255; break;
        case 'blue': case 'b':
          if (out.colors) out.colors[v * 3 + 2] = (p.type === 'float' || p.type === 'float32' || p.type === 'double' || p.type === 'float64') ? val : val / 255; break;
        case 'scalar_intensity': case 'intensity':
          if (out.intensity) out.intensity[v] = val; break;
        default: break;
      }
    }
  }
  return off;
}

function _parseBinaryFaces(elem, dv, byteOff, littleEndian) {
  let off = byteOff;
  const indices = [];
  const M = elem.count;
  for (let f = 0; f < M; f++) {
    for (const p of elem.props) {
      if (p.kind === 'list' && (p.name === 'vertex_indices' || p.name === 'vertex_index')) {
        const [cnt, cSize] = _readScalar(dv, off, p.countType, littleEndian);
        off += cSize;
        const verts = new Array(cnt);
        for (let k = 0; k < cnt; k++) {
          const [v, vs] = _readScalar(dv, off, p.itemType, littleEndian);
          off += vs;
          verts[k] = v;
        }
        if (cnt === 3) indices.push(verts[0], verts[1], verts[2]);
        else if (cnt === 4) {
          indices.push(verts[0], verts[1], verts[2]);
          indices.push(verts[0], verts[2], verts[3]);
        } else if (cnt > 4) {
          for (let k = 1; k < cnt - 1; k++) indices.push(verts[0], verts[k], verts[k + 1]);
        }
      } else if (p.kind === 'list') {
        const [cnt, cSize] = _readScalar(dv, off, p.countType, littleEndian);
        off += cSize;
        off += cnt * _typeSize(p.itemType);
      } else {
        off += _typeSize(p.type);
      }
    }
  }
  return { indices, byteOff: off };
}

// Public — parse PLY ASCII text. Returns the populated buffer object.
export function parsePLYAscii(text) {
  const { header, bodyStartLineIdx } = parsePLYHeader(text);
  if (header.format !== 'ascii') {
    throw new Error(`PLY: expected ascii format, got "${header.format}"`);
  }
  const lines = text.split(/\r?\n/);
  const vertElem = header.elements.find((e) => e.name === 'vertex');
  if (!vertElem) throw new Error('PLY: missing vertex element');
  const out = _allocVertexBuffers(vertElem);
  const cursor = { i: bodyStartLineIdx };
  _parseAsciiVertices(vertElem, lines, out, cursor);
  let indices = [];
  const faceElem = header.elements.find((e) => e.name === 'face');
  if (faceElem) indices = _parseAsciiFaces(faceElem, lines, cursor);
  return {
    positions: out.positions,
    normals: out.normals,
    colors: out.colors,
    intensity: out.intensity,
    indices: indices.length ? new Uint32Array(indices) : null,
    vertexCount: vertElem.count,
    faceCount: faceElem ? faceElem.count : 0,
    hasNormals: !!out.hasNormals,
    hasColors: !!out.hasColors,
    hasIntensity: !!out.hasIntensity,
    format: 'ascii',
  };
}

// Public — parse PLY binary (little OR big endian). `arrayBuffer` is the
// raw file content; we re-decode the header as text up to `end_header\n`
// then DataView the rest.
export function parsePLYBinary(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  // Find "end_header" + newline.
  const needle = 'end_header';
  let textEnd = -1;
  for (let i = 0; i < bytes.length - needle.length; i++) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (bytes[i + k] !== needle.charCodeAt(k)) { match = false; break; }
    }
    if (match) {
      let j = i + needle.length;
      // skip optional \r
      if (bytes[j] === 0x0D) j++;
      if (bytes[j] === 0x0A) j++;
      textEnd = j;
      break;
    }
  }
  if (textEnd < 0) throw new Error('PLY: missing end_header in binary file');
  const headerText = new TextDecoder('utf-8').decode(bytes.subarray(0, textEnd));
  const { header } = parsePLYHeader(headerText);
  const littleEndian = header.format === 'binary_little_endian';
  if (header.format !== 'binary_little_endian' && header.format !== 'binary_big_endian') {
    throw new Error(`PLY: parsePLYBinary called on "${header.format}" file`);
  }
  const dv = new DataView(arrayBuffer);
  const vertElem = header.elements.find((e) => e.name === 'vertex');
  if (!vertElem) throw new Error('PLY: missing vertex element');
  const out = _allocVertexBuffers(vertElem);
  let off = textEnd;
  off = _parseBinaryVertices(vertElem, dv, off, out, littleEndian);
  let indices = [];
  const faceElem = header.elements.find((e) => e.name === 'face');
  if (faceElem) {
    const r = _parseBinaryFaces(faceElem, dv, off, littleEndian);
    indices = r.indices;
    off = r.byteOff;
  }
  return {
    positions: out.positions,
    normals: out.normals,
    colors: out.colors,
    intensity: out.intensity,
    indices: indices.length ? new Uint32Array(indices) : null,
    vertexCount: vertElem.count,
    faceCount: faceElem ? faceElem.count : 0,
    hasNormals: !!out.hasNormals,
    hasColors: !!out.hasColors,
    hasIntensity: !!out.hasIntensity,
    format: header.format,
  };
}

// Convenience — auto-detect ascii vs binary from input. `input` may be
// a string (always ASCII), an ArrayBuffer, or a Uint8Array.
export function parsePLY(input) {
  if (typeof input === 'string') {
    return parsePLYAscii(input);
  }
  let buffer;
  if (input instanceof ArrayBuffer) buffer = input;
  else if (ArrayBuffer.isView(input)) buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  else throw new Error('PLY: parsePLY needs string / ArrayBuffer / TypedArray');
  // Peek the first ~256 bytes for "format ascii".
  const peek = new TextDecoder('utf-8').decode(new Uint8Array(buffer).subarray(0, Math.min(256, buffer.byteLength)));
  if (/^format\s+ascii/m.test(peek)) {
    return parsePLYAscii(new TextDecoder('utf-8').decode(new Uint8Array(buffer)));
  }
  return parsePLYBinary(buffer);
}

export default parsePLY;
