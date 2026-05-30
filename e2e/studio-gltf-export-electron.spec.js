import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-gltf-export');

test('Studio — Ctrl+E exports scene as GLTF (slice 258)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioDownloadGLTF === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Spawn a viewer-dominant teapot so the export has content.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'gltf export demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(500);

  const filename = await win.evaluate(async () => await window.__studioDownloadGLTF('teapot'));
  expect(filename).toMatch(/^teapot-\d{4}-\d{2}-\d{2}.+\.gltf$/);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 258: GLTF download filename =', filename);

  await app.close();
});
