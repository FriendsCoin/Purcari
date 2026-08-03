/**
 * Shaders for the basemap.
 *
 * Shared conventions: every material takes `uOpacity` so the whole landscape can
 * fade with the act, and `uReveal` so it can wipe in from the north as the
 * camera arrives instead of popping into existence.
 */

/** Common vertex work: world position, reveal coordinate, camera depth. */
const HEAD = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec2  uRevealRange;
varying vec3  vWorld;
varying float vDepth;
varying float vReveal;

void computeVarying(vec3 worldPos, vec4 mv){
  vWorld = worldPos;
  vDepth = -mv.z;
  float zn = (worldPos.z - uRevealRange.x) / max(uRevealRange.y - uRevealRange.x, 0.001);
  vReveal = 1.0 - smoothstep(uReveal - 0.14, uReveal + 0.02, zn);
}
`;

const FOG = /* glsl */ `
uniform float uOpacity;
uniform vec2  uFog;     // (near, far)
uniform vec2  uExtent;  // half-width, half-depth of the mapped area

varying vec3  vWorld;
varying float vDepth;
varying float vReveal;

float atmosphere(){
  float haze = 1.0 - smoothstep(uFog.x, uFog.y, vDepth);
  // Dissolve at the edge of the surveyed area, so the map ends in atmosphere
  // rather than in a cut slab of ground.
  vec2 q = abs(vWorld.xz) / max(uExtent, vec2(0.001));
  float rim = 1.0 - smoothstep(0.70, 0.99, max(q.x, q.y));
  return haze * rim * uOpacity * vReveal;
}
`;

// ---------------------------------------------------------------------------
// Terrain: hill shading, contour lines, and a survey band sweeping the relief
// ---------------------------------------------------------------------------

export const TERRAIN_VERTEX = /* glsl */ `
${HEAD}
varying vec3 vNormalW;

void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  computeVarying(world.xyz, mv);
  gl_Position = projectionMatrix * mv;
}
`;

export const TERRAIN_FRAGMENT = /* glsl */ `
precision highp float;
${FOG}

uniform vec3  uValley;
uniform vec3  uRidge;
uniform vec3  uContour;
uniform vec3  uScan;
uniform vec3  uSun;
uniform float uMaxHeight;
uniform float uContourStep;
uniform float uTime;
varying vec3  vNormalW;

void main(){
  float a = atmosphere();
  if (a < 0.002) discard;

  float h = clamp(vWorld.y / max(uMaxHeight, 0.001), 0.0, 1.0);
  vec3 base = mix(uValley, uRidge, pow(h, 0.75));

  // Low western sun: enough shading to read the valley, not enough to be a render.
  float lambert = max(dot(normalize(vNormalW), normalize(uSun)), 0.0);
  base *= 0.5 + 0.75 * lambert;

  // Contours at a fixed height interval. Screen-space derivatives are not
  // reliably available to GLSL ES 1.00 shaders, so the band is widened on flat
  // ground and narrowed on steep ground instead of measured with fwidth.
  float c = vWorld.y / uContourStep;
  float steep = clamp(1.0 - normalize(vNormalW).y, 0.0, 1.0);
  float band = mix(0.11, 0.028, smoothstep(0.0, 0.22, steep));
  float f = abs(fract(c - 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.0, band, f);

  // A survey band that climbs the relief and lights the contours as it passes.
  float sweep = fract(uTime * 0.045);
  float pass = exp(-pow((h - sweep) * 11.0, 2.0));

  vec3 col = base + uContour * line * 0.3 + uScan * line * pass * 0.75 + uScan * pass * 0.03;
  gl_FragColor = vec4(col * a, a);
}
`;

// ---------------------------------------------------------------------------
// Vineyard rows
// ---------------------------------------------------------------------------

export const ROWS_VERTEX = /* glsl */ `
${HEAD}
attribute float aShade;
varying float vShade;

void main(){
  vec3 p = position;
  // Wind: each parcel leans on its own phase.
  p.x += sin(uTime * 0.5 + aShade * 21.0 + p.z * 0.15) * 0.05;
  p.z += cos(uTime * 0.42 + aShade * 17.0 + p.x * 0.13) * 0.04;

  vec4 world = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * world;
  vShade = aShade;
  computeVarying(world.xyz, mv);
  gl_Position = projectionMatrix * mv;
}
`;

export const ROWS_FRAGMENT = /* glsl */ `
precision highp float;
${FOG}
uniform vec3  uColor;
uniform vec3  uGlint;
uniform float uTime;
varying float vShade;

void main(){
  float a = atmosphere();
  if (a < 0.002) discard;

  // A slow swell crosses the parcels so the planting never sits completely still.
  float swell = sin(vWorld.x * 0.1 + vWorld.z * 0.07 - uTime * 0.45 + vShade * 6.283);
  float lift = 0.42 + 0.42 * max(swell, 0.0);

  gl_FragColor = vec4((uColor * lift + uGlint * pow(max(swell, 0.0), 6.0) * 0.5) * a, a);
}
`;

// ---------------------------------------------------------------------------
// Landcover fills: woods, scrub, farmland, vineyard bodies
// ---------------------------------------------------------------------------

export const AREA_VERTEX = /* glsl */ `
${HEAD}
attribute float aShade;
varying float vShade;

void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  vShade = aShade;
  computeVarying(world.xyz, mv);
  gl_Position = projectionMatrix * mv;
}
`;

export const AREA_FRAGMENT = /* glsl */ `
precision highp float;
${FOG}
uniform vec3  uColor;
uniform float uJitter;
varying float vShade;

