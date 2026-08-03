import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { ACES, HASH, SIMPLEX3 } from './glsl';

/** Bloom mip levels. Five gives a wide, soft halo without a second blur pass. */
const BLOOM_LEVELS = 5;

/**
 * The look of the piece lives in this file. The scenes render raw, unclamped
 * light into a half-float buffer; everything that makes it feel like projected
 * film rather than a web page — the bloom bleed, the lens dispersion, the grain,
 * the falloff to the corners — happens here in one composite pass.
 *
 * Written by hand rather than assembled from EffectComposer passes: the chain is
 * fixed, so a single composite shader avoids four full-screen round trips on a
 * kiosk GPU that has to hold 60 fps all day.
 */
export class PostFX {
  private readonly renderer: WebGLRenderer;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;

  readonly sceneTarget: WebGLRenderTarget;
  readonly prevTarget: WebGLRenderTarget;

  private readonly bloomTargets: WebGLRenderTarget[] = [];
  private readonly brightMaterial: ShaderMaterial;
  private readonly downMaterial: ShaderMaterial;
  private readonly upMaterial: ShaderMaterial;
  private readonly compositeMaterial: ShaderMaterial;

  private width = 1;
  private height = 1;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;

    const geometry = new BufferGeometry();
    // Fullscreen triangle: one primitive, no diagonal seam, no wasted fragments.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new Mesh(geometry);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const targetOptions = {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: true,
      stencilBuffer: false,
    };

    this.sceneTarget = new WebGLRenderTarget(1, 1, targetOptions);
    this.prevTarget = new WebGLRenderTarget(1, 1, targetOptions);
    for (let i = 0; i < BLOOM_LEVELS; i += 1) {
      this.bloomTargets.push(new WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false }));
    }

    this.brightMaterial = this.makeMaterial(BRIGHT_FRAGMENT, {
      tDiffuse: { value: null },
      uThreshold: { value: 0.62 },
      uKnee: { value: 0.45 },
    });

    this.downMaterial = this.makeMaterial(DOWNSAMPLE_FRAGMENT, {
      tDiffuse: { value: null },
      uTexel: { value: new Vector2() },
    });

    this.upMaterial = this.makeMaterial(UPSAMPLE_FRAGMENT, {
      tDiffuse: { value: null },
      uTexel: { value: new Vector2() },
      uRadius: { value: 1.0 },
    });
    this.upMaterial.blending = NoBlending;

    this.compositeMaterial = this.makeMaterial(COMPOSITE_FRAGMENT, {
      tScene: { value: null },
      tPrev: { value: null },
      tBloom: { value: null },
      uResolution: { value: new Vector2() },
      uTime: { value: 0 },
      uExposure: { value: 1.0 },
      uBloom: { value: 0.85 },
      uGrain: { value: 0.022 },
      uAberration: { value: 1.0 },
      uVignette: { value: 1.0 },
      uDissolve: { value: 0 },
      uFade: { value: 1 },
    });
  }

  private makeMaterial(fragmentShader: string, uniforms: ShaderMaterial['uniforms']): ShaderMaterial {
    return new ShaderMaterial({
      uniforms,
      vertexShader: QUAD_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width * pixelRatio));
    this.height = Math.max(1, Math.floor(height * pixelRatio));
    this.sceneTarget.setSize(this.width, this.height);
    this.prevTarget.setSize(this.width, this.height);
    this.compositeMaterial.uniforms.uResolution.value.set(this.width, this.height);

    let w = this.width;
    let h = this.height;
    for (const target of this.bloomTargets) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      target.setSize(w, h);
    }
  }

  /** Renders a scene into the buffer that the composite reads as "current". */
  renderScene(scene: Scene, camera: Camera, into: WebGLRenderTarget = this.sceneTarget): void {
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(into);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(previousTarget);
  }

  private blit(material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  private buildBloom(): void {
    this.brightMaterial.uniforms.tDiffuse.value = this.sceneTarget.texture;
    this.blit(this.brightMaterial, this.bloomTargets[0]);

    for (let i = 1; i < this.bloomTargets.length; i += 1) {
      const source = this.bloomTargets[i - 1];
      this.downMaterial.uniforms.tDiffuse.value = source.texture;
      this.downMaterial.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
      this.blit(this.downMaterial, this.bloomTargets[i]);
    }

    // Tent-filtered upsample, accumulating coarse levels back into finer ones so
    // the halo has energy at every scale instead of a single blur radius.
    this.upMaterial.blending = AdditiveBlending;
    for (let i = this.bloomTargets.length - 1; i > 0; i -= 1) {
      const source = this.bloomTargets[i];
      this.upMaterial.uniforms.tDiffuse.value = source.texture;
      this.upMaterial.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
      this.upMaterial.needsUpdate = true;
      this.blit(this.upMaterial, this.bloomTargets[i - 1]);
    }
    this.upMaterial.blending = NoBlending;
  }

  /**
   * @param dissolve 0 = show the current scene, 1 = show the previous one. The
   *   transition is a noise-thresholded wipe, not a linear fade, so chapters feel
   *   like they burn into each other.
   * @param fade global master fade, used for the boot-in and for going dark.
   */
  composite(time: number, dissolve: number, fade: number): void {
    this.buildBloom();

    const uniforms = this.compositeMaterial.uniforms;
    uniforms.tScene.value = this.sceneTarget.texture;
    uniforms.tPrev.value = this.prevTarget.texture;
    uniforms.tBloom.value = this.bloomTargets[0].texture;
    uniforms.uTime.value = time;
    uniforms.uDissolve.value = dissolve;
    uniforms.uFade.value = fade;

    this.blit(this.compositeMaterial, null);
    this.renderer.setRenderTarget(null);
  }

  setLook(options: { exposure?: number; bloom?: number; grain?: number; aberration?: number; vignette?: number }): void {
    const u = this.compositeMaterial.uniforms;
    if (options.exposure !== undefined) u.uExposure.value = options.exposure;
    if (options.bloom !== undefined) u.uBloom.value = options.bloom;
    if (options.grain !== undefined) u.uGrain.value = options.grain;
    if (options.aberration !== undefined) u.uAberration.value = options.aberration;
    if (options.vignette !== undefined) u.uVignette.value = options.vignette;
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.prevTarget.dispose();
    for (const target of this.bloomTargets) target.dispose();
    this.brightMaterial.dispose();
    this.downMaterial.dispose();
    this.upMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.geometry.dispose();
  }
}

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee: partial credit just under the threshold avoids a hard bloom edge
  // crawling across slow-moving particles.
  float soft = clamp(luma - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contribution = max(soft, luma - uThreshold) / max(luma, 1e-5);
  gl_FragColor = vec4(c * contribution, 1.0);
}
`;

const DOWNSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
varying vec2 vUv;

void main(){
  vec4 sum = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0));
  sum += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0, -1.0));
  sum += texture2D(tDiffuse, vUv + uTexel * vec2(-1.0,  1.0));
  sum += texture2D(tDiffuse, vUv + uTexel * vec2( 1.0,  1.0));
  gl_FragColor = sum * 0.25;
}
`;

const UPSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;

void main(){
  vec2 o = uTexel * uRadius;
  vec4 sum = texture2D(tDiffuse, vUv + vec2(-o.x, 0.0)) * 2.0;
  sum += texture2D(tDiffuse, vUv + vec2( o.x, 0.0)) * 2.0;
  sum += texture2D(tDiffuse, vUv + vec2(0.0, -o.y)) * 2.0;
  sum += texture2D(tDiffuse, vUv + vec2(0.0,  o.y)) * 2.0;
  sum += texture2D(tDiffuse, vUv + vec2(-o.x, -o.y));
  sum += texture2D(tDiffuse, vUv + vec2( o.x, -o.y));
  sum += texture2D(tDiffuse, vUv + vec2(-o.x,  o.y));
  sum += texture2D(tDiffuse, vUv + vec2( o.x,  o.y));
  sum += texture2D(tDiffuse, vUv) * 4.0;
  gl_FragColor = sum / 16.0;
}
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uGrain;
uniform float uAberration;
uniform float uVignette;
uniform float uDissolve;
uniform float uFade;
varying vec2 vUv;

${HASH}
${SIMPLEX3}
${ACES}

/** sRGB opto-electronic transfer function, applied as the last step before write. */
vec3 linearToSRGB(vec3 c){
  vec3 cutoff = step(c, vec3(0.0031308));
  vec3 low = c * 12.92;
  vec3 high = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, cutoff);
}

/**
 * Radial chromatic aberration. Channels are sampled along the vector from the
 * centre, so the dispersion grows toward the frame edge the way a real lens does.
 */
