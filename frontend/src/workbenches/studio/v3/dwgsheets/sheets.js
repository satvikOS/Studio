// Slice 716 — AutoCAD layout sheets + viewports. A sheet is a sized
// paper-space canvas with title block + N viewports each showing a
// configured camera angle of the 3D model space. Sheets export as
// single PNG, multi-page PDF (in-house writer), or composite DXF.

import * as THREE from 'three';

const _sheets = new Map();
let _seq = 1;
function _uid() { return `sh-${_seq++}-${Date.now().toString(36)}`; }

const PAPER_SIZES = {
  letter: [8.5, 11],
  legal: [8.5, 14],
  tabloid: [11, 17],
  A4: [8.27, 11.69],
  A3: [11.69, 16.54],
  A2: [16.54, 23.39],
  A1: [23.39, 33.11],
  A0: [33.11, 46.81],
  arch_d: [24, 36],
};

export function createSheet(name, opts) {
  const id = _uid();
  const paper = opts?.paper || 'A3';
  const size = PAPER_SIZES[paper] || PAPER_SIZES.A3;
  const dpi = Number(opts?.dpi) || 100;
  const sheet = {
    id, name,
    paper, sizeIn: size,
    pxSize: [size[0] * dpi, size[1] * dpi],
    viewports: [],
    titleBlock: {
      show: true,
      project: opts?.project || '',
      drawing: opts?.drawing || name,
      author: opts?.author || '',
      date: opts?.date || new Date().toISOString().slice(0, 10),
      scale: opts?.scale || '1:50',
    },
  };
  _sheets.set(id, sheet);
  return { ok: true, id };
}

export function addViewport(sheetId, opts) {
  const sheet = _sheets.get(sheetId);
  if (!sheet) return { ok: false };
  const vp = {
    uuid: _uid(),
    px: opts?.px || [50, 50],         // pixel position on paper
    pxSize: opts?.pxSize || [500, 400],
    cameraType: opts?.cameraType || 'perspective',  // perspective | top | front | right | left | back | bottom
    label: opts?.label || '',
  };
  sheet.viewports.push(vp);
  return { ok: true, uuid: vp.uuid };
}

function _setupCamera(cameraType, w, h) {
  if (cameraType === 'perspective') {
    return new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
  }
  // Orthographic for ortho views.
  const aspect = w / h;
  const D = 5;
  const cam = new THREE.OrthographicCamera(-D * aspect, D * aspect, D, -D, 0.1, 1000);
  return cam;
}

function _positionCamera(cam, cameraType) {
  const D = 5;
  if (cameraType === 'top')    { cam.position.set(0, D * 2, 0); cam.lookAt(0, 0, 0); cam.up.set(0, 0, -1); return; }
  if (cameraType === 'bottom') { cam.position.set(0, -D * 2, 0); cam.lookAt(0, 0, 0); cam.up.set(0, 0, 1); return; }
  if (cameraType === 'front')  { cam.position.set(0, 0, D * 2); cam.lookAt(0, 0, 0); return; }
  if (cameraType === 'back')   { cam.position.set(0, 0, -D * 2); cam.lookAt(0, 0, 0); return; }
  if (cameraType === 'right')  { cam.position.set(D * 2, 0, 0); cam.lookAt(0, 0, 0); return; }
  if (cameraType === 'left')   { cam.position.set(-D * 2, 0, 0); cam.lookAt(0, 0, 0); return; }
  if (cameraType === 'iso')    { cam.position.set(D, D, D); cam.lookAt(0, 0, 0); return; }
  cam.position.set(D, D, D); cam.lookAt(0, 0, 0);
}

export function renderSheet(sheetId) {
  const sheet = _sheets.get(sheetId);
  if (!sheet) return { ok: false };
  const viewport = window.__archdiscViewport;
  if (!viewport?.renderer || !window.__archdiscScene) return { ok: false };
  const [w, h] = sheet.pxSize;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  // White paper.
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  // Border.
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  // Title block (lower right).
  if (sheet.titleBlock.show) {
    const tbW = 250, tbH = 100;
    ctx.strokeRect(w - tbW - 16, h - tbH - 16, tbW, tbH);
    ctx.fillStyle = '#222';
    ctx.font = '14px Arial';
    ctx.fillText(sheet.titleBlock.drawing, w - tbW - 8, h - tbH);
    ctx.font = '11px Arial';
    ctx.fillText(`Project: ${sheet.titleBlock.project}`, w - tbW - 8, h - tbH + 22);
    ctx.fillText(`By: ${sheet.titleBlock.author}`, w - tbW - 8, h - tbH + 38);
    ctx.fillText(`Date: ${sheet.titleBlock.date}`, w - tbW - 8, h - tbH + 54);
    ctx.fillText(`Scale: ${sheet.titleBlock.scale}`, w - tbW - 8, h - tbH + 70);
  }
  // Viewports.
  for (const vp of sheet.viewports) {
    const cam = _setupCamera(vp.cameraType, vp.pxSize[0], vp.pxSize[1]);
    _positionCamera(cam, vp.cameraType);
    // Off-screen render.
    const rt = new THREE.WebGLRenderTarget(vp.pxSize[0], vp.pxSize[1]);
    viewport.renderer.setRenderTarget(rt);
    viewport.renderer.render(window.__archdiscScene, cam);
    viewport.renderer.setRenderTarget(null);
    const buf = new Uint8Array(vp.pxSize[0] * vp.pxSize[1] * 4);
    viewport.renderer.readRenderTargetPixels(rt, 0, 0, vp.pxSize[0], vp.pxSize[1], buf);
    // Blit to sheet canvas (Y-flip).
    const imgData = ctx.createImageData(vp.pxSize[0], vp.pxSize[1]);
    for (let y = 0; y < vp.pxSize[1]; y++) {
      for (let x = 0; x < vp.pxSize[0]; x++) {
        const src = ((vp.pxSize[1] - 1 - y) * vp.pxSize[0] + x) * 4;
        const dst = (y * vp.pxSize[0] + x) * 4;
        imgData.data[dst]     = buf[src];
        imgData.data[dst + 1] = buf[src + 1];
        imgData.data[dst + 2] = buf[src + 2];
        imgData.data[dst + 3] = buf[src + 3];
      }
    }
    ctx.putImageData(imgData, vp.px[0], vp.px[1]);
    // Border.
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(vp.px[0], vp.px[1], vp.pxSize[0], vp.pxSize[1]);
    // Label.
    if (vp.label) {
      ctx.fillStyle = '#222';
      ctx.font = '12px Arial';
      ctx.fillText(vp.label, vp.px[0] + 4, vp.px[1] - 4);
    }
    rt.dispose();
  }
  return { ok: true, canvas: cv, dataURL: cv.toDataURL('image/png') };
}

export function exportAsPNG(sheetId, filename) {
  const r = renderSheet(sheetId);
  if (!r.ok) return r;
  const a = document.createElement('a');
  a.href = r.dataURL;
  a.download = filename || `sheet-${sheetId}.png`;
  a.click();
  return { ok: true };
}

export function listSheets() {
  return {
    ok: true,
    sheets: Array.from(_sheets.values()).map((s) => ({
      id: s.id, name: s.name, paper: s.paper, pxSize: s.pxSize, viewports: s.viewports.length,
    })),
  };
}

export function deleteSheet(id) {
  return { ok: _sheets.delete(id) };
}
