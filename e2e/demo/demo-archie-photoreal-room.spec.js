// END-STATE: type a room prompt → the LIVE model (modeling-cua-photoreal) drives
// the real UI (place-furniture real models → set-selection arrange → click-stage-
// preset → render) → a photoreal room, created AND processed purely by the model
// via CUA. No composer in the agent path; the render is the model's own render op.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path'; import fs from 'fs';
const OUT = path.resolve(__dirname, 'shots', 'studio', 'archie-photoreal');
const PROMPTS = [
  'design a cozy living room with a sofa, coffee table, two armchairs, a bookshelf and a plant',
  'set up a warm home office — a desk, an office chair, a bookshelf, a desk lamp and a plant',
];
const pick = PROMPTS[Date.now() % PROMPTS.length];
test('Archie autonomously creates + renders a photoreal room (model-driven, pure CUA)', async () => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 40 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen','1'); window.sessionStorage.setItem('studio.v3.splash-shown','1'); } catch(_){} }).catch(()=>{});
  await win.reload().catch(()=>{});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
  await expect(win.locator('[data-studio-v3-cmdbar-input]')).toBeVisible({ timeout: 15000 });
  await win.evaluate(() => { window.__studioLastRender = null; });
  const input = win.locator('[data-studio-v3-cmdbar-input]');
  await input.click(); await input.type(pick, { delay: 14 });
  console.log(`[archie-photoreal] prompt → "${pick}"`);
  await input.press('Enter');
  // wait for the model to drive the whole sequence and its render op to land.
  let render = null;
  for (let i = 0; i < 130; i++) {           // up to ~260s
    await win.waitForTimeout(2000);
    const st = await win.evaluate(() => {
      const s = window.__archdiscScene; let furn = 0;
      if (s) s.traverse((o) => { if (o.userData && o.userData.archdiscRealMaterial && o.parent === s) furn++; });
      return { furn, render: window.__studioLastRender ? { w: window.__studioLastRender.width, h: window.__studioLastRender.height, has: !!window.__studioLastRender.dataUrl } : null };
    });
    if (st.render && st.render.has) { render = st.render; break; }
  }
  const final = await win.evaluate(() => {
    const s = window.__archdiscScene; let furn = 0;
    if (s) s.traverse((o) => { if (o.userData && o.userData.archdiscRealMaterial && o.parent === s) furn++; });
    const r = window.__studioLastRender;
    return { furn, dataUrl: r && r.dataUrl, w: r && r.width, h: r && r.height };
  });
  if (final.dataUrl) fs.writeFileSync(path.join(OUT, 'archie-room.png'), Buffer.from(final.dataUrl.split(',')[1], 'base64'));
  console.log(`[archie-photoreal] real-furniture groups=${final.furn}  render=${final.w}x${final.h}`);
  await win.evaluate(()=>{ window.__studioV3Dirty=false; window.onbeforeunload=null; }).catch(()=>{});
  await app.close();
  expect(final.furn, 'model placed real furniture').toBeGreaterThanOrEqual(4);
  expect(!!final.dataUrl, 'model rendered the room').toBeTruthy();
});
