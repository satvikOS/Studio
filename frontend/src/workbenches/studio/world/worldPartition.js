/*
 * Studio World Partition / streaming (Unreal World Partition + HLOD / Unity
 * Addressables + scene streaming). The scene is bucketed into a uniform spatial
 * grid of CELLS; given a streaming origin (the camera) and a radius in cells,
 * objects in nearby cells stay ACTIVE (visible) while distant cells are STREAMED
 * OUT (hidden), so only the region around the viewer is resident. Deterministic
 * (pure cell arithmetic). Returns stats for HUD + e2e.
 */
export function streamAround(meshes, opts = {}) {
  const cs = opts.cellSize || 0.3;
  const o = opts.origin || [0, 0, 0];
  const R = opts.radiusCells != null ? opts.radiusCells : 1;
  const cell = (v) => Math.floor(v / cs);
  const oc = [cell(o[0]), cell(o[1]), cell(o[2])];
  let active = 0, culled = 0;
  const activeCells = new Set();
  for (const m of meshes) {
    const mc = [cell(m.position.x), cell(m.position.y), cell(m.position.z)];
    const d = Math.max(Math.abs(mc[0] - oc[0]), Math.abs(mc[1] - oc[1]), Math.abs(mc[2] - oc[2]));
    const vis = d <= R;
    m.visible = vis;
    m.userData.archdiscStreamedOut = !vis;
    if (vis) { active++; activeCells.add(mc.join(',')); } else culled++;
  }
  return { total: meshes.length, active, culled, activeCells: activeCells.size, cellSize: cs, origin: o, radiusCells: R };
}

export function revealAll(meshes) {
  for (const m of meshes) { m.visible = true; m.userData.archdiscStreamedOut = false; }
  return { total: meshes.length, active: meshes.length, culled: 0 };
}
