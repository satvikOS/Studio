import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-shader');

test('Studio V3 — shader graph editor + bake + apply (slice shader-1)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  // Launch with --dev so Electron loads from the Vite dev server (port
  // 3000) and we can dynamic-import the shader autoload module by URL
  // even when api.js orchestration hasn't been wired yet by the other
  // agent. The remaining flow (selection, mesh, ops) matches the other
  // V3 specs.
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // ─── Ensure the shader module is installed. Either api.js has been
  // wired by the orchestrator (preferred) or we install it ourselves
  // via the autoload entry on the dev server. ────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioShaderNodeAdd !== 'function') {
      await import('/src/workbenches/studio/v3/shader/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioShaderNodeAdd === 'function', null, { timeout: 15000 });

  // ─── Spawn a cube and attach selection. ────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    vp.transformControls.attach(cube);
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ─── The default-seeded graph should already have 4 nodes. ─────────
  const seeded = await win.evaluate(() => window.__studioShaderListNodes());
  expect(seeded.ok).toBe(true);
  expect(seeded.count).toBeGreaterThanOrEqual(4);

  // ─── Programmatic node CRUD. ───────────────────────────────────────
  const rgb = await win.evaluate(() => window.__studioShaderNodeAdd('rgb', { color: [1, 0, 0] }));
  expect(rgb.ok).toBe(true);
  expect(typeof rgb.uuid).toBe('string');

  const out = await win.evaluate(() => {
    const list = window.__studioShaderListNodes().nodes;
    return list.find((n) => n.kind === 'output');
  });
  expect(out).toBeTruthy();

  const conn = await win.evaluate(({ src, dst }) =>
    window.__studioShaderNodeConnect(src, 'color', dst, 'color'),
  { src: rgb.uuid, dst: out.uuid });
  expect(conn.ok).toBe(true);

  // ─── Evaluate to PNG. ───────────────────────────────────────────────
  const ev = await win.evaluate(() => window.__studioShaderEvaluate());
  expect(ev.ok).toBe(true);
  expect(ev.dataUrl).toMatch(/^data:image\/png/);
  expect(ev.size).toBe(256);

  // ─── Apply to selection, assert mat.map is set. ────────────────────
  const apply = await win.evaluate(() => window.__studioShaderApplyToSelection());
  expect(apply.ok).toBe(true);
  const hasMap = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return { hasMap: !!(mat && mat.map), isStandard: mat && mat.type === 'MeshStandardMaterial' };
  });
  expect(hasMap.hasMap).toBe(true);
  expect(hasMap.isStandard).toBe(true);

  await win.screenshot({ path: path.join(OUT, '01-applied.png') });

  // ─── Serialize → clear → deserialize round-trips. ──────────────────
  const ser = await win.evaluate(() => window.__studioShaderGraphSerialize());
  expect(ser.ok).toBe(true);
  expect(Array.isArray(ser.json.nodes)).toBe(true);
  const nodeCountBefore = ser.json.nodes.length;

  await win.evaluate(() => {
    // Wipe everything by deserializing an empty graph, then restore.
    window.__studioShaderGraphDeserialize({ version: 1, nodes: [], wires: [] });
  });
  const empty = await win.evaluate(() => window.__studioShaderListNodes());
  expect(empty.count).toBe(0);

  const restored = await win.evaluate((j) => window.__studioShaderGraphDeserialize(j), ser.json);
  expect(restored.ok).toBe(true);
  expect(restored.count).toBe(nodeCountBefore);

  // ─── Editor open → DOM mounted → close. ────────────────────────────
  await win.evaluate(() => window.__studioShaderEditorOpen());
  await expect(win.locator('[data-studio-v3-shader-editor]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '02-editor-open.png') });

  // Add a node from the toolbar inside the editor.
  await win.locator('[data-studio-v3-shader-add="noise"]').first().click();
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '03-editor-add-noise.png') });

  // Apply via the editor button — the apply button bakes + assigns.
  await win.locator('[data-studio-v3-shader-apply]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-editor-apply.png') });

  // Close via the button.
  await win.locator('[data-studio-v3-shader-close]').click();
  await expect(win.locator('[data-studio-v3-shader-editor]')).toBeHidden();

  // ─── Multi-cam viewport screenshots (front / top / right / iso). ───
  for (const view of ['front', 'top', 'right', 'iso']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 0, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `05-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  shader graph: nodes=%d, applied map ok=%s', restored.count, hasMap.hasMap);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
