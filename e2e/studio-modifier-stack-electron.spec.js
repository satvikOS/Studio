import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — NON-DESTRUCTIVE MODIFIER STACK (3ds Max / Maya / Blender) (headed).
 *
 * The defining property: removing/reordering a mid-stack modifier truly reverts
 * it (the stack re-evaluates from a clean base primitive), which destructive
 * one-shot ops cannot do. Verified: build cube + [subdivide, bevel, displace],
 * snapshot; remove the displace -> geometry reverts to the no-displace form;
 * reorder -> stack updates. Driven by real ribbon clicks + hooks.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-modifier-stack');

test('Studio — modifier stack is non-destructive (remove/reorder re-evaluates)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioModStackAdd === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // cube, selected
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(200);

  const sig = () => win.evaluate(() => { const m = window.__studioSelectedMesh(); const p = m.geometry.attributes.position; let s = 0; for (let i = 0; i < p.count; i++) s += Math.abs(p.getX(i)) + Math.abs(p.getY(i)) + Math.abs(p.getZ(i)); return { verts: p.count, chk: s }; });

  // ── Build a stack via real ribbon clicks: subdivide -> bevel -> displace ──
  await win.locator('[data-studio-ribbon-action="modstack-add-subdivide"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-ribbon-action="modstack-add-bevel"]').click();
  await win.waitForTimeout(150);
  const beforeDisplace = await sig();
  await win.locator('[data-studio-ribbon-action="modstack-add-displace"]').click();
  await win.waitForTimeout(200);
  const withDisplace = await sig();

  // stack has 3 modifiers, shown in the ribbon
  expect(await win.locator('[data-studio-modstack-item]').count(), 'stack shows 3 modifiers').toBe(3);
  expect(await win.locator('[data-studio-modstack-count]').textContent()).toContain('3 mod');
  expect(withDisplace.chk, 'displace changed the geometry').not.toBeCloseTo(beforeDisplace.chk, 3);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(28, 20, 1.2); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-stack-subdiv-bevel-displace.png') });

  // ── NON-DESTRUCTIVE: remove the displace (index 2) -> reverts to pre-displace ──
  const removed = await win.evaluate(() => { window.__studioModStackRemove(2); const m = window.__studioSelectedMesh(); const p = m.geometry.attributes.position; let s = 0; for (let i = 0; i < p.count; i++) s += Math.abs(p.getX(i)) + Math.abs(p.getY(i)) + Math.abs(p.getZ(i)); return { verts: p.count, chk: s, stack: window.__studioModStackGet().map((x) => x.type) }; });
  expect(removed.stack, 'stack now subdivide+bevel').toEqual(['subdivide', 'bevel']);
  expect(removed.chk, 'removing displace reverted the geometry to the pre-displace form').toBeCloseTo(beforeDisplace.chk, 3);

  // ── reorder: move bevel (index1) up -> [bevel, subdivide]; re-evaluates cleanly ──
  const reordered = await win.evaluate(() => { window.__studioModStackReorder(1, -1); return window.__studioModStackGet().map((x) => x.type); });
  expect(reordered, 'reorder swapped the stack order').toEqual(['bevel', 'subdivide']);
  const afterReorder = await win.evaluate(() => { const m = window.__studioSelectedMesh(); return m.geometry.attributes.position.count > 0; });
  expect(afterReorder, 'stack still evaluates after reorder').toBe(true);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(34, 22, 1.2); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-after-remove-reorder.png') });

  // eslint-disable-next-line no-console
  console.log(`  modifier stack: +displace chk ${beforeDisplace.chk.toFixed(3)}->${withDisplace.chk.toFixed(3)}; -displace reverted to ${removed.chk.toFixed(3)} (==${beforeDisplace.chk.toFixed(3)}); reorder -> ${reordered.join(',')}`);

  await app.close();
});
