import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 54 — Array modifier (linear + radial).
 *
 * Linear: N copies translated by (dx, dy, dz)*i along the axis.
 * Radial: N copies in a ring of radius R around the Y-axis through
 *         the source primitive's position. Each copy is rotated
 *         inward so its local +Z faces the ring centre.
 *
 * Verifies:
 *   - Both modes produce exactly (count - 1) duplicates of the
 *     source primitive in the scene.
 *   - Duplicates carry the source's primitive kind + "-array" suffix.
 *   - Linear positions are evenly stepped along the offset axis.
 *   - Radial positions sit on a ring of correct radius.
 *   - DETERMINISM — running the same array twice on identical
 *     sources yields identical positions.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-array-modifier');

async function setRange(win, selector, value) {
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function arrayPositions(win, kindFilter) {
  return await win.evaluate((kf) => {
    const vp = window.__archdiscViewport;
    const out = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.userData.archdiscStudioPrimitiveKind &&
          o.userData.archdiscStudioPrimitiveKind.startsWith(kf)) {
        out.push({
          kind: o.userData.archdiscStudioPrimitiveKind,
          idx: o.userData.archdiscStudioArrayIndex !== undefined ? o.userData.archdiscStudioArrayIndex : -1,
          x: o.position.x, y: o.position.y, z: o.position.z,
        });
      }
    });
    return out;
  }, kindFilter);
}

test('Studio Array modifier — linear + radial duplication of a selected mesh', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- LINEAR ARRAY of cube along +X ----
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'cube');
  await win.waitForTimeout(300);

  await win.locator('[data-studio-array="mode"]').selectOption('linear');
  await setRange(win, '[data-studio-array="count"]',   '6');
  await setRange(win, '[data-studio-array="offsetX"]', '0.04');
  await setRange(win, '[data-studio-array="offsetY"]', '0');
  await setRange(win, '[data-studio-array="offsetZ"]', '0');
  await expect(win.locator('[data-studio-array-readout="count"]')).toHaveText('6');
  await win.locator('[data-studio-action="apply-array"]').click();
  await win.waitForTimeout(400);

  const linearCubes = await arrayPositions(win, 'cube');
  // 5 array copies + 1 source = 6 total.
  expect(linearCubes.length).toBe(6);
  const copies = linearCubes.filter(p => p.kind === 'cube-array').sort((a, b) => a.idx - b.idx);
  expect(copies.length).toBe(5);
  // Linear stepping: idx i copies positioned at x = source.x + 0.04 * i
  const srcX = linearCubes.find(p => p.kind === 'cube').x;
  for (let i = 0; i < copies.length; i++) {
    expect(copies[i].x).toBeCloseTo(srcX + 0.04 * (i + 1), 5);
    expect(copies[i].y).toBeCloseTo(0, 5);
  }
  await win.screenshot({ path: path.join(OUT, '01-linear-x-array.png'), fullPage: false });

  // ---- Clear, RADIAL ARRAY of torus ----
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="torus"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'torus');
  await win.waitForTimeout(300);

  await win.locator('[data-studio-array="mode"]').selectOption('radial');
  await setRange(win, '[data-studio-array="count"]',  '8');
  await setRange(win, '[data-studio-array="radius"]', '0.05');
  await win.locator('[data-studio-action="apply-array"]').click();
  await win.waitForTimeout(400);

  const radialTori = await arrayPositions(win, 'torus');
  expect(radialTori.length).toBe(8); // 7 copies + 1 source
  const torusCopies = radialTori.filter(p => p.kind === 'torus-array');
  expect(torusCopies.length).toBe(7);
  // Each copy on a ring of radius 0.05 (after accounting for source's x=0 baseline)
  const torusSrc = radialTori.find(p => p.kind === 'torus');
  for (const c of torusCopies) {
    const dx = c.x - torusSrc.x;
    const dz = c.z - torusSrc.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    expect(r).toBeCloseTo(0.05, 4);
  }
  await win.screenshot({ path: path.join(OUT, '02-radial-torus-ring.png'), fullPage: false });

  // ---- Determinism — clear, repeat the same radial array, positions match ----
  const firstChecksum = torusCopies.reduce((s, c) => s + Math.abs(c.x) + Math.abs(c.z), 0);

  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="torus"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'torus');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-action="apply-array"]').click();
  await win.waitForTimeout(400);

  const radialTori2 = await arrayPositions(win, 'torus');
  const torusCopies2 = radialTori2.filter(p => p.kind === 'torus-array');
  const secondChecksum = torusCopies2.reduce((s, c) => s + Math.abs(c.x) + Math.abs(c.z), 0);
  expect(secondChecksum).toBeCloseTo(firstChecksum, 6);

  // ---- 4-angle showcase of radial array ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `03-radial-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  array: linear cube×6 stepped at 40mm; radial torus×8 on r=50mm ring (positions identical across two runs cs=${firstChecksum.toFixed(5)} == ${secondChecksum.toFixed(5)})`);

  await app.close();
});
