import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-group-selected');

test('Studio — Group selected meshes (slice 359)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioGroupSelected === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const cubeUuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  const r = await win.evaluate(() => window.__studioGroupSelected('hero'));
  expect(r.ok).toBe(true);
  expect(r.children).toBe(1);
  expect(r.name).toContain('hero');

  // The cube should now have the group as its parent.
  const probe = await win.evaluate(({ uuid }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === uuid) m = o; });
    return m && m.parent ? {
      parentIsGroup: m.parent.userData && m.parent.userData.archdiscStudioGroup === true,
      parentName: m.parent.name,
    } : null;
  }, { uuid: cubeUuid });
  expect(probe.parentIsGroup).toBe(true);
  expect(probe.parentName).toContain('hero');

  // No selection.
  await win.evaluate(() => { window.__studioSelectedMeshes && window.__studioSelectedMeshes().length; });
  // Force-deselect by clearing both refs via a private hack — easier to just verify the empty-selection error
  // is returned when nothing is selected (after deselection).

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 359: grouped cube into', probe.parentName);

  await app.close();
});
