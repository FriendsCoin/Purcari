import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { PALETTE } from '../core/palette';

extend({ EffectComposer, RenderPass, UnrealBloomPass, ShaderPass });

/**
 * The shared render stage. Both installation versions mount this, so they share
 * one look: additive glow lifted by bloom, a warm grade toward the estate's gold,
 * grain, and a vignette. Everything the visitor sees passes through here.
 */

/**
 * Final grade. Bloom alone reads digital; this pass does the work that makes it
 * feel photographed — a slight chromatic spread at the edges, film grain that
 * hides banding in the large dark fields, and a warm/cool split-tone.
 */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.05 },
    uGrain: { value: 0.05 },
    uAberration: { value: 0.0016 },
    uWarm: { value: new THREE.Color(PALETTE.candle) },
    uCool: { value: new THREE.Color(PALETTE.dusk) },
    uLift: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uLift;
    uniform vec3 uWarm;
    uniform vec3 uCool;
    varying vec2 vUv;

    float hash(vec2 p){
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main(){
      vec2 uv = vUv;
      vec2 offset = (uv - 0.5) * uAberration;

      // Lateral chromatic aberration, strongest at the frame edge.
      vec3 color;
      color.r = texture2D(tDiffuse, uv + offset).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - offset).b;

      // Split-tone: warm the highlights, cool the shadows.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color *= mix(uCool * 0.55 + 0.72, uWarm * 0.55 + 0.72, smoothstep(0.05, 0.75, luma));

      // Vignette.
      vec2 c = uv - 0.5;
      color *= 1.0 - uVignette * dot(c, c) * 0.85;

      // Grain, animated so it does not look like a dirty screen.
      float grain = hash(uv * 900.0 + fract(uTime) * 100.0) - 0.5;
      color += grain * uGrain * (1.0 - luma * 0.6);

      color += uLift;
      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

interface EffectsProps {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  grain: number;
  vignette: number;
  /** Momentary lift through a chapter dissolve, 0..1. */
  swell: number;
}

function Effects({
  bloomStrength,
  bloomRadius,
  bloomThreshold,
  grain,
  vignette,
  swell,
}: EffectsProps) {
  const { gl, scene, camera, size } = useThree();

  const composer = useMemo(() => {
    const instance = new EffectComposer(gl);
    instance.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      bloomStrength,
      bloomRadius,
      bloomThreshold,
    );
    instance.addPass(bloom);

    const grade = new ShaderPass(GRADE_SHADER);
    grade.renderToScreen = true;
    instance.addPass(grade);
    return instance;
    // Rebuilding on every prop change would thrash GPU memory; the pass values
    // are pushed imperatively in useFrame instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setSize(size.width, size.height);
    // Cap the effective resolution on very large kiosk displays — a 4K portrait
    // panel at full DPR would halve the frame rate for no visible gain.
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  }, [composer, size]);

  useEffect(() => () => composer.dispose(), [composer]);

  useFrame((state, delta) => {
    const passes = composer.passes;
    for (const pass of passes) {
      if (pass instanceof UnrealBloomPass) {
        // Bloom and threshold both move through a dissolve: light spreads and
        // more of the frame qualifies as highlight, so the crossover reads as a
        // breath of light rather than as two scenes briefly overlapping.
        pass.strength = bloomStrength * (1 + swell * 0.85);
        pass.radius = bloomRadius * (1 + swell * 0.3);
        pass.threshold = bloomThreshold * (1 - swell * 0.5);
      } else if (pass instanceof ShaderPass && pass.uniforms.uTime) {
        pass.uniforms.uTime.value = state.clock.elapsedTime;
        // Grain thins as the frame brightens, the way film does.
        pass.uniforms.uGrain.value = grain * (1 - swell * 0.5);
        pass.uniforms.uVignette.value = vignette * (1 - swell * 0.25);
      }
    }
    composer.render(delta);
  }, 1);

  return null;
}

export interface StageProps {
  children: ReactNode;
  /** Camera position in world units. */
  cameraPosition?: [number, number, number];
  cameraFov?: number;
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  grain?: number;
  vignette?: number;
  background?: string;
  /** Fog softens the far filaments so depth reads without shading. */
  fog?: [string, number, number];
  /** 0..1 lift applied through a chapter dissolve. */
  swell?: number;
  className?: string;
}

