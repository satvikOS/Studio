import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-project-paint');

test('Studio — Mari project-paint from camera (slice 295)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioProjectPaintFromCamera === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'project paint demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [4, 4, 4], color: '#fff' }],
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

  // Build a 32x32 source image: pure red on the LEFT half, pure black on the right.
  const res = await win.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 32);
    ctx.fillStyle = '#000000'; ctx.fillRect(16, 0, 16, 32);
    const src = ctx.getImageData(0, 0, 32, 32);
    return window.__studioProjectPaintFromCamera({ sourceImageData: src, size: 128 });
  });
  expect(res.ok).toBe(true);
  expect(res.size).toBe(128);
  expect(res.projected).toBeGreaterThan(0);

  // Inspect the destination canvas — at least 1% red pixels (visible mesh covers
  // a small NDC area at default camera distance).
  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const t = m.material.map;
    if (!t || !t.image) return null;
    const c = t.image; const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let red = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      total++;
      if (d[i] > 100 && d[i + 1] < 60 && d[i + 2] < 60) red++;
    }
    return { red, total, w: c.width };
  });
  expect(probe.w).toBe(128);
  // At least 50 red pixels — proves projection wrote color from source.
  expect(probe.red).toBeGreaterThan(50);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 295: project-paint projected', res.projected, 'texels; red pixels in result =', probe.red);

  await app.close();
});
