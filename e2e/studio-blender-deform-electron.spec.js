import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 74 — Two Blender SimpleDeform modes: Bend + Taper.
 *
 *   Bend  <- blender/source/blender/modifiers/intern/MOD_simpledeform.cc
 *            (mode BEND — bend XZ proportional to Y)
 *   Taper <- same file (mode TAPER — scale XZ by Y position)
 *
 * Both wired into the Modeling-tab ribbon's "Blender · Mods" group.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-deform');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshState(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    const pos = m.geometry.attributes.position;
    let sum = 0;
    for (let i = 0; i < pos.count; i++) sum += Math.abs(pos.getX(i)) + Math.abs(pos.getY(i)) + Math.abs(pos.getZ(i));
    return {
      verts: pos.count,
      checksum: sum,
      bent: m.userData.archdiscStudioBent || 0,
      tapered: m.userData.archdiscStudioTapered || 0,
    };
  }, kind);
}

test('Studio Blender SimpleDeform — Bend + Taper modifiers fire', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 220,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Cylinder is a good test — has clear Y extent so bend/taper effects
  // are visually obvious.
  await win.locator('[data-studio-primitive="cylinder"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'cylinder');
  await win.waitForTimeout(300);

  const baseline = await meshState(win, 'cylinder');
  await win.screenshot({ path: path.join(OUT, '00-baseline-cylinder.png'), fullPage: false });

  // ---- BEND ----
  await win.locator('[data-studio-ribbon-action="bend"]').click();
  await win.waitForTimeout(400);
  const afterBend = await meshState(win, 'cylinder');
  expect(afterBend.bent).toBe(1);
  expect(Math.abs(afterBend.checksum - baseline.checksum)).toBeGreaterThan(0.001);
  await win.screenshot({ path: path.join(OUT, '01-bent.png'), fullPage: false });

  // ---- TAPER (on the bent cylinder) ----
  await win.locator('[data-studio-ribbon-action="taper"]').click();
  await win.waitForTimeout(400);
  const afterTaper = await meshState(win, 'cylinder');
  expect(afterTaper.tapered).toBe(1);
  expect(Math.abs(afterTaper.checksum - afterBend.checksum)).toBeGreaterThan(0.001);
  await win.screenshot({ path: path.join(OUT, '02-bent-and-tapered.png'), fullPage: false });

  // ---- 4-angle showcase ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender deform: cylinder -> bend (cs=${baseline.checksum.toFixed(3)} -> ${afterBend.checksum.toFixed(3)}) -> taper (-> ${afterTaper.checksum.toFixed(3)}). Both modifiers fired.`);

  await app.close();
});
