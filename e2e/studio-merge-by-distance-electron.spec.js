import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-merge-by-distance');

test('Studio — Shift+M merge-by-distance shrinks vertex count (slice 278)', async () => {
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

  // Spawn a cube (24 verts — 4 per face) + select.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'merge demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#9ab' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(500);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);

  // Pre-explode the geometry to non-indexed so there are duplicate verts
  // for merge to collapse. (The default cube is already de-indexed-but-
  // not-position-shared per face; non-indexed makes every triangle have
  // its own 3 verts → 12 tris × 3 = 36 verts.)
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    if (m && m.geometry && m.geometry.toNonIndexed) {
      const ni = m.geometry.toNonIndexed();
      if (m.geometry.dispose) m.geometry.dispose();
      m.geometry = ni;
    }
  });
  const before = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.count);
  expect(before, 'non-indexed cube has 36 verts').toBeGreaterThanOrEqual(24);

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', shiftKey: true, bubbles: true })));
  await win.waitForTimeout(400);

  const after = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.count);
  // mergeVertices keys by all attributes (pos + normal + uv). The
  // non-indexed cube has 36 verts (12 tris × 3). After merge, verts
  // with identical attributes collapse — typically to 24 (4 per face).
  expect(after, 'merge-by-distance reduced verts').toBeLessThan(before);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 278: cube verts before=', before, 'after=', after);

  await app.close();
});
