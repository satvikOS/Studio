// Slice 698 — Raymarched volume fragment shader (GLSL3).
// CRITICAL: no markdown backticks inside the template literal — the
// slice-693 rtgpu agent broke the build with that exact bug.

export const VOLUME_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
out vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const VOLUME_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec3 vWorldPos;
out vec4 fragOut;

uniform sampler3D uVolume;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
uniform vec3 uCameraPos;
uniform float uDensityScale;
uniform float uTempScale;
uniform int uSteps;
uniform vec3 uLightDir;

// Intersect a ray with the AABB; returns near and far t.
bool _hitAABB(vec3 ro, vec3 rd, vec3 mn, vec3 mx, out float tnear, out float tfar) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (mn - ro) * inv;
  vec3 t1 = (mx - ro) * inv;
  vec3 tlo = min(t0, t1);
  vec3 thi = max(t0, t1);
  tnear = max(max(tlo.x, tlo.y), tlo.z);
  tfar = min(min(thi.x, thi.y), thi.z);
  return tfar >= max(tnear, 0.0);
}

// Blackbody-ish 1D LUT from temperature to color.
vec3 _blackbody(float t) {
  return vec3(t * 1.7, t * 0.8, t * 0.3);
}

void main() {
  vec3 ro = uCameraPos;
  vec3 rd = normalize(vWorldPos - uCameraPos);
  float tnear, tfar;
  if (!_hitAABB(ro, rd, uBoundsMin, uBoundsMax, tnear, tfar)) discard;
  tnear = max(tnear, 0.0);

  int N = uSteps > 0 ? uSteps : 64;
  float step = (tfar - tnear) / float(N);
  vec3 pos = ro + rd * tnear;
  vec3 stepV = rd * step;
  vec3 size = uBoundsMax - uBoundsMin;

  vec4 acc = vec4(0.0);
  for (int i = 0; i < 256; i++) {
    if (i >= N || acc.a > 0.99) break;
    vec3 uvw = (pos - uBoundsMin) / size;
    vec4 sample_ = texture(uVolume, uvw);
    float density = sample_.r * uDensityScale;
    float temperature = sample_.g * uTempScale;
    if (density > 0.001) {
      // Phong-ish self-shadowing along the light direction.
      vec3 lightStep = uLightDir * 0.05;
      float shadow = 0.0;
      for (int s = 0; s < 4; s++) {
        vec3 sp = pos + lightStep * float(s + 1);
        vec3 suvw = (sp - uBoundsMin) / size;
        shadow += texture(uVolume, suvw).r;
      }
      float alpha = density * step * 4.0;
      vec3 col = vec3(0.7, 0.7, 0.75) * (1.0 - clamp(shadow * 0.3, 0.0, 0.8));
      col += _blackbody(temperature) * 2.0;
      acc.rgb += (1.0 - acc.a) * alpha * col;
      acc.a += (1.0 - acc.a) * alpha;
    }
    pos += stepV;
  }
  fragOut = acc;
}
`;
