// Slice 720 — SketchUp Generate Report (Bill of Materials). Walks
// the scene, groups meshes by name / tag / material color, sums
// counts + cumulative volume + bounding-box dimensions. Outputs CSV
// or rendered table to a canvas for printing/export.

import * as THREE from 'three';

function _meshVolume(mesh) {
  if (!mesh.geometry?.attributes?.position) return 0;
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index?.array;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
    const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
    const cx = pos[i2 * 3], cy = pos[i2 * 3 + 1], cz = pos[i2 * 3 + 2];
    vol += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by)) / 6;
  }
  return Math.abs(vol);
}

export function generateReport(opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const groupBy = opts?.groupBy || 'name';   // name | tag | material | kind
  const groups = new Map();
  scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    let key;
    if (groupBy === 'tag') key = (typeof window.__studioSKTagGetTagOf === 'function'
      ? window.__studioSKTagGetTagOf(o.uuid).tag : null) || 'untagged';
    else if (groupBy === 'material') key = o.material?.color?.getHexString?.() || 'no-material';
    else if (groupBy === 'kind') key = o.userData?.archdiscStudioPrimitiveKind || o.name || 'unknown';
    else key = o.name || 'unnamed';
    if (!groups.has(key)) {
      groups.set(key, { count: 0, totalVolume: 0, totalArea: 0, examples: [] });
    }
    const grp = groups.get(key);
    grp.count++;
    grp.totalVolume += _meshVolume(o);
    if (o.geometry) {
      const box = new THREE.Box3().setFromObject(o);
      const sz = box.getSize(new THREE.Vector3());
      grp.totalArea += 2 * (sz.x * sz.y + sz.y * sz.z + sz.x * sz.z);
    }
    if (grp.examples.length < 3) grp.examples.push(o.uuid);
  });
  const items = Array.from(groups.entries()).map(([key, g]) => ({
    key,
    count: g.count,
    totalVolume: g.totalVolume,
    totalArea: g.totalArea,
    avgVolume: g.totalVolume / g.count,
    examples: g.examples,
  }));
  items.sort((a, b) => b.totalVolume - a.totalVolume);
  return { ok: true, items, groupBy, totalCount: items.reduce((a, b) => a + b.count, 0) };
}

export function exportCSV(items) {
  const lines = ['Name,Count,Total Volume (m³),Total Area (m²),Avg Volume (m³)'];
  for (const i of items) {
    lines.push(`"${i.key}",${i.count},${i.totalVolume.toFixed(4)},${i.totalArea.toFixed(4)},${i.avgVolume.toFixed(4)}`);
  }
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'studio-bom.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { ok: true, csv };
}

export function renderToCanvas(items, opts) {
  const w = Number(opts?.width) || 800;
  const rowH = 28;
  const h = (items.length + 2) * rowH + 20;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  // Header.
  ctx.fillStyle = '#222';
  ctx.font = 'bold 14px Arial';
  ctx.fillText('Bill of Materials', 20, 24);
  // Column headers.
  const colX = [20, 320, 420, 540, 660];
  ctx.font = 'bold 12px Arial';
  ['Name', 'Count', 'Total Vol', 'Total Area', 'Avg Vol'].forEach((label, i) => {
    ctx.fillText(label, colX[i], 50);
  });
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 60); ctx.lineTo(w - 20, 60); ctx.stroke();
  // Rows.
  ctx.font = '12px Arial';
  items.forEach((i, idx) => {
    const y = 78 + idx * rowH;
    ctx.fillStyle = idx % 2 ? '#f4f4f4' : '#ffffff';
    ctx.fillRect(20, y - 18, w - 40, rowH - 4);
    ctx.fillStyle = '#222';
    ctx.fillText(i.key.length > 40 ? i.key.slice(0, 37) + '...' : i.key, colX[0], y);
    ctx.fillText(String(i.count), colX[1], y);
    ctx.fillText(i.totalVolume.toFixed(3), colX[2], y);
    ctx.fillText(i.totalArea.toFixed(3), colX[3], y);
    ctx.fillText(i.avgVolume.toFixed(3), colX[4], y);
  });
  return { ok: true, canvas: cv, dataURL: cv.toDataURL('image/png') };
}
