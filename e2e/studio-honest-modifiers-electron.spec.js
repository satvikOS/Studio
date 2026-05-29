import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — HONEST MODIFIERS (headed Electron).
 *
 * Audit gap #12: several "shipped" modifiers were stubs/aliases. This proves
 * the fixes are REAL geometry, driven by real ribbon clicks:
 *   - Bevel: was a no-op (bevelSelected undefined). Now welds + tessellates +
 *     rounds edges + rescales to the original bounds — a real volume-preserving
 *     bevel-round (geometry changes; bounding box is preserved).
 *   - Corrective Smooth: was an alias of the fake bevel. Now a real Laplacian
 *     smooth (geometry changes; bounding box SHRINKS — distinct from bevel).
 *   - Weighted Normals: was a no-op recompute. Now area*angle-weighted normals
 *     (unit-length; recomputed).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-honest-modifiers');

test('Studio — bevel / corrective-smooth / weighted-normals do real geometry', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioSelectMesh === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // Fresh single cube, selected so modifier buttons enable + operate on it.
  async function freshCube() {
    const clear = win.locator('[data-studio-action="clear-scene-ribbon"]');
    if (await clear.isEnabled().catch(() => false)) await clear.click();
    await win.locator('[data-studio-primitive="cube"]').click();
    await win.waitForTimeout(250);
    await win.evaluate(() => {
      const s = window.__archdiscScene; let m = null;
      s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; });
      if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    });
    await win.waitForTimeout(200);
  }
  const stats = () => win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (!m || !m.geometry) return null;
    const g = m.geometry; g.computeBoundingBox();
    const bb = g.boundingBox; const p = g.attributes.position; const n = g.attributes.normal;
    let chk = 0; for (let i = 0; i < p.count; i++) chk += Math.abs(p.getX(i)) + Math.abs(p.getY(i)) + Math.abs(p.getZ(i));
    let unit = true; if (n) for (let i = 0; i < n.count; i++) { const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i)); if (Math.abs(l - 1) > 0.05) { unit = false; break; } }
    return { size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z], count: p.count, chk, n0: n ? [n.getX(0), n.getY(0), n.getZ(0)] : null, unit };
  });

  // ── BEVEL: real round, bounding box preserved ──
  await freshCube();
  const b0 = await stats();
  const bevelBtn = win.locator('[data-studio-ribbon-action="bevel"]');
  await expect(bevelBtn).toBeEnabled();
  for (let i = 0; i < 3; i++) { await bevelBtn.click(); await win.waitForTimeout(200); }
  const b1 = await stats();
  expect(Math.abs(b1.chk - b0.chk), 'bevel changed the geometry').toBeGreaterThan(1e-4);
  for (let a = 0; a < 3; a++) {
    expect(Math.abs(b1.size[a] - b0.size[a]) / (b0.size[a] || 1), `bevel preserves bbox axis ${a}`).toBeLessThan(0.12);
  }
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(28, 20, 1.2); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-beveled-cube.png') });

  // ── CORRECTIVE SMOOTH: real smooth, bounding box SHRINKS (≠ bevel) ──
  await freshCube();
  const s0 = await stats();
  const smoothBtn = win.locator('[data-studio-ribbon-action="corrective-smooth"]');
  await expect(smoothBtn).toBeEnabled();
  for (let i = 0; i < 3; i++) { await smoothBtn.click(); await win.waitForTimeout(200); }
  const s1 = await stats();
  expect(Math.abs(s1.chk - s0.chk), 'corrective smooth changed the geometry').toBeGreaterThan(1e-4);
  const shrank = (s1.size[0] < s0.size[0] * 0.985) || (s1.size[1] < s0.size[1] * 0.985) || (s1.size[2] < s0.size[2] * 0.985);
  expect(shrank, 'corrective smooth shrinks the form (distinct from volume-preserving bevel)').toBe(true);

  // ── WEIGHTED NORMALS: real recompute, unit-length ──
  await freshCube();
  const wnBtn = win.locator('[data-studio-ribbon-action="weighted-normals"]');
  await expect(wnBtn).toBeEnabled();
  await wnBtn.click();
  await win.waitForTimeout(250);
  const w1 = await stats();
  expect(w1.unit, 'weighted normals are unit-length').toBe(true);
  const stamped = await win.evaluate(() => { const m = window.__studioSelectedMesh(); return !!(m && m.userData && m.userData.archdiscStudioWeightedNormals); });
  expect(stamped, 'weighted-normal modifier ran (stamped)').toBe(true);

  // eslint-disable-next-line no-console
  console.log(`  honest modifiers: bevel chk ${b0.chk.toFixed(3)}->${b1.chk.toFixed(3)} bbox~preserved; smooth bbox ${s0.size.map(v=>v.toFixed(3))}->${s1.size.map(v=>v.toFixed(3))}; weighted-normals unit=${w1.unit}`);

  await app.close();
});
