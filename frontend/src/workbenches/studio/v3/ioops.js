// ArchDisc Studio V3 — file I/O family.
//
// V3-native ports of:
//   __studioImportAsset      — OBJ / glTF / GLB / FBX loader from raw data
//   __studioExportGltfString — GLTFExporter → JSON string for the scene
//   __studioDownloadGLTF     — wraps Export + browser download anchor
//   __studioDownloadScene    — saveScene() JSON download
//   __studioOpenSceneFile    — <input type=file> picker → loadScene()
//   __studioAutosaveAt       — localStorage timestamp accessor
//   __studioRestoreAutosave  — replay last autosaved JSON

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const PRIMITIVE_SIZE = 0.03;
const AUTOSAVE_KEY = 'archdisc.studio.autosave';
const AUTOSAVE_TS  = 'archdisc.studio.autosave.ts';

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}

// Multi-mesh asset → register each as a Studio primitive, centred + fit-
// scaled to PRIMITIVE_SIZE * 3 so it isn't dwarfed by the mm-scale camera.
function registerImportedMeshes(root, kindLabel) {
  const s = scene();
  if (!s || !root) return 0;
  root.updateMatrixWorld(true);
  const collected = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const geom = o.geometry.clone();
      geom.applyMatrix4(o.matrixWorld);
      let color = 0x9098a3;
      if (o.material && o.material.color) color = o.material.color.getHex();
      collected.push({ geom, color });
    }
  });
  if (!collected.length) return 0;
  const box = new THREE.Box3();
  for (const c of collected) { c.geom.computeBoundingBox(); if (c.geom.boundingBox) box.union(c.geom.boundingBox); }
  const center = new THREE.Vector3(); box.getCenter(center);
  const size   = new THREE.Vector3(); box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fit = (PRIMITIVE_SIZE * 3) / maxDim;
  let added = 0;
  let lastMesh = null;
  for (const c of collected) {
    c.geom.translate(-center.x, -center.y, -center.z);
    c.geom.scale(fit, fit, fit);
    if (!c.geom.attributes.normal) c.geom.computeVertexNormals();
    c.geom.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: c.color, metalness: 0.2, roughness: 0.55 });
    const mesh = new THREE.Mesh(c.geom, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'imported';
    mesh.userData.archdiscStudioImportFormat = kindLabel;
    mesh.userData.pickable = true;
    mesh.name = `studio-import-${kindLabel}`;
    s.add(mesh);
    lastMesh = mesh;
    added++;
  }
  if (lastMesh && window.__studioSelectMesh) { try { window.__studioSelectMesh(lastMesh); } catch (_) {} }
  return added;
}

function importAsset(format, data) {
  const fmt = String(format || '').toLowerCase();
  try {
    if (fmt === 'obj') {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      return { ok: true, added: registerImportedMeshes(new OBJLoader().parse(text), 'obj') };
    }
    if (fmt === 'gltf' || fmt === 'glb') {
      return new Promise((resolve) => {
        const loader = new GLTFLoader();
        const onLoad = (gltf) => resolve({ ok: true, added: registerImportedMeshes(gltf.scene, fmt) });
        const onErr  = (e) => resolve({ ok: false, added: 0, error: String(e && e.message || e) });
        if (data instanceof ArrayBuffer) loader.parse(data, '', onLoad, onErr);
        else if (typeof data === 'string' && data.startsWith('data:')) {
          fetch(data).then((r) => r.arrayBuffer()).then((buf) => loader.parse(buf, '', onLoad, onErr)).catch((e) => resolve({ ok: false, added: 0, error: String(e) }));
        } else if (typeof data === 'string') loader.parse(data, '', onLoad, onErr);
        else resolve({ ok: false, added: 0, error: 'unsupported glTF data' });
      });
    }
    if (fmt === 'fbx') {
      const buf = (data instanceof ArrayBuffer || typeof data === 'string') ? data : null;
      if (!buf) return { ok: false, added: 0, error: 'fbx needs ArrayBuffer or ASCII text' };
      return { ok: true, added: registerImportedMeshes(new FBXLoader().parse(buf, ''), 'fbx') };
    }
    return { ok: false, added: 0, error: `unsupported format: ${fmt}` };
  } catch (e) {
    return { ok: false, added: 0, error: String(e && e.message || e) };
  }
}

async function exportGltfString() {
  const s = scene();
  if (!s) return null;
  const tempScene = new THREE.Scene();
  s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) tempScene.add(o.clone()); });
  const exporter = new GLTFExporter();
  return await new Promise((resolve) => {
    exporter.parse(tempScene, (result) => resolve(JSON.stringify(result)), () => resolve(null), { binary: false, onlyVisible: true, embedImages: true });
  });
}

async function downloadGLTF(name) {
  const txt = await exportGltfString();
  if (!txt) return null;
  const blob = new Blob([txt], { type: 'model/gltf+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `${name || 'studio-scene'}-${ts}.gltf`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  return a.download;
}

function downloadScene(name) {
  const json = window.__studioSaveScene && window.__studioSaveScene();
  if (!json) return null;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `${name || 'studio-scene'}-${ts}.studio.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  return a.download;
}

function openSceneFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) { document.body.removeChild(input); resolve({ ok: false, error: 'no file' }); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const r = window.__studioLoadScene && window.__studioLoadScene(reader.result);
        document.body.removeChild(input);
        resolve(r || { ok: false, error: 'no loader' });
      };
      reader.onerror = () => {
        document.body.removeChild(input);
        resolve({ ok: false, error: 'read error' });
      };
      reader.readAsText(f);
    });
    input.click();
  });
}

function autosaveAt() {
  return Number(window.localStorage.getItem(AUTOSAVE_TS) || 0);
}

function restoreAutosave() {
  const j = window.localStorage.getItem(AUTOSAVE_KEY);
  if (!j) return { ok: false, error: 'no autosave' };
  return window.__studioLoadScene ? window.__studioLoadScene(j) : { ok: false, error: 'no loader' };
}

export function registerIOOps() {
  window.__studioImportAsset      = importAsset;
  window.__studioExportGltfString = exportGltfString;
  window.__studioDownloadGLTF     = downloadGLTF;
  window.__studioDownloadScene    = downloadScene;
  window.__studioOpenSceneFile    = openSceneFile;
  window.__studioAutosaveAt       = autosaveAt;
  window.__studioRestoreAutosave  = restoreAutosave;
}

export function unregisterIOOps() {
  for (const k of [
    '__studioImportAsset', '__studioExportGltfString', '__studioDownloadGLTF',
    '__studioDownloadScene', '__studioOpenSceneFile',
    '__studioAutosaveAt', '__studioRestoreAutosave',
  ]) { try { delete window[k]; } catch (_) {} }
}
