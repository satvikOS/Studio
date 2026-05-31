import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pbr-sliders');

test('Studio — N-panel PBR sliders mutate material (slice 281)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'pbr sliders demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [4, 4, 4], color: '#aac' }],
      expect: { bodies: 1, kinds: ['sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(400);

  // Move metalness slider to 0.9, roughness to 0.1.
  await win.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const met = document.querySelector('[data-studio-npanel-metalness]');
    setter.call(met, '0.9');
    met.dispatchEvent(new Event('input', { bubbles: true }));
    const rgh = document.querySelector('[data-studio-npanel-roughness]');
    setter.call(rgh, '0.1');
    rgh.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(300);

  const got = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { metalness: m.material.metalness, roughness: m.material.roughness };
  });
  expect(Math.abs(got.metalness - 0.9)).toBeLessThan(1e-6);
  expect(Math.abs(got.roughness - 0.1)).toBeLessThan(1e-6);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 281: PBR sliders set metalness=0.9 roughness=0.1');

  await app.close();
});