vec3 sampleDispersed(sampler2D tex, vec2 uv, float amount){
  vec2 centred = uv - 0.5;
  float r2 = dot(centred, centred);
  vec2 offset = centred * r2 * amount;
  return vec3(
    texture2D(tex, uv - offset * 1.0).r,
    texture2D(tex, uv).g,
    texture2D(tex, uv + offset * 1.0).b
  );
}

void main(){
  vec2 uv = vUv;

  // Barrel warp, a fraction of a pixel at the centre and a few at the corners.
  vec2 centred = uv - 0.5;
  uv = 0.5 + centred * (1.0 + dot(centred, centred) * 0.012);

  float aberration = 0.0075 * uAberration;
  float exposure = uExposure;

  /**
   * Chapter change.
   *
   * Three things happen at once, because a crossfade alone reads as a slideshow.
   * The two images move against each other — the outgoing one recedes while the
   * incoming one settles forward out of a slight push-in — so the cut has a
   * direction. A noise field crossing a rising threshold breaks the outgoing
   * image up in organic patches rather than dipping it uniformly. And a band of
   * light travels across the frame along that front, with the lens dispersion
   * and exposure lifting as it passes, so the change reads as something igniting
   * rather than as two layers being blended.
   */
  vec3 current;
  if (uDissolve > 0.001){
    float t = uDissolve;
    // Push: incoming eases in from 4% oversize, outgoing keeps drifting out.
    vec2 inUv  = 0.5 + (uv - 0.5) * (1.0 + t * 0.045);
    vec2 outUv = 0.5 + (uv - 0.5) * (1.0 - (1.0 - t) * 0.055);

    float lift = 1.0 + sin(t * 3.14159) * 0.55;
    current = sampleDispersed(tScene, inUv, aberration * lift);
    vec3 previous = sampleDispersed(tPrev, outUv, aberration * lift);

    // The front runs on a diagonal, warped by noise so it is never a straight wipe.
    float sweep = dot(uv - 0.5, normalize(vec2(0.82, 0.57))) * 0.5 + 0.5;
    float n = snoise(vec3(uv * 3.2, uTime * 0.2)) * 0.20;
    float field = clamp(sweep + n, 0.0, 1.0);
    float front = smoothstep(t - 0.22, t + 0.22, field);

    current = mix(current, previous, front);

    // A hot filament riding the boundary, brightest mid-transition.
    float band = exp(-pow((field - t) * 7.0, 2.0)) * sin(t * 3.14159);
    current += band * vec3(0.62, 0.42, 0.20) * 0.55;
    exposure *= 1.0 + band * 0.25;
  } else {
    current = sampleDispersed(tScene, uv, aberration);
  }

  vec3 bloom = texture2D(tBloom, uv).rgb;
  vec3 lit = current + bloom * uBloom;

  lit *= exposure;
  vec3 mapped = aces(lit);

  float vignette = smoothstep(1.28, 0.32, length(centred) * 1.72);
  mapped *= mix(1.0, vignette, uVignette);
  mapped *= uFade;

  // Everything above this line is linear light. ShaderMaterial does not get
  // three's automatic output conversion, so the sRGB transfer function is
  // applied by hand — without it the piece renders about a stop dark and the
  // shadows, which are most of the frame, crush to black.
  mapped = linearToSRGB(mapped);

  // The grade runs in display space from here down. Doing it after the transfer
  // function is what makes these numbers mean what they look like: a 0.02 lift
  // is 2% of the visible range, not the 25% it would be in linear light.
  float luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));

  // Cellar tint: violet in the shadows, candle warmth in the highlights.
  mapped += vec3(0.010, 0.006, 0.020) * (1.0 - luma) * uFade;
  mapped *= mix(vec3(1.0), vec3(1.03, 1.0, 0.97), luma);

  // Grain, weighted toward the shadows where film actually shows it.
  float grain = hash12(gl_FragCoord.xy + fract(uTime) * 941.7) - 0.5;
  mapped += grain * uGrain * (1.0 - luma * 0.7);

  // Dither before the 8-bit write, so the long dark gradients that fill most of
  // this piece do not band on a large panel.
  float dither = (hash12(gl_FragCoord.xy * 1.7) - 0.5) / 255.0;
  gl_FragColor = vec4(mapped + dither, 1.0);
}
`;
