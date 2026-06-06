// Slice 722 — Project autosave. Captures the scene's mesh primitives
// + per-mesh transforms + material colors into a JSON snapshot every
// N seconds, persisted to IndexedDB so it survives reloads. Restore
// drops the snapshot back into the scene as plain BufferGeometry
// meshes. Mirrors Blender's auto-save .blend1 sidecars.

import * as THREE from 'three';

const DB_NAME = 'studio_autosave';
const STORE = 'snapshots';

let _interval = 0;
let _enabled = false;
let _intervalSec = 60;

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _put(key, value) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function _get(key) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _allKeys() {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _del(key) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function _snapshotScene() {
  const scene = window.__archdiscScene;
  if (!scene) return null;
  const meshes = [];
  scene.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    const positions = Array.from(o.geometry.attributes.position.array);
    const idx = o.geometry.index ? Array.from(o.geometry.index.array) : null;
    const color = o.material?.color ? '#' + o.material.color.getHexString() : '#808080';
    meshes.push({
      name: o.name,
      uuid: o.uuid,
      transform: {
        position: o.position.toArray(),
        quaternion: o.quaternion.toArray(),
        scale: o.scale.toArray(),
      },
      color,
      positions, idx,
    });
  });
  return { ts: Date.now(), meshes };
}

export async function snapshotNow(name) {
  const snap = _snapshotScene();
  if (!snap) return { ok: false };
  const key = name || `autosave_${Date.now()}`;
  await _put(key, snap);
  // Prune older than 10.
  const keys = (await _allKeys()).filter((k) => k.startsWith('autosave_')).sort();
  if (keys.length > 10) {
    for (let i = 0; i < keys.length - 10; i++) await _del(keys[i]);
  }
  return { ok: true, key, meshCount: snap.meshes.length };
}

export async function restoreLatest() {
  const keys = (await _allKeys()).filter((k) => k.startsWith('autosave_')).sort();
  if (keys.length === 0) return { ok: false, error: 'no autosaves' };
  return restore(keys[keys.length - 1]);
}

export async function restore(key) {
  const snap = await _get(key);
  if (!snap) return { ok: false };
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  for (const m of snap.meshes) {
    const positions = new Float32Array(m.positions);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (m.idx) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(m.idx), 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.fromArray(m.transform.position);
    mesh.quaternion.fromArray(m.transform.quaternion);
    mesh.scale.fromArray(m.transform.scale);
    mesh.name = m.name;
    scene.add(mesh);
  }
  return { ok: true, restored: snap.meshes.length };
}

export async function listSnapshots() {
  const keys = (await _allKeys()).filter((k) => k.startsWith('autosave_')).sort();
  const out = [];
  for (const k of keys) {
    const snap = await _get(k);
    if (snap) out.push({ key: k, ts: snap.ts, meshCount: snap.meshes.length });
  }
  return { ok: true, snapshots: out };
}

export async function deleteSnapshot(key) {
  await _del(key);
  return { ok: true };
}

export function start(intervalSec) {
  if (_enabled) return { ok: true };
  _enabled = true;
  _intervalSec = Math.max(15, Math.min(600, Number(intervalSec) || 60));
  _interval = setInterval(() => { snapshotNow().catch(() => {}); }, _intervalSec * 1000);
  return { ok: true, intervalSec: _intervalSec };
}

export function stop() {
  _enabled = false;
  if (_interval) { clearInterval(_interval); _interval = 0; }
  return { ok: true };
}

export function isEnabled() { return { ok: true, enabled: _enabled, intervalSec: _intervalSec }; }
