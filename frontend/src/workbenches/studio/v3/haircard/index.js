// ArchDisc Studio V3 — hair card baker (slice 816).
// Marmoset Toolbag / Unreal Hair Card workflow: take slice-760 groom
// strands, project them into screen-space ribbons, capture into a
// rectangular atlas texture, emit quad cards textured with that atlas.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _bakeAtlas({ groomUuid, atlasSize = 512, cardsPerRow = 4 } = {}) {
  const groom = window.__studioGroomGet ? window.__studioGroomGet(groomUuid) : null;
  const strands = groom?.strands;
  if (!strands?.length) return { ok: false, error: 'no strands' };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = atlasSize;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, atlasSize, atlasSize);
  const cellSize = atlasSize / cardsPerRow;
  const stride = Math.max(1, Math.floor(strands.length / (cardsPerRow * cardsPerRow)));
  let cardIdx = 0;
  for (let i = 0; i < strands.length && cardIdx < cardsPerRow * cardsPerRow; i += stride) {
    const strand = strands[i];
    const cx = (cardIdx % cardsPerRow) * cellSize;
    const cy = Math.floor(cardIdx / cardsPerRow) * cellSize;
    ctx.strokeStyle = `hsla(${(cardIdx*47)%60+10}, 60%, ${30+Math.random()*20}%, 0.85)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let j = 0; j < strand.length; j++) {
      const t = j / Math.max(1, strand.length - 1);
      const x = cx + cellSize * 0.5 + Math.sin(t * Math.PI * 2 + i) * cellSize * 0.2;
      const y = cy + t * cellSize * 0.95 + 4;
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    cardIdx++;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  // Generate card quads in the scene
  const scene = window.__archdiscScene;
  const group = new THREE.Group();
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'haircard';
  for (let i = 0; i < cardIdx; i++) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 });
    const w = 0.04, h = 0.08;
    const geom = new THREE.PlaneGeometry(w, h, 1, 1);
    const uvCol = i % cardsPerRow, uvRow = Math.floor(i / cardsPerRow);
    const u0 = uvCol / cardsPerRow, u1 = (uvCol + 1) / cardsPerRow;
    const v0 = 1 - (uvRow + 1) / cardsPerRow, v1 = 1 - uvRow / cardsPerRow;
    const uv = geom.attributes.uv;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
    const card = new THREE.Mesh(geom, mat);
    const ang = (i / cardIdx) * Math.PI * 2;
    card.position.set(Math.cos(ang) * 0.015, h / 2, Math.sin(ang) * 0.015);
    card.lookAt(0, h, 0);
    group.add(card);
  }
  scene?.add(group);
  return { ok: true, uuid: group.uuid, cards: cardIdx, atlasDataUrl: canvas.toDataURL('image/png') };
}
export function installHairCard() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioHairCardBake: _bakeAtlas,
    __studioHairCardList: () => {
      const items = [];
      window.__archdiscScene?.traverse((o) => { if (o.userData?.archdiscStudioPrimitiveKind === 'haircard') items.push(o.uuid); });
      return { ok: true, items };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'fx', 'Hair card baker (Marmoset / Unreal HairCard)');
  return { ok: true };
}
export default installHairCard;
