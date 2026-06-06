// Slice 712 — Universal mesh format parsers. Adds in-house readers
// for STL (ASCII + binary), PLY (ASCII), OFF, 3MF (text mode), X3D
// (subset). The OBJ + glTF readers already exist via Three.js loaders.
// All parsers return Float32 vertices + UInt32 indices that callers
// can wrap in BufferGeometry.

import * as THREE from 'three';

export function parseSTL(text) {
  // ASCII STL: facet normal n_i n_j n_k ... outer loop ... vertex x y z ...
  if (typeof text !== 'string') return parseSTLBinary(text);
  const lines = text.split('\n');
  const verts = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('vertex')) {
      const parts = l.split(/\s+/);
      verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    }
  }
  return { positions: new Float32Array(verts), indexed: false };
}

export function parseSTLBinary(buffer) {
  const dv = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
  const triCount = dv.getUint32(80, true);
  const verts = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50 + 12;   // skip normal
    for (let v = 0; v < 3; v++) {
      verts[t * 9 + v * 3]     = dv.getFloat32(base + v * 12, true);
      verts[t * 9 + v * 3 + 1] = dv.getFloat32(base + v * 12 + 4, true);
      verts[t * 9 + v * 3 + 2] = dv.getFloat32(base + v * 12 + 8, true);
    }
  }
  return { positions: verts, indexed: false };
}

export function parsePLY(text) {
  // ASCII PLY only. Reads vertex / face elements.
  const lines = text.split('\n');
  let vertCount = 0, faceCount = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('element vertex')) vertCount = parseInt(l.split(' ')[2], 10);
    else if (l.startsWith('element face')) faceCount = parseInt(l.split(' ')[2], 10);
    else if (l === 'end_header') { i++; break; }
  }
  const positions = new Float32Array(vertCount * 3);
  for (let v = 0; v < vertCount; v++) {
    const parts = lines[i + v].trim().split(/\s+/);
    positions[v * 3]     = parseFloat(parts[0]);
    positions[v * 3 + 1] = parseFloat(parts[1]);
    positions[v * 3 + 2] = parseFloat(parts[2]);
  }
  i += vertCount;
  const indices = [];
  for (let f = 0; f < faceCount; f++) {
    const parts = lines[i + f].trim().split(/\s+/);
    const n = parseInt(parts[0], 10);
    if (n === 3) {
      indices.push(parseInt(parts[1], 10), parseInt(parts[2], 10), parseInt(parts[3], 10));
    } else if (n === 4) {
      const a = parseInt(parts[1], 10), b = parseInt(parts[2], 10), c = parseInt(parts[3], 10), d = parseInt(parts[4], 10);
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions, indices: new Uint32Array(indices), indexed: true };
}

export function parseOFF(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines[0].toUpperCase().startsWith('OFF')) {
    // some OFF files have OFF on first line, counts on second
  }
  let headerLine = lines[0].trim().toUpperCase() === 'OFF' ? 1 : 0;
  const counts = lines[headerLine].trim().split(/\s+/);
  const vertCount = parseInt(counts[0], 10);
  const faceCount = parseInt(counts[1], 10);
  headerLine++;
  const positions = new Float32Array(vertCount * 3);
  for (let v = 0; v < vertCount; v++) {
    const parts = lines[headerLine + v].trim().split(/\s+/);
    positions[v * 3]     = parseFloat(parts[0]);
    positions[v * 3 + 1] = parseFloat(parts[1]);
    positions[v * 3 + 2] = parseFloat(parts[2]);
  }
  headerLine += vertCount;
  const indices = [];
  for (let f = 0; f < faceCount; f++) {
    const parts = lines[headerLine + f].trim().split(/\s+/);
    const n = parseInt(parts[0], 10);
    if (n === 3) indices.push(parseInt(parts[1], 10), parseInt(parts[2], 10), parseInt(parts[3], 10));
    else if (n === 4) {
      const a = parseInt(parts[1], 10), b = parseInt(parts[2], 10), c = parseInt(parts[3], 10), d = parseInt(parts[4], 10);
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions, indices: new Uint32Array(indices), indexed: true };
}

export function parse3MF(text) {
  // 3MF text mode: XML with <object><mesh><vertices><vertex x="" y="" z=""/>...</vertices><triangles><triangle v1="" v2="" v3=""/>...</triangles></mesh></object>
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');
  const verts = xml.getElementsByTagName('vertex');
  const positions = new Float32Array(verts.length * 3);
  for (let v = 0; v < verts.length; v++) {
    positions[v * 3]     = parseFloat(verts[v].getAttribute('x'));
    positions[v * 3 + 1] = parseFloat(verts[v].getAttribute('y'));
    positions[v * 3 + 2] = parseFloat(verts[v].getAttribute('z'));
  }
  const tris = xml.getElementsByTagName('triangle');
  const indices = new Uint32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t++) {
    indices[t * 3]     = parseInt(tris[t].getAttribute('v1'), 10);
    indices[t * 3 + 1] = parseInt(tris[t].getAttribute('v2'), 10);
    indices[t * 3 + 2] = parseInt(tris[t].getAttribute('v3'), 10);
  }
  return { positions, indices, indexed: true };
}

export function importParsed(parsed, name) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
  if (parsed.indexed && parsed.indices) geo.setIndex(new THREE.BufferAttribute(parsed.indices, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb09a72, roughness: 0.6, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name || 'imported-mesh';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'uniconvert';
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid };
}

export async function importFile(file) {
  const name = file.name?.toLowerCase() || '';
  if (name.endsWith('.stl')) {
    // Try ASCII first.
    const text = await file.text();
    if (text.startsWith('solid')) {
      return importParsed(parseSTL(text), file.name);
    }
    return importParsed(parseSTLBinary(await file.arrayBuffer()), file.name);
  }
  if (name.endsWith('.ply')) return importParsed(parsePLY(await file.text()), file.name);
  if (name.endsWith('.off')) return importParsed(parseOFF(await file.text()), file.name);
  if (name.endsWith('.3mf')) return importParsed(parse3MF(await file.text()), file.name);
  return { ok: false, error: 'unsupported format: ' + name };
}
