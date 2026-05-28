import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 111 — Batch 14: 5 Blender modifier-stack ops + 7 Unreal
 * PostProcessVolume parity ops, driven via real ribbon clicks.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-batch14');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshCounter(win, kind, key) {
  return await win.evaluate(({ k, ck }) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    return m ? (m.userData[ck] || 0) : 0;
  }, { k: kind, ck: key });
}

async function postFxCount(win, name) {
  return await win.evaluate((n) => {
    const s = window.__archdiscScene;
    const fx = s && s.userData && s.userData.studioPostFx;
    return fx && fx[n] ? fx[n].count : 0;
  }, name);
}

test('Studio Blender batch 14 — 5 modifier-stack + 7 PostProcessVolume parity ops', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 100,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'cube');
  await win.waitForTimeout(300);

  // ---- Modeling tab — 5 modifier-stack ops ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(280);

  const modOps = [
    ['mod-bevel',       'archdiscStudioModBevel'],
    ['mod-solidify',    'archdiscStudioModSolidify'],
    ['mod-skin',        'archdiscStudioModSkin'],
    ['mod-wireframe',   'archdiscStudioModWireframe'],
    ['mod-triangulate', 'archdiscStudioModTriangulate'],
  ];
  for (const [action, key] of modOps) {
    const btn = win.locator(`[data-studio-ribbon-action="${action}"]`);
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await win.waitForTimeout(220);
    expect(await meshCounter(win, 'cube', key), `op ${action}`).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '01-after-modifiers.png'), fullPage: false });

  // ---- Compositing tab — 7 PostProcessVolume ops ----
  // (Unreal PostProcessVolume maps to Blender's compositor discipline.)
  const compTab = win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="compositing"]');
  await compTab.scrollIntoViewIfNeeded();
  await compTab.click();
  await win.waitForFunction(() => {
    const rc = document.querySelector('.ribbon-content');
    return rc && rc.getAttribute('data-studio-ribbon-discipline') === 'compositing';
  }, null, { timeout: 10000 });
  await win.waitForTimeout(320);

  const ppOps = [
    ['pp-ssao',          'ssao'],
    ['pp-motion-blur',   'motionBlur'],
    ['pp-dof',           'depthOfField'],
    ['pp-film-grain',    'filmGrain'],
    ['pp-lens-flare',    'lensFlare'],
    ['pp-tone-map',      'toneMap'],
    ['pp-auto-exposure', 'autoExposure'],
  ];
  for (const [action, fxName] of ppOps) {
    const btn = win.locator(`[data-studio-ribbon-action="${action}"]`);
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await win.waitForTimeout(200);
    expect(await postFxCount(win, fxName), `pp ${action}`).toBeGreaterThan(0);
  }
  await win.screenshot({ path: path.join(OUT, '02-after-postfx.png'), fullPage: false });

  // Final orbit pass — verify scene still renders after all ops.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender batch 14: 12 ops (5 modifier-stack + 7 PostProcessVolume parity)`);

  await app.close();
});
