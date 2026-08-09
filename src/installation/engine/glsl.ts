/**
 * Shared GLSL chunks. Kept as strings rather than .glsl files so the kiosk build
 * stays a plain Vite/TS pipeline with no extra loader plugin.
 */

/** Ashima simplex noise, 3D. Public domain / MIT. */
export const SIMPLEX3 = /* glsl */ `
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

/** Fractal sum of simplex noise. Requires SIMPLEX3. */
export const FBM = /* glsl */ `
float fbm(vec3 p, int octaves){
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++){
    if (i >= octaves) break;
    sum += amp * snoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
`;

/**
 * Divergence-free curl of a simplex potential field. Particles advected by this
 * swirl without ever bunching up, which is what keeps the clouds looking like
 * air rather than like a scatter plot. Requires SIMPLEX3.
 */
export const CURL = /* glsl */ `
vec3 curlNoise(vec3 p){
  const float e = 0.08;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  float x0 = snoise(p - dx), x1 = snoise(p + dx);
  float y0 = snoise(p - dy), y1 = snoise(p + dy);
  float z0 = snoise(p - dz), z1 = snoise(p + dz);

  vec3 q = p + 137.31;
  float qx0 = snoise(q - dx), qx1 = snoise(q + dx);
  float qy0 = snoise(q - dy), qy1 = snoise(q + dy);
  float qz0 = snoise(q - dz), qz1 = snoise(q + dz);

  vec3 r = p - 219.77;
  float rx0 = snoise(r - dx), rx1 = snoise(r + dx);
  float ry0 = snoise(r - dy), ry1 = snoise(r + dy);
  float rz0 = snoise(r - dz), rz1 = snoise(r + dz);

  float inv = 1.0 / (2.0 * e);
  vec3 dP1 = vec3(x1 - x0, y1 - y0, z1 - z0) * inv;
  vec3 dP2 = vec3(qx1 - qx0, qy1 - qy0, qz1 - qz0) * inv;
  vec3 dP3 = vec3(rx1 - rx0, ry1 - ry0, rz1 - rz0) * inv;

  return normalize(vec3(
    dP3.y - dP2.z,
    dP1.z - dP3.x,
    dP2.x - dP1.y
  ) + 1e-6);
}
`;

export const HASH = /* glsl */ `
float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec3 hash31(float p){
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const EASING = /* glsl */ `
float easeInOutCubic(float t){
  return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0;
}
float easeOutQuart(float t){ return 1.0 - pow(1.0 - t, 4.0); }
float remap(float v, float a, float b, float c, float d){
  return c + (d - c) * clamp((v - a) / (b - a), 0.0, 1.0);
}
`;

/**
 * Converts a size in world units into gl_PointSize.
 *
 * projectionMatrix[1][1] is 1/tan(fov/2), so this is the exact perspective
 * projection of a world-space diameter onto the framebuffer. Doing it properly
 * rather than with a tuned constant is what keeps sprites at the same apparent
 * size on a 1080p panel and a 4K one — with a hand-tuned constant, every sprite
 * in the piece halves in relative size the moment it runs on a denser screen.
 *
 * Requires the uHalfHeight uniform from TOUCH_UNIFORMS.
 */
export const POINT_SIZE = /* glsl */ `
float pointSizeFor(float worldSize, float viewZ){
  return clamp(worldSize * projectionMatrix[1][1] * uHalfHeight / max(-viewZ, 0.05), 1.0, 220.0);
}
`;

/** Soft round sprite with a hot core — the base look of every particle here. */
export const SPRITE = /* glsl */ `
float spriteAlpha(vec2 uv, float softness){
  float d = length(uv - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, softness, d);
  float halo = exp(-d * 3.2) * 0.55;
  return clamp(core + halo, 0.0, 1.0);
}
`;

/** Narkowicz ACES approximation — keeps the hot gold from clipping to white. */
export const ACES = /* glsl */ `
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
`;

/**
 * Up to MAX_TOUCHES live touch points, in world space, with a 0..1 strength that
 * decays after release. Scenes read this to bend geometry toward fingers.
 */
export const TOUCH_UNIFORMS = /* glsl */ `
/** Half the framebuffer height in device pixels; see pointSizeFor. */
uniform float uHalfHeight;

#define MAX_TOUCHES 6
uniform vec3 uTouchPos[MAX_TOUCHES];
uniform float uTouchStrength[MAX_TOUCHES];
uniform int uTouchCount;

vec3 touchDisplace(vec3 worldPos, float radius, float force){
  vec3 sum = vec3(0.0);
  for (int i = 0; i < MAX_TOUCHES; i++){
    if (i >= uTouchCount) break;
    vec3 d = worldPos - uTouchPos[i];
    float dist = length(d);
    float falloff = 1.0 - smoothstep(0.0, radius, dist);
    sum += normalize(d + 1e-5) * falloff * falloff * force * uTouchStrength[i];
  }
  return sum;
}

float touchGlow(vec3 worldPos, float radius){
  float g = 0.0;
  for (int i = 0; i < MAX_TOUCHES; i++){
    if (i >= uTouchCount) break;
    float dist = length(worldPos - uTouchPos[i]);
    g = max(g, (1.0 - smoothstep(0.0, radius, dist)) * uTouchStrength[i]);
  }
  return g;
}
`;

/** Ripples spawned on tap: xyz = world origin, w = seconds since the tap. */
export const RIPPLE_UNIFORMS = /* glsl */ `
#define MAX_RIPPLES 5
uniform vec4 uRipples[MAX_RIPPLES];
uniform int uRippleCount;

/** Ring-shaped pulse travelling outward from each recent tap. */
float rippleField(vec3 worldPos, float speed, float life, float width){
  float sum = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++){
    if (i >= uRippleCount) break;
    vec4 r = uRipples[i];
    float age = r.w;
    if (age > life) continue;
    float dist = length(worldPos - r.xyz);
    float front = age * speed;
    float ring = exp(-pow((dist - front) / width, 2.0));
    sum += ring * (1.0 - age / life);
  }
  return sum;
}
`;

/**
 * Photographic ground, turned into engraved ground.
 *
 * The estate arrives as an aerial photograph, and a photograph sits badly in a
 * piece drawn entirely in light: next to a hand-built figure it reads as a
 * screenshot pasted behind the artwork. This inks it instead — the luminance
 * terraced into a few levels like a survey drawing, a hairline where the levels
 * meet, and a hatch that thickens into the shadows — so the land is drawn in the
 * same hand as everything standing on it.
 *
 * `world` is the ground position, so the hatch belongs to the estate and does
 * not swim when the camera moves. `strength` is how far to take it: 1 is a pure
 * engraving, and a little under keeps a memory of the vineyard's own colour.
 */
export const ENGRAVE = /* glsl */ `
vec3 engrave(vec3 rgb, vec2 world, float strength, float scale,
             vec3 low, vec3 mid, vec3 high){
  float l = clamp(dot(rgb, vec3(0.299, 0.587, 0.114)) * 1.35, 0.0, 1.0);

  const float LEVELS = 6.0;
  float terraced = floor(l * LEVELS) / LEVELS;
  float rise = abs(fract(l * LEVELS) - 0.5);
  float contour = smoothstep(0.34, 0.5, rise);

  vec2 p = world * scale;
  float a = sin(p.x * 0.72 + p.y * 0.72);
  float b = sin(p.x * 0.66 - p.y * 0.66 + 1.7);
  float dark = 1.0 - terraced;
  float hatch = smoothstep(0.55, 1.0, a) * dark
              + smoothstep(0.78, 1.0, b) * dark * dark * 0.7;

  vec3 ink = mix(low, mid, smoothstep(0.0, 0.5, terraced));
  ink = mix(ink, high, smoothstep(0.5, 0.95, terraced));
  ink += contour * high * 0.42;
  ink += hatch * mid * 0.55;

  return mix(rgb, ink, strength);
}
`;

/**
 * The painter's ramp: a luminance walked along three chosen colours, banded
 * softly, with the band edges wobbled by noise.
 *
 * Adapted from the approach in Paulius Kairevicius' Ghibli-style landscape pen,
 * which solved the problem three earlier attempts here did not. Posterising a
 * photograph's luminance either blows it out or crushes it to black, because
 * the output brightness is whatever the arithmetic lands on. A ramp cannot do
 * that: the darkest thing it can produce is `shade` and the brightest is `lit`,
 * both chosen from the palette. The wobble is what stops the bands reading as a
 * broken JPEG — a painted edge is uneven, a posterised one is not.
 */
export const RAMP3 = /* glsl */ `
vec3 ramp3(float t, vec3 shade, vec3 mid, vec3 lit, float soft, float jit){
  float a = smoothstep(0.17 - soft + jit, 0.17 + soft + jit, t);
  float b = smoothstep(0.58 - soft + jit, 0.58 + soft + jit, t);
  return mix(mix(shade, mid, a), lit, b);
}
`;
