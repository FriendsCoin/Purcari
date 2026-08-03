/**
 * Post chain: bloom for the glow the additive grains imply, then a film pass
 * that adds vignette, edge chromatic aberration and animated grain.
 *
 * The grain matters more than it looks like it should — without it the black
 * background bands badly on projectors and large panels, which is exactly where
 * an installation ends up.
 */

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    uGrain: { value: 0.042 },
    uVignette: { value: 0.82 },
    uAberration: { value: 0.0016 },
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
    uniform vec2 uResolution;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;

    // Sine-free hash: the classic sin() version loses precision at full-screen
    // coordinates and lays a diagonal moiré over the black.
    float hash(vec2 p){
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main(){
      vec2 centred = vUv - 0.5;
      float r = length(centred);

      vec2 shift = centred * uAberration * (0.35 + r * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + shift).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - shift).b;

      col *= 1.0 - smoothstep(0.32, 0.92, r) * uVignette;

      float g = hash(gl_FragCoord.xy + vec2(fract(uTime * 11.0) * 431.0, fract(uTime * 7.0) * 977.0)) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

interface PostProps {
  bloom?: number;
  /** Camera-flight progress; drives the mid-move exposure and glow lift. */
  transition?: React.MutableRefObject<{ bell: number }>;
}

export function PostFX({ bloom = 0.55, transition }: PostProps) {
  const { gl, scene, camera, size } = useThree();

  const { composer, film, bloomPass } = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));

    // High threshold: only the hot grain cores glow, so the frame keeps its
    // blacks instead of fogging over.
    const bloomPass = new UnrealBloomPass(new Vector2(size.width, size.height), bloom, 0.5, 0.34);
    c.addPass(bloomPass);
    c.addPass(new OutputPass());

    const filmPass = new ShaderPass(FilmShader);
    c.addPass(filmPass);

    return { composer: c, film: filmPass, bloomPass };
  }, [gl, scene, camera, bloom, size.width, size.height]);

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
    film.uniforms.uResolution.value.set(size.width * dpr, size.height * dpr);
  }, [composer, film, size]);

  useEffect(() => () => composer.dispose(), [composer]);

  useFrame((_, delta) => {
    film.uniforms.uTime.value += delta;

    // Mid-flight the frame opens up a little: more glow, a touch more exposure
    // and a heavier lens. It reads as motion even on a still subject.
    const bell = transition?.current.bell ?? 0;
    bloomPass.strength = bloom + bell * 0.42;
    gl.toneMappingExposure = 1.15 + bell * 0.16;
    film.uniforms.uAberration.value = 0.0016 + bell * 0.0034;

    composer.render(delta);
  }, 1);

  return null;
}
