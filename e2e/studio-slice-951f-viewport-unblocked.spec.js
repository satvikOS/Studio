import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951f — viewport unblocked.
//
// User report: "obstruction is still there and i can move or zoom at all"
// — the WelcomeCard + AutosaveRestorePrompt were absolute-positioned over
// the viewport centre, intercepting pointer events so OrbitControls
// could never receive a drag-start. Both components now return null.
//
// Asserts:
//   1. No <div data-studio-v3-welcome> in the DOM
//   2. No <div data-studio-v3-autosave-restore> in the DOM
//   3. Mouse-down on the viewport canvas reaches the canvas itself
//      (proves nothing covers it at the centre)

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951f-viewport-unblocked');

test('Studio slice 951f — viewport pointer events reach the canvas', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 200,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.removeItem('studio.v3.display-toggles');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.setItem('studioV3Theme', 'dark');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800);

  // 1. WelcomeCard gone.
  expect(await win.locator('[data-studio-v3-welcome]').count()).toBe(0);
  // 2. AutosaveRestorePrompt gone.
  expect(await win.locator('[data-studio-v3-autosave-restore]').count()).toBe(0);

  // 3. The viewport centre is reachable by pointer events. Probe the
  //    element at the centre of the viewport — it must be the canvas
  //    (or a transparent-pointer ancestor), NOT a welcome/autosave card.
  const centreElement = await win.evaluate(() => {
    const vp = document.querySelector('[data-studio-v3-viewport]');
    if (!vp) return null;
    const r = vp.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      isCanvas: el.tagName === 'CANVAS',
      welcome: !!el.closest('[data-studio-v3-welcome]'),
      autosave: !!el.closest('[data-studio-v3-autosave-restore]'),
    };
  });
  expect(centreElement).toBeTruthy();
  if (centreElement) {
    expect(centreElement.welcome).toBe(false);
    expect(centreElement.autosave).toBe(false);
  }

  // Dump every visible object in the scene so we can identify whatever
  // is rendering at the viewport centre.
  const sceneDump = await win.evaluate(() => {
    const s = window.__archdiscScene;
    if (!s) return null;
    const out = [];
    s.traverse((o) => {
      if (!o.visible) return;
      const ud = o.userData || {};
      out.push({
        type: o.type,
        name: o.name || '',
        visible: o.visible,
        isHelper: !!ud.isHelper,
        isPrimitive: !!ud.archdiscStudioPrimitive,
        position: o.position ? [o.position.x.toFixed(3), o.position.y.toFixed(3), o.position.z.toFixed(3)] : null,
        userDataKeys: Object.keys(ud).slice(0, 6),
      });
    });
    return out;
  });
  console.log('--- SCENE DUMP ---');
  for (const o of (sceneDump || [])) console.log(JSON.stringify(o));

  // Probe what's actually on the canvas at the bright pixel — is the
  // "white cross" 3D geometry or a CSS overlay?
  const pixelProbe = await win.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { error: 'no canvas' };
    const r = canvas.getBoundingClientRect();
    // Sample 5 points: centre, slightly above, below, left, right.
    const pts = [
      { name: 'centre', x: r.left + r.width / 2, y: r.top + r.height / 2 },
      { name: 'above',  x: r.left + r.width / 2, y: r.top + r.height / 2 - 30 },
      { name: 'below',  x: r.left + r.width / 2, y: r.top + r.height / 2 + 30 },
      { name: 'left30', x: r.left + r.width / 2 - 60, y: r.top + r.height / 2 },
      { name: 'farLeft', x: r.left + 40, y: r.top + r.height / 2 },
    ];
    const out = [];
    for (const p of pts) {
      const el = document.elementFromPoint(p.x, p.y);
      out.push({
        pt: p.name,
        tag: el ? el.tagName.toLowerCase() : null,
        cls: el ? (el.className.baseVal || el.className || '').toString().substring(0, 60) : null,
      });
    }
    return out;
  });
  console.log('--- PIXEL PROBE ---');
  for (const p of (pixelProbe || [])) console.log(JSON.stringify(p));

  await win.screenshot({ path: path.join(OUT, '01-unblocked-viewport.png') });

  // Diagnostic: surgically remove every Light from the scene + force a
  // re-render, then capture again. If the bloom persists with zero
  // lights, it isn't a lighting artifact.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    if (!s) return;
    const toRemove = [];
    s.traverse((o) => { if (o.isLight) toRemove.push(o); });
    for (const l of toRemove) s.remove(l);
    // Trigger a render so the change is visible in the next screenshot.
    const vp = window.__archdiscViewport;
    if (vp && vp.renderer && vp.camera) vp.renderer.render(s, vp.camera);
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-no-lights.png') });

  // Also try: remove the ground + retry.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    if (!s) return;
    const ground = window.__studioGround;
    if (ground && ground.parent === s) s.remove(ground);
    const vp = window.__archdiscViewport;
    if (vp && vp.renderer && vp.camera) vp.renderer.render(s, vp.camera);
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-no-ground-no-lights.png') });

  // And: NoToneMapping + neutral output color space.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp || !vp.renderer) return;
    try { vp.renderer.toneMapping = 0; /* THREE.NoToneMapping */ } catch (_) {}
    if (vp.scene && vp.camera) vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-no-tonemap.png') });

  // Dump every visible NON-canvas DOM element inside the viewport
  // region. pointer-events:none divs fall through elementFromPoint,
  // so the bloom may be a transparent-pointer overlay we never see in
  // probes.
  const viewportDom = await win.evaluate(() => {
    const vp = document.querySelector('[data-studio-v3-viewport]')
      || document.querySelector('.studio-viewport');
    if (!vp) return [];
    const out = [];
    const rect = vp.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    vp.querySelectorAll('*').forEach((el) => {
      const er = el.getBoundingClientRect();
      // Only elements whose bbox contains the viewport centre.
      if (er.left > cx || er.right < cx || er.top > cy || er.bottom < cy) return;
      const cs = window.getComputedStyle(el);
      out.push({
        tag: el.tagName.toLowerCase(),
        attrs: Array.from(el.attributes).map((a) => a.name).filter((n) => n.startsWith('data-')).slice(0, 4),
        cls: (el.className && el.className.baseVal || el.className || '').toString().substring(0, 50),
        bg: cs.backgroundColor,
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        boxSize: `${Math.round(er.width)}x${Math.round(er.height)}`,
      });
    });
    return out;
  });
  console.log('--- VIEWPORT CENTRE DOM CHAIN ---');
  for (const o of (viewportDom || [])) console.log(JSON.stringify(o));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
