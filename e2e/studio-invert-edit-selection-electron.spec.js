import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-invert-edit-selection');

test('Studio — invert edit selection vert/edge/face (slice 386)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => typeof window.__studioInvertEditSelection === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });

  // Cube BoxGeometry has 24 verts (4 per face — disconnected), 12 tris,
  // 30 unique edges (per face: 4 outer + 1 diagonal = 5, × 6 = 30).

  // VERTEX: select 1 vert, invert → 23 selected.
  await win.evaluate(() => window.__studioReplaceEditSelection('vertex', 0));
  let r = await win.evaluate(() => window.__studioInvertEditSelection('vertex'));
  expect(r.ok).toBe(true);
  expect(r.counts.vertices).toBe(23);

  // Invert again → back to 1 (the original).
  r = await win.evaluate(() => window.__studioInvertEditSelection('vertex'));
  expect(r.counts.vertices).toBe(1);

  // FACE: select 2 of 12, invert → 10.
  await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    window.__studioAddToEditSelection('face', 3);
  });
  r = await win.evaluate(() => window.__studioInvertEditSelection('face'));
  expect(r.counts.faces).toBe(10);

  // EDGE: select 2 real mesh edges, invert → 30 - 2 = 28.
  await win.evaluate(() => {
    window.__studioReplaceEditSelection('edge', [0, 1]);
    window.__studioAddToEditSelection('edge', [4, 5]);
  });
  r = await win.evaluate(() => window.__studioInvertEditSelection('edge'));
  expect(r.counts.edges).toBe(28);

  // Bad mode rejected.
  const bad = await win.evaluate(() => window.__studioInvertEditSelection('paint'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 386: vert/face/edge inversion all return correct counts');

  await app.close();
});
