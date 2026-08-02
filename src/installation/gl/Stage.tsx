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
}

function Effects({ bloomStrength, bloomRadius, bloomThreshold, grain, vignette }: EffectsProps) {
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
        pass.strength = bloomStrength;
        pass.radius = bloomRadius;
        pass.threshold = bloomThreshold;
      } else if (pass instanceof ShaderPass && pass.uniforms.uTime) {
        pass.uniforms.uTime.value = state.clock.elapsedTime;
        pass.uniforms.uGrain.value = grain;
        pass.uniforms.uVignette.value = vignette;
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
      />
    </Canvas>
  );
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
}: {
  position: [number, number, number];
  lookAt?: [number, number, number];
  speed?: number;
}) {
  const target = useRef(new THREE.Vector3(...lookAt));
  const desired = useRef(new THREE.Vector3(...position));

  useEffect(() => {
    desired.current.set(...position);
    target.current.set(...lookAt);
  }, [position, lookAt]);

  useFrame((state, delta) => {
    const k = Math.min(1, delta * speed);
    state.camera.position.lerp(desired.current, k);
    state.camera.lookAt(target.current);
  });

  return null;
}
