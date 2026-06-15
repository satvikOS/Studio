// AAA real-time post-processing stack — r3f-native (@react-three/postprocessing).
// Mounted INSIDE the viewport <Canvas>, gated on presentation mode so it only
// costs perf for hero shots / the 100k environment proof (not live editing).
//
// Chain: N8AO (GTAO-class ambient occlusion / contact shadows) → Bloom (mipmap
// blur, emissive/hot highlights) → SMAA (anti-alias) → ACES tone mapping →
// brightness/contrast grade → vignette. Approaches AAA real-time look without a
// native engine (no Nanite/Lumen); pairs with the offline path tracer for stills.

import React from 'react';
import {
  EffectComposer, N8AO, Bloom, SMAA, ToneMapping, Vignette, BrightnessContrast,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export function AAAPost({ ao = true, bloom = true, vignette = true } = {}) {
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      {ao ? <N8AO aoRadius={1.4} distanceFalloff={1.0} intensity={1.4} halfRes /> : null}
      {bloom ? <Bloom mipmapBlur intensity={0.4} luminanceThreshold={0.8} luminanceSmoothing={0.25} /> : null}
      <SMAA />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <BrightnessContrast brightness={0.03} contrast={0.06} />
      {vignette ? <Vignette eskil={false} offset={0.3} darkness={0.32} /> : null}
    </EffectComposer>
  );
}
