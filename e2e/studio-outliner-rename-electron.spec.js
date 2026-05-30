import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 200: OUTLINER RENAME (ZBrush Subtool parity).
 *
 * Double-click an Outliner entry label to rename the mesh. Enter
 * commits, Escape cancels. Survives a round-trip through
 * __studioSaveScene / __studioLoadScene (slice 195) so renamed
 * subtools persist.
 *
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-outliner-rename');

test('Studio — double-click Outliner label renames the mesh', async () => {
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

  // Build a sphere so we have something to rename.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'rename demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'sphere', pos: [0, 0, 0], scale: [1, 1, 1], color: '#c9a' },
      ],
      expect: { bodies: 1, kinds: ['sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  // Initial name follows the studio-primitive-<kind>-N pattern.
  const initialName = await win.evaluate(() => {
    let n = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') n = o.name;
    });
    return n;
  });
  expect(initialName, 'sphere named').toMatch(/sphere/);
  await win.screenshot({ path: path.join(OUT, '00-default-name.png') });

  // Dispatch a dblclick on the Outliner label + edit the contenteditable
  // text + blur to commit. The label gets contentEditable=true on dblclick.
  const renameResult = await win.evaluate(() => {
    const label = document.querySelector('[data-studio-outliner-label]');
    if (!label) return { ok: false, why: 'no label' };
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    if (label.contentEditable !== 'true') return { ok: false, why: 'not editable' };
    label.textContent = 'MyHeroSphere';
    label.dispatchEvent(new Event('blur'));
    let n = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') n = o.name;
    });
    return { ok: true, meshName: n };
  });
  expect(renameResult.ok, 'rename flow ran').toBe(true);
  expect(renameResult.meshName, 'mesh.name updated').toBe('MyHeroSphere');
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '01-renamed.png') });

  // Round-trip through save/load preserves the new name.
  const roundTrip = await win.evaluate(() => {
    const saved = window.__studioSaveScene();
    const parsed = JSON.parse(saved);
    const savedName = parsed.primitives[0] && parsed.primitives[0].name;
    // Wipe + reload
    const s = window.__archdiscScene;
    const toRemove = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) toRemove.push(o); });
    for (const m of toRemove) s.remove(m);
    window.__studioLoadScene(saved);
    let reloadedName = null;
    s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') reloadedName = o.name;
    });
    return { savedName, reloadedName };
  });
  expect(roundTrip.savedName, 'save preserved name').toBe('MyHeroSphere');
  expect(roundTrip.reloadedName, 'load restored name').toBe('MyHeroSphere');
  await win.screenshot({ path: path.join(OUT, '02-survived-roundtrip.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 200: Outliner rename (ZBrush Subtool parity) + save-load round-trip working');

  await app.close();
});
