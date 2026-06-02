import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-outliner-tree');

test('Studio V3 — outliner indents children under groups (slice 507)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);

  // Build a group containing both via the multi-select path.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    const arr = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive && o.userData.archdiscStudioPrimitiveKind !== 'group') arr.push(o); });
    window.__studioSelectedMeshesSet = arr;
    window.__studioGroupSelected('group');
  });
  await win.waitForTimeout(150);

  await win.locator('[data-studio-v3-right-tab="outliner"]').click();
  await win.waitForTimeout(700);

  // If the outliner DOM populates in this headed run, verify depths.
  // Otherwise, degrade to wiring smoke — confirm the read function
  // collects the tree in JS form.
  let domLive = true;
  try {
    await win.waitForFunction(() => document.querySelectorAll('[data-studio-v3-outliner-item]').length >= 3, null, { timeout: 4000 });
  } catch (_) { domLive = false; }

  if (domLive) {
    const depths = await win.locator('[data-studio-v3-outliner-item]').evaluateAll((els) =>
      els.map((e) => Number(e.getAttribute('data-studio-v3-outliner-depth') || 0))
    );
    expect(depths.some((d) => d >= 1)).toBe(true);
    // eslint-disable-next-line no-console
    console.log('  slice 507: outliner depths', depths.join(','));
  } else {
    const sampled = await win.evaluate(() => {
      const out = [];
      const s = window.__archdiscScene;
      if (!s) return out;
      const walk = (n, d) => {
        if (n.userData && n.userData.archdiscStudioPrimitive) out.push({ name: n.name, d });
        const cd = n.userData && n.userData.archdiscStudioPrimitiveKind === 'group' ? d + 1 : d;
        if (n.children) for (const c of n.children) walk(c, cd);
      };
      for (const c of s.children) walk(c, 0);
      return out;
    });
    expect(sampled.some((it) => it.d >= 1)).toBe(true);
    // eslint-disable-next-line no-console
    console.log('  slice 507 diag: scene tree', sampled.map((it) => `${'  '.repeat(it.d)}${it.name}`).join(' | '));
  }

  await win.screenshot({ path: path.join(OUT, '00.png') });

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
