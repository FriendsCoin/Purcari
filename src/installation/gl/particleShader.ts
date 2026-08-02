/**
 * Particle shader for the Living Archive.
 *
 * One vertex = one recorded detection. The vertex stage does four things:
 *   1. morphs between two act layouts with a per-particle delay (aSeed),
 *   2. adds a continuous simplex-noise drift so the cloud never sits still,
 *   3. pushes grains away from the pointer,
 *   4. dims anything outside the active time window / focused species.
 *
 * Filtering happens here rather than on the CPU so that scrubbing 3000 points
 * costs nothing per frame.
 */

const SIMPLEX_3D = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

export const PARTICLE_VERTEX = /* glsl */ `
attribute vec3 aTo;
attribute vec3 aColorFrom;
attribute vec3 aColorTo;
attribute float aSizeFrom;
attribute float aSizeTo;
attribute float aSeed;
attribute vec3 aJitter;
attribute float aMinute;
attribute float aDay;
attribute float aSpecies;
attribute float aStation;

uniform float uMorph;
uniform float uTime;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uPerspective;
uniform float uDrift;
uniform vec3  uPointer;
uniform float uPointerStrength;
uniform float uPointerRadius;
uniform float uWindowMin;
uniform float uWindowMax;
uniform float uDayCursor;
uniform float uFocusSpecies;
uniform float uFocusStation;
uniform float uArc;

varying vec3 vColor;
varying float vAlpha;
varying float vFlare;

${SIMPLEX_3D}

/** Per-particle eased progress: later seeds leave later, so the cloud unfurls. */
float staggered(float m, float seed){
  const float SPREAD = 0.55;
  float t = clamp(m * (1.0 + SPREAD) - seed * SPREAD, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main(){
  float e = staggered(uMorph, aSeed);

  vec3 pos = mix(position, aTo, e);
  // Bow the flight path outward so travelling grains read as motion, not a slide.
  pos += aJitter * sin(e * 3.14159265) * uArc;

  // Living drift — slow, large scale, never fully at rest.
  vec3 np = pos * 0.045 + vec3(0.0, uTime * 0.045, 0.0);
  vec3 drift = vec3(snoise(np), snoise(np + 31.4), snoise(np + 67.1));
  pos += drift * uDrift * (0.55 + aSeed * 0.9);

  // Pointer repulsion in world space.
  vec3 away = pos - uPointer;
  float dist = length(away);
  float push = uPointerStrength * exp(-(dist * dist) / (2.0 * uPointerRadius * uPointerRadius));
  pos += normalize(away + vec3(1e-4)) * push;

  float alpha = 1.0;
  float sizeMul = 1.0;

  // Time-of-day window (wraps across midnight).
  float inWindow = uWindowMin <= uWindowMax
    ? step(uWindowMin, aMinute) * step(aMinute, uWindowMax)
    : max(step(uWindowMin, aMinute), step(aMinute, uWindowMax));
  alpha *= mix(0.05, 1.0, inWindow);
  sizeMul *= mix(0.55, 1.0, inWindow);

  // Day cursor: the archive fills up as the season plays back.
  float flare = 0.0;
  if (uDayCursor >= 0.0) {
    float arrived = 1.0 - smoothstep(uDayCursor, uDayCursor + 1.2, aDay);
    alpha *= arrived;
    flare = arrived * exp(-max(uDayCursor - aDay, 0.0) * 0.9);
    sizeMul *= 1.0 + flare * 2.2;
  }

  // Focus dimming for hovered species / station.
  if (uFocusSpecies >= 0.0) {
    float hit = step(abs(aSpecies - uFocusSpecies), 0.5);
    alpha *= mix(0.07, 1.0, hit);
    sizeMul *= mix(0.7, 1.7, hit);
  }
  if (uFocusStation >= 0.0) {
    float hit = step(abs(aStation - uFocusStation), 0.5);
    alpha *= mix(0.07, 1.0, hit);
    sizeMul *= mix(0.7, 1.5, hit);
  }

  vColor = mix(aColorFrom, aColorTo, e);
  vAlpha = alpha;
  vFlare = flare;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float grain = mix(aSizeFrom, aSizeTo, e) * sizeMul;
  gl_PointSize = grain * uSizeScale * uPixelRatio * (uPerspective / max(-mv.z, 0.1));
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec3 vColor;
varying float vAlpha;
varying float vFlare;

uniform float uOpacity;

void main(){
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;

  float k = 1.0 - d * 2.0;
  float halo = pow(k, 2.2);   // soft body
  float core = pow(k, 9.0);   // hot centre that bloom picks up

  // Additive blending multiplies rgb by alpha, so the falloff lives in alpha
  // alone — putting it in both would square it and wash the grains out.
  float intensity = (halo * 0.34 + core * 0.62) * vAlpha * uOpacity;
  // Only a whisper of white in the core — additive stacking will push dense
  // regions toward white on its own, and the hour ramp is the point.
  vec3 tint = mix(vColor, vec3(1.0), vFlare * 0.5 + core * 0.14);
  gl_FragColor = vec4(tint, intensity);
}
`;
