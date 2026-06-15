// Procedural texture library — wood/fabric/leather/marble/metal/concrete/ceramic.
// Tileable canvas textures (color + normal + roughness), pure 2D canvas + math,
// fully local. Cached per id. Consumed by rtgpu/PathTracedRender.js (the path
// tracer bakes .map/.normalMap/.roughnessMap; geometry needs computeTangents for normals).
import * as THREE from 'three';

const GENERATORS = {
  "wood-oak": function(THREE, size = 512) {
  // Seeded noise implementation
  function hash(x, y, seed = 0) {
    let h = seed + x * 73856093 ^ y * 19349663;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) & 0x7fffffff;
  }

  function noise2D(x, y, seed = 0) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const u = xf * xf * (3.0 - 2.0 * xf);
    const v = yf * yf * (3.0 - 2.0 * yf);

    const h00 = hash(xi, yi, seed);
    const h10 = hash(xi + 1, yi, seed);
    const h01 = hash(xi, yi + 1, seed);
    const h11 = hash(xi + 1, yi + 1, seed);

    const n00 = (h00 % 256) / 256 * 2 - 1;
    const n10 = (h10 % 256) / 256 * 2 - 1;
    const n01 = (h01 % 256) / 256 * 2 - 1;
    const n11 = (h11 % 256) / 256 * 2 - 1;

    const nx0 = n00 * (1 - u) + n10 * u;
    const nx1 = n01 * (1 - u) + n11 * u;
    return nx0 * (1 - v) + nx1 * v;
  }

  function fbm(x, y, octaves = 4, seed = 0) {
    let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * noise2D(x * frequency, y * frequency, seed + i);
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value / maxValue;
  }

  // Create canvases
  const canvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Base oak color palette
  const baseColor = { r: 212, g: 165, b: 116 };
  const darkColor = { r: 160, g: 115, b: 70 };
  const lightColor = { r: 235, g: 190, b: 145 };

  // Generate wood map
  const mapData = ctx.createImageData(size, size);
  const mapPixels = mapData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const ny = y / size;
      const nx = x / size;

      // Vertical grain pattern with directional flow
      const grain = fbm(nx * 8, ny * 4, 5, 42);
      const grainDir = Math.sin(ny * Math.PI * 2 * 0.8 + grain * 2) * 0.3 + grain;
      
      // Growth ring pattern (circular with vertical offset)
      const ringDist = Math.sqrt((nx - 0.5) ** 2 + (ny * 2 - 1) ** 2);
      const rings = Math.sin(ringDist * 20 - grainDir * 3) * 0.5 + 0.5;
      
      // Large scale color variation
      const largeMod = fbm(nx * 2, ny * 1.5, 3, 100) * 0.6;
      
      // Combine patterns
      const woodValue = grainDir * 0.7 + rings * 0.2 + largeMod * 0.1;
      const woodClamped = Math.max(0, Math.min(1, woodValue));

      // Blend colors based on wood value
      let r, g, b;
      if (woodClamped < 0.5) {
        const t = woodClamped * 2;
        r = Math.round(darkColor.r * (1 - t) + baseColor.r * t);
        g = Math.round(darkColor.g * (1 - t) + baseColor.g * t);
        b = Math.round(darkColor.b * (1 - t) + baseColor.b * t);
      } else {
        const t = (woodClamped - 0.5) * 2;
        r = Math.round(baseColor.r * (1 - t) + lightColor.r * t);
        g = Math.round(baseColor.g * (1 - t) + lightColor.g * t);
        b = Math.round(baseColor.b * (1 - t) + lightColor.b * t);
      }

      mapPixels[idx] = r;
      mapPixels[idx + 1] = g;
      mapPixels[idx + 2] = b;
      mapPixels[idx + 3] = 255;
    }
  }
  ctx.putImageData(mapData, 0, 0);

  // Create normal map
  const normalCanvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = size;
  const nCtx = normalCanvas.getContext('2d', { willReadFrequently: true });

  const normalData = nCtx.createImageData(size, size);
  const normalPixels = normalData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const ny = y / size;
      const nx = x / size;

      // Grain-aligned normal variation
      const grainNoise = fbm(nx * 12, ny * 6, 4, 200);
      const grainGradient = fbm((nx + 0.01) * 12, ny * 6, 4, 200) - grainNoise;
      
      // Normal pointing slightly along grain
      let normalX = grainGradient * 0.6 + fbm(nx * 6, ny * 3, 3, 201) * 0.3;
      let normalY = grainNoise * 0.8;
      let normalZ = Math.sqrt(Math.max(0, 1 - normalX * normalX - normalY * normalY));

      // Normalize
      const len = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
      if (len > 0) {
        normalX /= len;
        normalY /= len;
        normalZ /= len;
      }

      // Convert to 0-255 range (normal map format)
      normalPixels[idx] = Math.round((normalX + 1) * 127.5);
      normalPixels[idx + 1] = Math.round((normalY + 1) * 127.5);
      normalPixels[idx + 2] = Math.round((normalZ + 1) * 127.5);
      normalPixels[idx + 3] = 255;
    }
  }
  nCtx.putImageData(normalData, 0, 0);

  // Create roughness map
  const roughCanvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d', { willReadFrequently: true });

  const roughData = rCtx.createImageData(size, size);
  const roughPixels = roughData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const ny = y / size;
      const nx = x / size;

      // Base roughness with grain emphasis
      const grainDef = fbm(nx * 10, ny * 5, 4, 300);
      const pores = fbm(nx * 20, ny * 20, 3, 301) * 0.4;
      
      // Roughness increases in grain valleys
      const roughValue = 0.45 + grainDef * 0.25 + pores * 0.15;
      const roughClamped = Math.max(0.35, Math.min(0.7, roughValue));
      const roughByte = Math.round(roughClamped * 255);

      roughPixels[idx] = roughByte;
      roughPixels[idx + 1] = roughByte;
      roughPixels[idx + 2] = roughByte;
      roughPixels[idx + 3] = 255;
    }
  }
  rCtx.putImageData(roughData, 0, 0);

  // Create THREE textures
  const mapTexture = new THREE.CanvasTexture(canvas);
  mapTexture.wrapS = mapTexture.wrapT = THREE.RepeatWrapping;
  mapTexture.colorSpace = THREE.SRGBColorSpace;
  mapTexture.magFilter = THREE.LinearFilter;
  mapTexture.minFilter = THREE.LinearMipmapLinearFilter;

  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.colorSpace = THREE.NoColorSpace;
  normalTexture.magFilter = THREE.LinearFilter;
  normalTexture.minFilter = THREE.LinearMipmapLinearFilter;

  const roughnessTexture = new THREE.CanvasTexture(roughCanvas);
  roughnessTexture.wrapS = roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.colorSpace = THREE.LinearSRGBColorSpace;
  roughnessTexture.magFilter = THREE.LinearFilter;
  roughnessTexture.minFilter = THREE.LinearMipmapLinearFilter;

  return {
    map: mapTexture,
    normalMap: normalTexture,
    roughnessMap: roughnessTexture
  };
},
  "wood-walnut": function(THREE, size = 512) {
  // Seeded noise implementation
  function hash(x, y, seed = 0) {
    let h = seed + x * 73856093 ^ y * 19349663;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) & 0x7fffffff;
  }

  function noise2D(x, y, seed = 0) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const u = xf * xf * (3.0 - 2.0 * xf);
    const v = yf * yf * (3.0 - 2.0 * yf);

    const h00 = hash(xi, yi, seed);
    const h10 = hash(xi + 1, yi, seed);
    const h01 = hash(xi, yi + 1, seed);
    const h11 = hash(xi + 1, yi + 1, seed);

    const n00 = (h00 % 256) / 256 * 2 - 1;
    const n10 = (h10 % 256) / 256 * 2 - 1;
    const n01 = (h01 % 256) / 256 * 2 - 1;
    const n11 = (h11 % 256) / 256 * 2 - 1;

    const nx0 = n00 * (1 - u) + n10 * u;
    const nx1 = n01 * (1 - u) + n11 * u;
    return nx0 * (1 - v) + nx1 * v;
  }

  function fbm(x, y, octaves = 4, seed = 0) {
    let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * noise2D(x * frequency, y * frequency, seed + i);
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value / maxValue;
  }

  // Create canvases
  const canvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Walnut color palette - deep browns
  const darkColor = { r: 42, g: 28, b: 15 };
  const baseColor = { r: 74, g: 55, b: 40 };
  const mediumColor = { r: 110, g: 80, b: 55 };
  const lightColor = { r: 140, g: 100, b: 70 };

  // Generate wood map
  const mapData = ctx.createImageData(size, size);
  const mapPixels = mapData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const ny = y / size;
      const nx = x / size;

      // Prominent vertical grain pattern
      const grain1 = fbm(nx * 10, ny * 4, 5, 50);
      const grain2 = fbm(nx * 5, ny * 2, 4, 51);
      const grainDir = Math.sin(ny * Math.PI * 2 * 1.2 + grain1 * 2.5) * 0.4 + grain1 * 0.6;
      
      // Growth ring pattern with vertical modulation
      const ringDist = Math.sqrt((nx - 0.5) ** 2 + (ny * 2.5 - 1.2) ** 2);
      const rings = Math.sin(ringDist * 25 - grainDir * 4) * 0.5 + 0.5;
      
      // Large scale banding for walnut's characteristic patterns
      const largeMod = fbm(nx * 1.5, ny * 0.8, 3, 110);
      const bandMod = Math.sin(ny * Math.PI * 3 + largeMod * 2) * 0.5 + 0.5;
      
      // Combine patterns with emphasis on grain
      const woodValue = grainDir * 0.65 + rings * 0.15 + grain2 * 0.1 + bandMod * 0.1;
      const woodClamped = Math.max(0, Math.min(1, woodValue));

      // Blend colors: dark -> base -> medium -> light
      let r, g, b;
      if (woodClamped < 0.33) {
        const t = woodClamped / 0.33;
        r = Math.round(darkColor.r * (1 - t) + baseColor.r * t);
        g = Math.round(darkColor.g * (1 - t) + baseColor.g * t);
        b = Math.round(darkColor.b * (1 - t) + baseColor.b * t);
      } else if (woodClamped < 0.67) {
        const t = (woodClamped - 0.33) / 0.34;
        r = Math.round(baseColor.r * (1 - t) + mediumColor.r * t);
        g = Math.round(baseColor.g * (1 - t) + mediumColor.g * t);
        b = Math.round(baseColor.b * (1 - t) + mediumColor.b * t);
      } else {
        const t = (woodClamped - 0.67) / 0.33;
        r = Math.round(mediumColor.r * (1 - t) + lightColor.r * t);
        g = Math.round(mediumColor.g * (1 - t) + lightColor.g * t);
        b = Math.round(mediumColor.b * (1 - t) + lightColor.b * t);
      }

      mapPixels[idx] = r;
      mapPixels[idx + 1] = g;
      mapPixels[idx + 2] = b;
      mapPixels[idx + 3] = 255;
    }
  }
  ctx.putImageData(mapData, 0, 0);

  // Create normal map
  const normalCanvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = size;
  const nCtx = normalCanvas.getContext('2d', { willReadFrequently: true });

  const normalData = nCtx.createImageData(size, size);
  const normalPixels = normalData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const ny = y / size;
      const nx = x / size;

      // Strong grain-aligned normal variation for walnut's pronounced grain
      const grainNoise = fbm(nx * 15, ny * 6, 5, 210);
      const grainGradient = fbm((nx + 0.015) * 15, ny * 6, 5, 210) - grainNoise;
      
      // Directional normal along grain
      let normalX = grainGradient * 0.75 + fbm(nx * 8, ny * 3, 3, 211) * 0.25;
      let normalY = grainNoise * 0.85;
      let normalZ = Math.sqrt(Math.max(0, 1 - normalX * normalX - normalY * normalY));

      // Normalize
      const len = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
      if (len > 0) {
        normalX /= len;
        normalY /= len;
        normalZ /= len;
      }

      // Convert to 0-255 range
      normalPixels[idx] = Math.round((normalX + 1) * 127.5);
      normalPixels[idx + 1] = Math.round((normalY + 1) * 127.5);
      normalPixels[idx + 2] = Math.round((normalZ + 1) * 127.5);
      normalPixels[idx + 3] = 255;
    }
  }
  nCtx.putImageData(normalData, 0, 0);

  // Create roughness map
  const roughCanvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d', { willReadFrequently: true });

  const roughData = rCtx.createImageData(size, size);
  const roughPixels = roughData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const ny = y / size;
      const nx = x / size;

      // Base roughness slightly higher than oak, grain-dependent
      const grainDef = fbm(nx * 12, ny * 5, 4, 310);
      const pores = fbm(nx * 24, ny * 24, 3, 311) * 0.45;
      const striations = Math.abs(Math.sin(ny * Math.PI * 4 + grainDef * 3)) * 0.2;
      
      // Roughness emphasizes grain structure
      const roughValue = 0.50 + grainDef * 0.28 + pores * 0.15 + striations * 0.1;
      const roughClamped = Math.max(0.38, Math.min(0.78, roughValue));
      const roughByte = Math.round(roughClamped * 255);

      roughPixels[idx] = roughByte;
      roughPixels[idx + 1] = roughByte;
      roughPixels[idx + 2] = roughByte;
      roughPixels[idx + 3] = 255;
    }
  }
  rCtx.putImageData(roughData, 0, 0);

  // Create THREE textures
  const mapTexture = new THREE.CanvasTexture(canvas);
  mapTexture.wrapS = mapTexture.wrapT = THREE.RepeatWrapping;
  mapTexture.colorSpace = THREE.SRGBColorSpace;
  mapTexture.magFilter = THREE.LinearFilter;
  mapTexture.minFilter = THREE.LinearMipmapLinearFilter;

  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.colorSpace = THREE.NoColorSpace;
  normalTexture.magFilter = THREE.LinearFilter;
  normalTexture.minFilter = THREE.LinearMipmapLinearFilter;

  const roughnessTexture = new THREE.CanvasTexture(roughCanvas);
  roughnessTexture.wrapS = roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.colorSpace = THREE.LinearSRGBColorSpace;
  roughnessTexture.magFilter = THREE.LinearFilter;
  roughnessTexture.minFilter = THREE.LinearMipmapLinearFilter;

  return {
    map: mapTexture,
    normalMap: normalTexture,
    roughnessMap: roughnessTexture
  };
},
  "fabric-grey": (THREE, size=512) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Seeded noise for deterministic results
  const seeded = (() => {
    let seed = 42;
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  })();

  // Perlin-like noise using improved sine-based hash
  const noise = (x, y, freq = 1) => {
    const sx = Math.sin(x * freq) * 10000;
    const sy = Math.sin(y * freq) * 10000;
    const val = Math.sin(sx + sy) * Math.sin(sx - sy);
    return Math.abs(val % 1);
  };

  // Fabric parameters
  const warpDensity = 8;
  const weftDensity = 8;
  const threadVariation = 0.15;
  const greyBase = [168, 168, 168];
  const roughnessScale = 0.65;

  // Create base grey with subtle noise
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;
  const normCanvas = document.createElement('canvas');
  normCanvas.width = normCanvas.height = size;
  const normCtx = normCanvas.getContext('2d');
  const normData = normCtx.createImageData(size, size);
  const nData = normData.data;
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext('2d');
  const rData = roughCtx.createImageData(size, size);
  const rPixels = rData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Warp and weft lines
      const warpPos = (x / size) * warpDensity;
      const weftPos = (y / size) * weftDensity;
      const warpFrac = warpPos % 1;
      const weftFrac = weftPos % 1;
      const warpInt = Math.floor(warpPos);
      const weftInt = Math.floor(weftPos);

      // Thread color variation
      const warpVar = noise(warpInt * 7, 43, 0.5) * threadVariation;
      const weftVar = noise(weftInt * 11, 53, 0.5) * threadVariation;
      const crossVar = noise(warpInt * 13, weftInt * 17, 0.3) * (threadVariation * 0.5);

      const threadNoise = noise(x * 0.02, y * 0.02, 2) * 0.08;
      const baseGrey = [
        greyBase[0] * (1 - warpVar - weftVar + crossVar + threadNoise),
        greyBase[1] * (1 - warpVar * 0.8 - weftVar * 0.8 + crossVar + threadNoise),
        greyBase[2] * (1 - warpVar - weftVar + crossVar + threadNoise)
      ];

      // Weave visibility: threads are darker where they go under
      const warpWeight = Math.sin(warpFrac * Math.PI) * 0.3;
      const weftWeight = Math.sin(weftFrac * Math.PI) * 0.3;
      const weaveFactor = Math.max(0.7, 1 - warpWeight - weftWeight);

      data[idx] = Math.round(Math.max(50, Math.min(220, baseGrey[0] * weaveFactor)));
      data[idx + 1] = Math.round(Math.max(50, Math.min(220, baseGrey[1] * weaveFactor)));
      data[idx + 2] = Math.round(Math.max(50, Math.min(220, baseGrey[2] * weaveFactor)));
      data[idx + 3] = 255;

      // Normal map: subtle bumps along threads
      const normX = (warpWeight * 0.3) * Math.cos(warpFrac * Math.PI * 2);
      const normY = (weftWeight * 0.3) * Math.sin(weftFrac * Math.PI * 2);
      const normZ = Math.sqrt(Math.max(0, 1 - normX * normX - normY * normY));
      nData[idx] = Math.round(128 + normX * 127);
      nData[idx + 1] = Math.round(128 + normY * 127);
      nData[idx + 2] = Math.round(normZ * 255);
      nData[idx + 3] = 255;

      // Roughness map: fabric is rough
      const roughBase = roughnessScale;
      const roughThread = (warpWeight + weftWeight) * 0.2;
      const roughNoise = noise(x * 0.03, y * 0.03, 1.5) * 0.1;
      rPixels[idx] = Math.round((roughBase + roughThread + roughNoise) * 255);
      rPixels[idx + 1] = rPixels[idx];
      rPixels[idx + 2] = rPixels[idx];
      rPixels[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  normCtx.putImageData(normData, 0, 0);
  roughCtx.putImageData(rData, 0, 0);

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;

  return { map, normalMap, roughnessMap };
},
  "fabric-linen": (THREE, size=512) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Seeded noise
  const seeded = (() => {
    let seed = 123;
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  })();

  // Perlin-like noise
  const noise = (x, y, freq = 1) => {
    const sx = Math.sin(x * freq) * 10000;
    const sy = Math.sin(y * freq) * 10000;
    const val = Math.sin(sx + sy) * Math.sin(sx - sy);
    return Math.abs(val % 1);
  };

  // Linen parameters
  const warpDensity = 6;
  const weftDensity = 6;
  const threadVariation = 0.22;
  const linenetBase = [212, 197, 185];
  const slubFrequency = 0.08;
  const roughnessScale = 0.72;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;
  const normCanvas = document.createElement('canvas');
  normCanvas.width = normCanvas.height = size;
  const normCtx = normCanvas.getContext('2d');
  const normData = normCtx.createImageData(size, size);
  const nData = normData.data;
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext('2d');
  const rData = roughCtx.createImageData(size, size);
  const rPixels = rData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Warp and weft positioning
      const warpPos = (x / size) * warpDensity;
      const weftPos = (y / size) * weftDensity;
      const warpFrac = warpPos % 1;
      const weftFrac = weftPos % 1;
      const warpInt = Math.floor(warpPos);
      const weftInt = Math.floor(weftPos);

      // Linen slub effect: occasional thick places in threads
      const warpSlub = Math.abs(Math.sin(noise(warpInt * 19, 73) * Math.PI)) > (1 - slubFrequency) ? 0.3 : 0;
      const weftSlub = Math.abs(Math.sin(noise(weftInt * 23, 83) * Math.PI)) > (1 - slubFrequency) ? 0.3 : 0;

      // Thread color: natural linen has banding
      const warpVar = noise(warpInt * 7, 43, 0.5) * threadVariation;
      const weftVar = noise(weftInt * 11, 53, 0.5) * threadVariation;
      const bandVar = Math.sin((warpInt + weftInt) * 0.3) * 0.1;
      const nubNoise = noise(x * 0.04, y * 0.04, 1.2) * 0.12;

      const baseLinene = [
        linenetBase[0] * (1 - warpVar - weftVar + bandVar + nubNoise),
        linenetBase[1] * (1 - warpVar * 0.9 - weftVar * 0.9 + bandVar + nubNoise * 0.8),
        linenetBase[2] * (1 - warpVar - weftVar + bandVar + nubNoise)
      ];

      // Weave visibility with slub
      const warpWeight = (Math.sin(warpFrac * Math.PI) * 0.25 + warpSlub * 0.15);
      const weftWeight = (Math.sin(weftFrac * Math.PI) * 0.25 + weftSlub * 0.15);
      const weaveFactor = Math.max(0.65, 1 - warpWeight - weftWeight);

      data[idx] = Math.round(Math.max(40, Math.min(240, baseLinene[0] * weaveFactor)));
      data[idx + 1] = Math.round(Math.max(40, Math.min(240, baseLinene[1] * weaveFactor)));
      data[idx + 2] = Math.round(Math.max(40, Math.min(240, baseLinene[2] * weaveFactor)));
      data[idx + 3] = 255;

      // Normal map: linen has more visible nubs
      const normX = (warpWeight * 0.4 + warpSlub * 0.2) * Math.cos(warpFrac * Math.PI * 2);
      const normY = (weftWeight * 0.4 + weftSlub * 0.2) * Math.sin(weftFrac * Math.PI * 2);
      const nubNorm = noise(x * 0.05, y * 0.05, 1.5) * 0.15;
      const normZ = Math.sqrt(Math.max(0, 1 - (normX + nubNorm * 0.3) * (normX + nubNorm * 0.3) - (normY + nubNorm * 0.3) * (normY + nubNorm * 0.3)));
      nData[idx] = Math.round(128 + (normX + nubNorm * 0.2) * 127);
      nData[idx + 1] = Math.round(128 + (normY + nubNorm * 0.2) * 127);
      nData[idx + 2] = Math.round(Math.max(50, normZ * 255));
      nData[idx + 3] = 255;

      // Roughness: linen is quite rough, especially at slubs
      const roughBase = roughnessScale;
      const roughThread = (warpWeight + weftWeight) * 0.25;
      const roughSlub = (warpSlub + weftSlub) * 0.15;
      const roughNoise = noise(x * 0.035, y * 0.035, 1.3) * 0.12;
      rPixels[idx] = Math.round((roughBase + roughThread + roughSlub + roughNoise) * 255);
      rPixels[idx + 1] = rPixels[idx];
      rPixels[idx + 2] = rPixels[idx];
      rPixels[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  normCtx.putImageData(normData, 0, 0);
  roughCtx.putImageData(rData, 0, 0);

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;

  return { map, normalMap, roughnessMap };
},
  "leather-tan": (THREE, size = 512) => {
  const canvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : (() => { const c = document.createElement('canvas'); c.width = c.height = size; return c; })();
  
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const normalData = new Uint8ClampedArray(size * size * 4);
  const roughnessData = new Uint8ClampedArray(size * size * 4);
  
  // Seeded noise functions
  const seededRandom = (() => {
    let seed = 0x12345678;
    return () => {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 256) / 256;
    };
  })();
  
  const perlinNoise = (x, y, freq = 1) => {
    const xi = Math.floor(x * freq) & 255;
    const yi = Math.floor(y * freq) & 255;
    const xf = (x * freq) - Math.floor(x * freq);
    const yf = (y * freq) - Math.floor(y * freq);
    
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    
    const hash = (i, j) => {
      let h = 5381;
      h = ((h << 5) + h) ^ (i * 73856093);
      h = ((h << 5) + h) ^ (j * 19349663);
      return Math.sin(h) * 0.5 + 0.5;
    };
    
    const n0 = hash(xi, yi);
    const n1 = hash(xi + 1, yi);
    const n2 = hash(xi, yi + 1);
    const n3 = hash(xi + 1, yi + 1);
    
    const nx0 = n0 + u * (n1 - n0);
    const nx1 = n2 + u * (n3 - n2);
    return nx0 + v * (nx1 - nx0);
  };
  
  const valueNoise = (x, y, freq = 1) => {
    const xi = Math.floor(x * freq);
    const yi = Math.floor(y * freq);
    const xf = x * freq - Math.floor(x * freq);
    const yf = y * freq - Math.floor(y * freq);
    
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    
    const hash = (i, j) => {
      let n = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    
    const n0 = hash(xi, yi);
    const n1 = hash(xi + 1, yi);
    const n2 = hash(xi, yi + 1);
    const n3 = hash(xi + 1, yi + 1);
    
    const nx0 = n0 + u * (n1 - n0);
    const nx1 = n2 + u * (n3 - n2);
    return nx0 + v * (nx1 - nx0);
  };
  
  // Base color: warm tan
  const baseR = 193, baseG = 154, baseB = 107;
  
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const idx = (i * size + j) * 4;
      const u = j / size;
      const v = i / size;
      
      // Pebbled grain pattern
      const pebble = valueNoise(u, v, 6) * 0.3 +
                     valueNoise(u * 2, v * 2, 3) * 0.4 +
                     valueNoise(u * 4, v * 4, 1.5) * 0.3;
      
      // Pore structure
      const poreBase = perlinNoise(u, v, 8);
      const pores = Math.pow(Math.abs(poreBase - 0.5) * 2, 2.5);
      
      // Color variation
      const colorVar = (valueNoise(u * 3, v * 3, 2) - 0.5) * 30;
      const aging = (valueNoise(u * 1.5, v * 1.5, 0.8) - 0.5) * 40;
      
      // Combined texture
      const textureVal = pebble * 0.6 + (1 - pores) * 0.4;
      
      const r = Math.floor(Math.max(0, Math.min(255, baseR + colorVar + aging * 0.5 - (1 - textureVal) * 20)));
      const g = Math.floor(Math.max(0, Math.min(255, baseG + colorVar + aging * 0.3 - (1 - textureVal) * 15)));
      const b = Math.floor(Math.max(0, Math.min(255, baseB + colorVar + aging * 0.2 - (1 - textureVal) * 10)));
      
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
      
      // Normal map: emphasize pebbles and pores
      const nx = (valueNoise(u + 0.01, v, 6) - valueNoise(u - 0.01, v, 6)) * 20;
      const ny = (valueNoise(u, v + 0.01, 6) - valueNoise(u, v - 0.01, 6)) * 20;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      
      normalData[idx] = Math.floor(127 + nx * 8);
      normalData[idx + 1] = Math.floor(127 + ny * 8);
      normalData[idx + 2] = Math.floor(nz * 255 / Math.sqrt(2));
      normalData[idx + 3] = 255;
      
      // Roughness map: leather is relatively rough
      const roughVal = 0.6 + pebble * 0.25 + (1 - pores) * 0.15;
      roughnessData[idx] = Math.floor(roughVal * 255);
      roughnessData[idx + 1] = Math.floor(roughVal * 255);
      roughnessData[idx + 2] = Math.floor(roughVal * 255);
      roughnessData[idx + 3] = 255;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  
  const normalCanvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : (() => { const c = document.createElement('canvas'); c.width = c.height = size; return c; })();
  const normalCtx = normalCanvas.getContext('2d', { willReadFrequently: true });
  const normalImgData = normalCtx.createImageData(size, size);
  normalImgData.data.set(normalData);
  normalCtx.putImageData(normalImgData, 0, 0);
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  
  const roughCanvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : (() => { const c = document.createElement('canvas'); c.width = c.height = size; return c; })();
  const roughCtx = roughCanvas.getContext('2d', { willReadFrequently: true });
  const roughImgData = roughCtx.createImageData(size, size);
  roughImgData.data.set(roughnessData);
  roughCtx.putImageData(roughImgData, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  
  return { map, normalMap, roughnessMap };
},
  "marble-white": (THREE, size = 512) => {
  const canvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : (() => { const c = document.createElement('canvas'); c.width = c.height = size; return c; })();
  
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const normalData = new Uint8ClampedArray(size * size * 4);
  const roughnessData = new Uint8ClampedArray(size * size * 4);
  
  const hash = (x, y) => {
    let n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  
  const perlinNoise = (x, y, freq = 1) => {
    const xi = Math.floor(x * freq) & 255;
    const yi = Math.floor(y * freq) & 255;
    const xf = (x * freq) - Math.floor(x * freq);
    const yf = (y * freq) - Math.floor(y * freq);
    
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    
    const h = (i, j) => {
      let n = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    
    const n0 = h(xi, yi);
    const n1 = h(xi + 1, yi);
    const n2 = h(xi, yi + 1);
    const n3 = h(xi + 1, yi + 1);
    
    const nx0 = n0 + u * (n1 - n0);
    const nx1 = n2 + u * (n3 - n2);
    return nx0 + v * (nx1 - nx0);
  };
  
  const turbulence = (x, y, octaves = 4) => {
    let val = 0, amp = 1, freq = 1;
    for (let i = 0; i < octaves; i++) {
      val += Math.abs(perlinNoise(x, y, freq) - 0.5) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return val;
  };
  
  const baseR = 245, baseG = 245, baseB = 240;
  const veinR = 128, veinG = 128, veinB = 128;
  
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const idx = (i * size + j) * 4;
      const u = j / size;
      const v = i / size;
      
      // Main vein structure
      const flow = perlinNoise(u * 2.5, v * 0.8, 1) * Math.PI * 2;
      const veinDir = Math.cos(flow) * u + Math.sin(flow) * v;
      
      // Turbulent veining
      const turb = turbulence(u, v, 4) * 0.4;
      const veinPattern = Math.sin((veinDir + turb) * 6) * 0.5 + 0.5;
      const veinStrength = Math.pow(veinPattern, 2.5);
      
      // Secondary vein branches
      const branch = perlinNoise(u * 4, v * 4, 2) * 0.3;
      const finalVein = Math.max(veinStrength * 0.7, branch * 0.4);
      
      // Color: blend white base with grey veins
      const r = Math.floor(baseR - finalVein * (baseR - veinR) * 0.6);
      const g = Math.floor(baseG - finalVein * (baseG - veinG) * 0.6);
      const b = Math.floor(baseB - finalVein * (baseB - veinB) * 0.6);
      
      // Subtle color variation in white base
      const baseVar = (perlinNoise(u * 3, v * 3, 1.5) - 0.5) * 15;
      
      data[idx] = Math.max(0, Math.min(255, r + baseVar));
      data[idx + 1] = Math.max(0, Math.min(255, g + baseVar));
      data[idx + 2] = Math.max(0, Math.min(255, b + baseVar));
      data[idx + 3] = 255;
      
      // Normal map: very subtle, just vein ridges
      const veinNormalStr = finalVein * 0.15;
      const dxVein = (Math.sin((veinDir + turb + 0.01) * 6) - Math.sin((veinDir + turb - 0.01) * 6)) * 10;
      const dyVein = (Math.cos((veinDir + 0.01 + turb) * 6) - Math.cos((veinDir - 0.01 + turb) * 6)) * 10;
      
      normalData[idx] = Math.floor(127 + dxVein * 3);
      normalData[idx + 1] = Math.floor(127 + dyVein * 3);
      normalData[idx + 2] = Math.floor(255 * 0.95);
      normalData[idx + 3] = 255;
      
      // Roughness: marble is polished, low roughness
      const roughVal = 0.12 + finalVein * 0.08;
      roughnessData[idx] = Math.floor(roughVal * 255);
      roughnessData[idx + 1] = Math.floor(roughVal * 255);
      roughnessData[idx + 2] = Math.floor(roughVal * 255);
      roughnessData[idx + 3] = 255;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  
  const normalCanvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : (() => { const c = document.createElement('canvas'); c.width = c.height = size; return c; })();
  const normalCtx = normalCanvas.getContext('2d', { willReadFrequently: true });
  const normalImgData = normalCtx.createImageData(size, size);
  normalImgData.data.set(normalData);
  normalCtx.putImageData(normalImgData, 0, 0);
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  
  const roughCanvas = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(size, size) 
    : (() => { const c = document.createElement('canvas'); c.width = c.height = size; return c; })();
  const roughCtx = roughCanvas.getContext('2d', { willReadFrequently: true });
  const roughImgData = roughCtx.createImageData(size, size);
  roughImgData.data.set(roughnessData);
  roughCtx.putImageData(roughImgData, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  
  return { map, normalMap, roughnessMap };
},
  "steel-brushed": (THREE, size = 512) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Seeded pseudo-random
  const seed = 12345;
  let rng_state = seed;
  const random = () => {
    rng_state = (rng_state * 9301 + 49297) % 233280;
    return rng_state / 233280;
  };

  // Simple Perlin-ish noise
  const noise = (x, y) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const hash = (h) => Math.sin(h * 12.9898 + 78.233) * 43758.5453 % 1;
    const a = hash(xi + yi * 73);
    const b = hash(xi + 1 + yi * 73);
    const c = hash(xi + (yi + 1) * 73);
    const d = hash(xi + 1 + (yi + 1) * 73);
    const ab = a + (b - a) * u;
    const cd = c + (d - c) * u;
    return ab + (cd - ab) * v;
  };

  // Fill base steel color (dark gray with slight blue tint)
  const baseColor = 'rgb(80, 90, 100)';
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // Add subtle base texture variation
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;
    const n = noise(x / 30, y / 60) * 0.5 + 0.5;
    const variation = Math.round(n * 10 - 5);
    data[i * 4] = Math.max(0, Math.min(255, data[i * 4] + variation));
    data[i * 4 + 1] = Math.max(0, Math.min(255, data[i * 4 + 1] + variation));
    data[i * 4 + 2] = Math.max(0, Math.min(255, data[i * 4 + 2] + variation));
  }
  ctx.putImageData(imgData, 0, 0);

  // Draw horizontal brush strokes
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < size; i += 3) {
    const brightness = 80 + noise(i / 100, 0) * 30;
    ctx.strokeStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i + (noise(0, i / 50) - 0.5) * 2);
    ctx.stroke();
  }

  // Create normal map from brush structure
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = size;
  const nctx = normalCanvas.getContext('2d');
  nctx.fillStyle = 'rgb(128, 128, 255)';
  nctx.fillRect(0, 0, size, size);
  const nImgData = nctx.getImageData(0, 0, size, size);
  const nData = nImgData.data;

  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;
    const brushStrength = Math.sin((y / 3) * Math.PI * 2) * 0.5 + 0.5;
    const normalY = 255 - Math.round(brushStrength * 40);
    nData[i * 4] = 128 + Math.round((noise(x / 40, y / 100) - 0.5) * 20);
    nData[i * 4 + 1] = normalY;
    nData[i * 4 + 2] = 240;
  }
  nctx.putImageData(nImgData, 0, 0);

  // Create roughness map emphasizing brush direction
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  const rImgData = rctx.createImageData(size, size);
  const rData = rImgData.data;

  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;
    const baseRough = 64; // 0.25 in 0-255
    const brushPattern = Math.abs(Math.sin((x / 5) * Math.PI)) * 40;
    const scratches = noise(x / 15, y / 80) * 60;
    const rough = Math.round(baseRough + brushPattern + scratches);
    rData[i * 4] = Math.min(255, rough);
    rData[i * 4 + 1] = Math.min(255, rough);
    rData[i * 4 + 2] = Math.min(255, rough);
    rData[i * 4 + 3] = 255;
  }
  rctx.putImageData(rImgData, 0, 0);

  const mapTexture = new THREE.CanvasTexture(canvas);
  mapTexture.wrapS = mapTexture.wrapT = THREE.RepeatWrapping;
  mapTexture.colorSpace = THREE.SRGBColorSpace;

  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.colorSpace = THREE.NoColorSpace;

  const roughnessTexture = new THREE.CanvasTexture(roughCanvas);
  roughnessTexture.wrapS = roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.colorSpace = THREE.LinearSRGBColorSpace;

  return { map: mapTexture, normalMap: normalTexture, roughnessMap: roughnessTexture };
},
  "concrete": (THREE, size = 512) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Seeded random
  const seed = 54321;
  let rng_state = seed;
  const random = () => {
    rng_state = (rng_state * 9301 + 49297) % 233280;
    return rng_state / 233280;
  };

  // Perlin-ish noise
  const noise = (x, y, scale = 1) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const hash = (h) => Math.sin(h * 12.9898 + 78.233) * 43758.5453 % 1;
    const a = hash(xi + yi * 73);
    const b = hash(xi + 1 + yi * 73);
    const c = hash(xi + (yi + 1) * 73);
    const d = hash(xi + 1 + (yi + 1) * 73);
    const ab = a + (b - a) * u;
    const cd = c + (d - c) * u;
    return ab + (cd - ab) * v;
  };

  // Base concrete color
  const baseColor = 'rgb(200, 200, 200)';
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  // Generate concrete surface
  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;

    // Multi-scale noise for aggregate
    const n1 = noise(x / 30, y / 30) * 0.5;
    const n2 = noise(x / 15, y / 15) * 0.3;
    const n3 = noise(x / 60, y / 60) * 0.2;
    const aggregate = n1 + n2 + n3;

    // Pores (high-freq noise)
    const pores = noise(x / 8, y / 8);
    const poreStrength = pores > 0.7 ? (pores - 0.7) * 3 : 0;

    // Weathering (subtle large-scale variation)
    const weather = noise(x / 100, y / 100) * 0.1;

    const baseVal = 200;
    const aggVal = aggregate * 40;
    const poreVal = -poreStrength * 20;
    const weatherVal = weather * 30;

    const finalVal = Math.round(baseVal + aggVal + poreVal + weatherVal);
    const clamped = Math.max(0, Math.min(255, finalVal));

    data[i * 4] = clamped;
    data[i * 4 + 1] = clamped;
    data[i * 4 + 2] = clamped;
    data[i * 4 + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);

  // Normal map with pore detail
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = size;
  const nctx = normalCanvas.getContext('2d');
  const nImgData = nctx.createImageData(size, size);
  const nData = nImgData.data;

  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;

    // Surface roughness from noise
    const surfaceNoise = noise(x / 20, y / 20);
    const poreNoise = noise(x / 6, y / 6);

    // Normal direction influenced by surface
    let nx = 128 + (surfaceNoise - 0.5) * 30;
    let ny = 200 - (poreNoise - 0.5) * 40; // Downward-facing pores
    let nz = 220;

    nData[i * 4] = Math.max(0, Math.min(255, Math.round(nx)));
    nData[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(ny)));
    nData[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(nz)));
    nData[i * 4 + 3] = 255;
  }

  nctx.putImageData(nImgData, 0, 0);

  // Roughness map - concrete is quite rough
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  const rImgData = rctx.createImageData(size, size);
  const rData = rImgData.data;

  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;

    const baseRough = 180; // ~0.70 roughness
    const aggregateVar = noise(x / 40, y / 40) * 30;
    const poreRough = noise(x / 8, y / 8) * 40;

    const rough = Math.round(baseRough + aggregateVar + poreRough);

    rData[i * 4] = Math.min(255, rough);
    rData[i * 4 + 1] = Math.min(255, rough);
    rData[i * 4 + 2] = Math.min(255, rough);
    rData[i * 4 + 3] = 255;
  }

  rctx.putImageData(rImgData, 0, 0);

  const mapTexture = new THREE.CanvasTexture(canvas);
  mapTexture.wrapS = mapTexture.wrapT = THREE.RepeatWrapping;
  mapTexture.colorSpace = THREE.SRGBColorSpace;

  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.colorSpace = THREE.NoColorSpace;

  const roughnessTexture = new THREE.CanvasTexture(roughCanvas);
  roughnessTexture.wrapS = roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.colorSpace = THREE.LinearSRGBColorSpace;

  return { map: mapTexture, normalMap: normalTexture, roughnessMap: roughnessTexture };
},
  "ceramic-white": (THREE, size = 512) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Seeded random
  const seed = 98765;
  let rng_state = seed;
  const random = () => {
    rng_state = (rng_state * 9301 + 49297) % 233280;
    return rng_state / 233280;
  };

  // Perlin-ish noise
  const noise = (x, y) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const hash = (h) => Math.sin(h * 12.9898 + 78.233) * 43758.5453 % 1;
    const a = hash(xi + yi * 73);
    const b = hash(xi + 1 + yi * 73);
    const c = hash(xi + (yi + 1) * 73);
    const d = hash(xi + 1 + (yi + 1) * 73);
    const ab = a + (b - a) * u;
    const cd = c + (d - c) * u;
    return ab + (cd - ab) * v;
  };

  // Base ceramic white with warm tint
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;

    // Subtle color variation in glaze
    const n1 = noise(x / 100, y / 100);
    const n2 = noise(x / 40, y / 40) * 0.5;

    // Warm white base
    let r = 250 + Math.round((n1 - 0.5) * 8);
    let g = 248 + Math.round((n2 - 0.5) * 6);
    let b = 245 + Math.round((n1 - 0.5) * 6);

    // Micro imperfections (very subtle)
    const microNoise = noise(x / 15, y / 15);
    if (microNoise > 0.85) {
      r -= 3;
      g -= 2;
      b -= 1;
    }

    data[i * 4] = Math.max(0, Math.min(255, r));
    data[i * 4 + 1] = Math.max(0, Math.min(255, g));
    data[i * 4 + 2] = Math.max(0, Math.min(255, b));
    data[i * 4 + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);

  // Draw crazing cracks with very fine detail
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = 'rgba(100, 100, 100, 0.15)';
  ctx.lineWidth = 0.5;

  for (let i = 0; i < size * size / 5000; i++) {
    const sx = random() * size;
    const sy = random() * size;
    ctx.beginPath();
    ctx.moveTo(sx, sy);

    let x = sx, y = sy;
    for (let step = 0; step < 30; step++) {
      const angle = noise(x / 40, y / 40) * Math.PI * 2;
      x += Math.cos(angle) * 3;
      y += Math.sin(angle) * 3;
      if (x < 0 || x > size || y < 0 || y > size) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;

  // Normal map - glossy smooth ceramic
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = size;
  const nctx = normalCanvas.getContext('2d');
  const nImgData = nctx.createImageData(size, size);
  const nData = nImgData.data;

  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;

    // Mostly pointing straight up (high z) due to gloss
    let nx = 128;
    let ny = 128;
    let nz = 250;

    // Very subtle glaze texture
    const glaze = noise(x / 50, y / 50);
    nx += (glaze - 0.5) * 8;
    ny += (glaze - 0.5) * 8;

    // Crazing affects normals slightly
    const crazeFactor = noise(x / 60, y / 60);
    if (crazeFactor > 0.8) {
      nz -= 5;
    }

    nData[i * 4] = Math.max(0, Math.min(255, Math.round(nx)));
    nData[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(ny)));
    nData[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(nz)));
    nData[i * 4 + 3] = 255;
  }

  nctx.putImageData(nImgData, 0, 0);

  // Roughness map - very smooth glossy ceramic
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  const rImgData = rctx.createImageData(size, size);
  const rData = rImgData.data;

  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;

    // Very low base roughness
    const baseRough = 20; // ~0.08 roughness

    // Micro-gloss variation
    const glossVar = noise(x / 30, y / 30) * 15;

    // Crazing increases roughness very slightly
    const crazeNoise = noise(x / 80, y / 80);
    const crazeRough = crazeNoise > 0.75 ? (crazeNoise - 0.75) * 20 : 0;

    const rough = Math.round(baseRough + glossVar + crazeRough);

    rData[i * 4] = Math.min(255, rough);
    rData[i * 4 + 1] = Math.min(255, rough);
    rData[i * 4 + 2] = Math.min(255, rough);
    rData[i * 4 + 3] = 255;
  }

  rctx.putImageData(rImgData, 0, 0);

  const mapTexture = new THREE.CanvasTexture(canvas);
  mapTexture.wrapS = mapTexture.wrapT = THREE.RepeatWrapping;
  mapTexture.colorSpace = THREE.SRGBColorSpace;

  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.colorSpace = THREE.NoColorSpace;

  const roughnessTexture = new THREE.CanvasTexture(roughCanvas);
  roughnessTexture.wrapS = roughnessTexture.wrapT = THREE.RepeatWrapping;
  roughnessTexture.colorSpace = THREE.LinearSRGBColorSpace;

  return { map: mapTexture, normalMap: normalTexture, roughnessMap: roughnessTexture };
},
};

const _cache = {};
export function texturesFor(id) {
  if (!(id in _cache)) {
    const gen = GENERATORS[id];
    try { _cache[id] = gen ? gen(THREE, 512) : null; }
    catch (e) { if (typeof console !== 'undefined') console.warn('[proceduralTextures]', id, e && e.message); _cache[id] = null; }
  }
  return _cache[id];
}
export const TEXTURED_IDS = Object.keys(GENERATORS);