void main(){
  float a = atmosphere();
  if (a < 0.002) discard;
  // Parcel-to-parcel variation keeps a big landcover block from reading as paint.
  gl_FragColor = vec4(uColor * (1.0 - uJitter * 0.5 + uJitter * vShade) * a, a);
}
`;

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

export const WATER_FRAGMENT = /* glsl */ `
precision highp float;
${FOG}
uniform vec3  uDeep;
uniform vec3  uSheen;
uniform float uTime;
varying float vShade;

void main(){
  float a = atmosphere();
  if (a < 0.002) discard;

  float ripple =
      sin(vWorld.x * 0.55 + uTime * 0.6)
    * sin(vWorld.z * 0.47 - uTime * 0.43)
    + 0.5 * sin((vWorld.x + vWorld.z) * 0.31 + uTime * 0.27);

  float glint = pow(max(ripple, 0.0), 5.0);
  gl_FragColor = vec4((uDeep * (0.7 + 0.3 * ripple) + uSheen * glint * 0.9) * a, a);
}
`;

// ---------------------------------------------------------------------------
// Draped polylines: roads and watercourses
// ---------------------------------------------------------------------------

export const LINE_VERTEX = /* glsl */ `
${HEAD}
attribute float aWeight;
attribute float aAlong;
varying float vWeight;
varying float vAlong;

void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  vWeight = aWeight;
  vAlong = aAlong;
  computeVarying(world.xyz, mv);
  gl_Position = projectionMatrix * mv;
}
`;

export const LINE_FRAGMENT = /* glsl */ `
precision highp float;
${FOG}
uniform vec3  uColor;
uniform vec3  uPulse;
uniform float uFlow;
uniform float uTime;
varying float vWeight;
varying float vAlong;

void main(){
  float a = atmosphere();
  if (a < 0.002) discard;

  // Current running downstream, or traffic running along the road.
  float travel = fract(vAlong * 0.035 - uTime * uFlow);
  float head = pow(travel, 8.0);

  vec3 col = uColor * (0.2 + 0.8 * vWeight) + uPulse * head * vWeight * 0.3;
  gl_FragColor = vec4(col * a * 0.34, a * (0.2 + 0.5 * vWeight));
}
`;

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export const WALL_VERTEX = /* glsl */ `
${HEAD}
attribute float aRatio;
attribute float aEstate;
attribute float aWallU;
varying float vRatio;
varying float vEstate;
varying float vWallU;

void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  vRatio = aRatio;
  vEstate = aEstate;
  vWallU = aWallU;
  computeVarying(world.xyz, mv);
  gl_Position = projectionMatrix * mv;
}
`;

export const WALL_FRAGMENT = /* glsl */ `
precision highp float;
${FOG}
uniform vec3  uWall;
uniform vec3  uEstateWall;
uniform vec3  uWindow;
uniform float uTime;
varying float vRatio;
varying float vEstate;
varying float vWallU;

void main(){
  float a = atmosphere();
  if (a < 0.002) discard;

  vec3 body = mix(uWall, uEstateWall, vEstate);
  // Walls darken toward the ground so buildings sit rather than float.
  vec3 col = body * (0.25 + 0.75 * vRatio);

  // Lit windows, only on the estate, on a slow independent flicker each.
  vec2 cell = vec2(vWallU * 1.7, vRatio * 2.0);
  vec2 g = fract(cell);
  float pane = step(0.30, g.x) * step(g.x, 0.62) * step(0.30, g.y) * step(g.y, 0.66);
  float seed = floor(cell.x) * 7.13 + floor(cell.y) * 3.71;
  float lamp = 0.55 + 0.45 * sin(uTime * 0.9 + seed);
  col += uWindow * pane * lamp * vEstate * step(0.02, vRatio);

  gl_FragColor = vec4(col * a, a);
}
`;

export const CROWN_VERTEX = /* glsl */ `
${HEAD}
attribute float aEstate;
varying float vEstate;

void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  vEstate = aEstate;
  computeVarying(world.xyz, mv);
  gl_Position = projectionMatrix * mv;
}
`;

export const CROWN_FRAGMENT = /* glsl */ `
precision highp float;
${FOG}
uniform vec3  uColor;
uniform vec3  uEstateColor;
uniform float uTime;
varying float vEstate;

void main(){
  float a = atmosphere();
  if (a < 0.002) discard;
  float breathe = 0.85 + 0.15 * sin(uTime * 0.7);
  vec3 col = mix(uColor, uEstateColor * breathe, vEstate);
  gl_FragColor = vec4(col * a, a * mix(0.55, 1.0, vEstate));
}
`;