export function Stage({
  children,
  cameraPosition = [0, 7.5, 15],
  cameraFov = 42,
  bloomStrength = 0.85,
  bloomRadius = 0.7,
  bloomThreshold = 0.14,
  grain = 0.05,
  vignette = 1.05,
  background = PALETTE.void,
  fog = [PALETTE.void, 14, 46],
  swell = 0,
  className,
}: StageProps) {
  return (
    <Canvas
      className={className}
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        // The composer applies its own tone curve, so leave the renderer linear.
        toneMapping: THREE.NoToneMapping,
      }}
      camera={{ position: cameraPosition, fov: cameraFov, near: 0.1, far: 200 }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(new THREE.Color(background), 1);
        scene.fog = new THREE.Fog(fog[0], fog[1], fog[2]);
      }}
    >
      {children}
      <Effects
        bloomStrength={bloomStrength}
        bloomRadius={bloomRadius}
        bloomThreshold={bloomThreshold}
        grain={grain}
        vignette={vignette}
        swell={swell}
      />
    </Canvas>
  );
}

/**
 * Holds one chapter while it arrives or leaves.
 *
 * A cross-fade between two scenes that both sit still at full size reads as one
 * image printed over another — the eye sees two flat layers, not a move. Giving
 * the outgoing chapter somewhere to *go* — back and down, away from the camera —
 * while the incoming one comes forward turns the same dissolve into depth.
 *
 * The two are deliberately asymmetric: what is leaving recedes about twice as
 * far as what is arriving comes forward, so the pair reads as one scene passing
 * behind another rather than as a symmetrical zoom in and out.
 *
 * At rest the transform is exactly identity, so nothing that picks against a
 * world matrix is disturbed once a chapter has settled.
 */
export function ChapterFrame({
  reveal,
  leaving = false,
  children,
}: {
  reveal: number;
  leaving?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    const r = THREE.MathUtils.clamp(reveal, 0, 1);
    const eased = r * r * (3 - 2 * r);
    const depth = leaving ? 0.11 : 0.05;
    group.scale.setScalar(1 - depth * (1 - eased));
    group.position.y = -(1 - eased) * (leaving ? 0.55 : 0.26);
    group.visible = eased > 0.002;
  });

  return <group ref={ref}>{children}</group>;
}

/**
 * A camera that eases toward successive targets instead of cutting. Chapter
 * changes and station selections both drive it, which is what gives the indoor
 * piece its unhurried, cinematic feel.
 */
export function CameraRig({
  position,
  lookAt = [0, 0, 0],
  speed = 0.55,
  /**
   * Width ÷ height of the thing that must stay in frame — the subject, not the
   * screen. A perspective camera's fov is vertical, so a portrait viewport
   * shows less horizontally; the camera only needs to pull back when the
   * subject is wider than the viewport can cover.
   *
   * Comparing against the viewport alone was wrong in the obvious case: the
   * estate is a tall NNE–SSW lozenge that portrait suits perfectly, and it was
   * being pushed to 2.4x distance for no reason. With the subject's own aspect
   * the estate (~0.5) needs no pull on a phone, while the guild rosette (~1.7)
   * still gets the room it needs.
   */
  subjectAspect = 1,
  /**
   * 0..1 through a chapter dissolve. The camera eases back along its own axis and
   * settles again — the small pull that makes two scenes read as one continuous
   * move rather than as a cut with a cross-fade painted over it. Cinema does the
   * same thing, and for the same reason: a camera that never moves through a
   * transition tells the eye there were two cameras.
   */
  dissolve = 0,
}: {
  position: [number, number, number];
  lookAt?: [number, number, number];
  speed?: number;
  subjectAspect?: number;
  dissolve?: number;
}) {
  const { size } = useThree();
  const target = useRef(new THREE.Vector3(...lookAt));
  const desired = useRef(new THREE.Vector3(...position));
  const base = useRef(new THREE.Vector3(...position));
  const scratch = useRef(new THREE.Vector3());

  useEffect(() => {
    base.current.set(...position);
    target.current.set(...lookAt);
  }, [position, lookAt]);

  useEffect(() => {
    const viewport = size.width / Math.max(1, size.height);
    const pull = Math.max(1, subjectAspect / Math.max(0.3, viewport));
    // Scale the offset from the look-at point, not the raw position, so the
    // camera pulls straight back along its own axis and the angle is preserved.
    desired.current
      .copy(base.current)
      .sub(target.current)
      .multiplyScalar(Math.min(pull, 2.2))
      .add(target.current);
  }, [size.width, size.height, subjectAspect, position, lookAt]);

  useFrame((state, delta) => {
    const k = Math.min(1, delta * speed);
    // The dolly is applied to the *goal*, not to the camera, so it composes with
    // the ease instead of fighting it: the camera is always chasing one point.
    scratch.current
      .copy(desired.current)
      .sub(target.current)
      .multiplyScalar(1 + dissolve * 0.16)
      .add(target.current);
    state.camera.position.lerp(scratch.current, k);
    state.camera.lookAt(target.current);
  });

  return null;
}
