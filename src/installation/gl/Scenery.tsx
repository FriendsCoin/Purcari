/**
 * Stage dressing that is not a detection and not the basemap: the 24 hour dial,
 * the co-occurrence web, the station beacons and the diversity plinths.
 *
 * Each piece knows which acts it belongs to and fades itself in and out, so the
 * stage dresses and undresses around the particle cloud without any of it being
 * mounted or unmounted mid-transition.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  Material,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShaderMaterial,
} from 'three';
import type { Archive } from '../data';
import type { FieldControls } from './ParticleField';
import { BLOOM_REACH, CHRONOS_RINGS, bloomSites, geoProjector, speciesNodes } from '../layouts';
import { PALETTE, ZONE_COLOR } from '../theme';

/** Eases a material's opacity toward a target; returns the group ref to attach. */
function useFade(target: number, speed = 2.2) {
  const group = useRef<Group>(null);
  const current = useRef(target);
  useFrame((_, delta) => {
    if (!group.current) return;
    current.current += (target - current.current) * Math.min(1, delta * speed);
    const v = current.current;
    group.current.visible = v > 0.002;
    group.current.traverse((obj) => {
      const mat = (obj as Mesh).material as Material | Material[] | undefined;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        const base = (m.userData.baseOpacity ?? 1) * v;
        // Shader materials carry their own uOpacity; the built-ins use .opacity.
        const uniforms = (m as ShaderMaterial).uniforms;
        if (uniforms?.uOpacity) uniforms.uOpacity.value = base;
        else if ('opacity' in m) (m as MeshBasicMaterial).opacity = base;
      }
    });
  });
  return group;
}

function tagOpacity<T extends Material>(material: T, base: number): T {
  material.userData.baseOpacity = base;
  material.opacity = base;
  material.transparent = true;
  return material;
}

// ---------------------------------------------------------------------------
// The 24 hour dial: two rings — acoustic inside, camera outside — plus spokes
// every three hours and a marker on the horizon.
// ---------------------------------------------------------------------------
function ChronosGuides({
  active,
  controls,
}: {
  active: number;
  controls: React.MutableRefObject<FieldControls>;
}) {
  const group = useFade(active);
  const hand = useRef<Group>(null);

  const { rings, spokes } = useMemo(() => {
    const ringGeo = new BufferGeometry();
    const rv: number[] = [];
    for (const radius of [CHRONOS_RINGS.inner, CHRONOS_RINGS.outer]) {
      const SEG = 240;
      for (let i = 0; i < SEG; i += 1) {
        const a0 = (i / SEG) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 1) / SEG) * Math.PI * 2 - Math.PI / 2;
        rv.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius);
        rv.push(Math.cos(a1) * radius, 0, Math.sin(a1) * radius);
      }
    }
    ringGeo.setAttribute('position', new BufferAttribute(Float32Array.from(rv), 3));

    const spokeGeo = new BufferGeometry();
    const sv: number[] = [];
    for (let h = 0; h < 24; h += 3) {
      const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
      const inner = CHRONOS_RINGS.inner - 3.5;
      const outer = CHRONOS_RINGS.outer + 3.5;
      sv.push(Math.cos(a) * inner, 0, Math.sin(a) * inner);
      sv.push(Math.cos(a) * outer, 0, Math.sin(a) * outer);
    }
    spokeGeo.setAttribute('position', new BufferAttribute(Float32Array.from(sv), 3));

    return { rings: ringGeo, spokes: spokeGeo };
  }, []);

  const ringMat = useMemo(
    () => tagOpacity(new LineBasicMaterial({ color: new Color('#2b4a6b'), blending: AdditiveBlending, depthWrite: false }), 0.55),
    []
  );
  const spokeMat = useMemo(
    () => tagOpacity(new LineBasicMaterial({ color: new Color('#24384f'), blending: AdditiveBlending, depthWrite: false }), 0.4),
    []
  );

  const handGeo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(
        Float32Array.from([CHRONOS_RINGS.inner - 7, 0, 0, CHRONOS_RINGS.outer + 4, 0, 0]),
        3
      )
    );
    return g;
  }, []);

  const handMat = useMemo(
    () =>
      tagOpacity(
        new LineBasicMaterial({ color: new Color(PALETTE.gold), blending: AdditiveBlending, depthWrite: false }),
        0.7
      ),
    []
  );

  useFrame(() => {
    // Follows the same minute the particle shader is lighting.
    const minute = controls.current.sweep;
    if (hand.current) {
      hand.current.visible = minute >= 0;
      if (minute >= 0) hand.current.rotation.y = -((minute / 1440) * Math.PI * 2 - Math.PI / 2);
    }
  });

  useEffect(
    () => () => {
      rings.dispose();
      spokes.dispose();
      handGeo.dispose();
    },
    [rings, spokes, handGeo]
  );

  return (
    <group ref={group}>
      <lineSegments geometry={rings} material={ringMat} />
      <lineSegments geometry={spokes} material={spokeMat} />
      <group ref={hand}>
        <lineSegments geometry={handGeo} material={handMat} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Co-occurrence web: species recorded at the same station, strongest 260 pairs.
// ---------------------------------------------------------------------------
function VoiceEdges({ archive, active }: { archive: Archive; active: number }) {
  const group = useFade(active, 1.6);

  const geometry = useMemo(() => {
    const nodes = speciesNodes(archive);
    const verts: number[] = [];
    const colors: number[] = [];
    const warm = new Color(PALETTE.gold);
    const cool = new Color(PALETTE.cyan);
    const maxW = Math.max(...archive.edges.map((e) => e.w), 1);

    const along: number[] = [];
    const phase: number[] = [];

    archive.edges.forEach((e, i) => {
      const t = Math.min(1, e.w / maxW);
      const c = cool.clone().lerp(warm, t);
      verts.push(nodes[e.a * 3], nodes[e.a * 3 + 1], nodes[e.a * 3 + 2]);
      verts.push(nodes[e.b * 3], nodes[e.b * 3 + 1], nodes[e.b * 3 + 2]);
      const amp = 0.1 + t * 0.5;
      colors.push(c.r * amp, c.g * amp, c.b * amp, c.r * amp, c.g * amp, c.b * amp);
      along.push(0, 1);
      // Deterministic per-edge offset, so the web pulses unevenly like a network.
      const p = ((i * 2654435761) % 1000) / 1000;
      phase.push(p, p);
    });

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(Float32Array.from(verts), 3));
    g.setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3));
    g.setAttribute('aAlong', new BufferAttribute(Float32Array.from(along), 1));
    g.setAttribute('aPhase', new BufferAttribute(Float32Array.from(phase), 1));
    return g;
  }, [archive]);

  const material = useMemo(() => {
    const m = new ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aAlong;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlong;
        varying float vPhase;
        void main(){
          vColor = color;
          vAlong = aAlong;
          vPhase = aPhase;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vAlong;
        varying float vPhase;
        void main(){
          // A charge running from one species to the other it was heard beside.
          float head = fract(uTime * 0.24 + vPhase);
          float spark = exp(-pow((vAlong - head) * 7.0, 2.0));
          vec3 col = vColor * (1.0 + spark * 1.8);
          gl_FragColor = vec4(col, (0.5 + spark * 0.35) * uOpacity);
        }
      `,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.85 } },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    m.userData.baseOpacity = 0.85;
    return m;
  }, []);

  useFrame((_, delta) => {
    material.uniforms.uTime.value += delta;
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group ref={group}>
      <lineSegments geometry={geometry} material={material} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Station beacons: a ring on the ground at each real coordinate, coloured by
// biodiversity zone; silenced stations pulse.
// ---------------------------------------------------------------------------
function StationBeacons({ archive, active }: { archive: Archive; active: number }) {
  const group = useFade(active);
  const pulses = useRef<Array<{ mesh: Mesh; lost: boolean; phase: number }>>([]);

  const items = useMemo(() => {
    const geo = geoProjector(archive);
    return archive.stations.map((s, i) => {
      const [x, z] = geo.project(s.lat, s.lng);
      const ring = new RingGeometry(1.5, 1.75, 64);
      const mat = tagOpacity(
        new MeshBasicMaterial({
          color: new Color(s.status === 'active' ? ZONE_COLOR[s.zone] : PALETTE.wine),
          side: DoubleSide,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
        s.status === 'active' ? 0.75 : 0.5
      );
      return { station: s, x, y: geo.ground(s.lat, s.lng) + 0.35, z, ring, mat, phase: i * 0.7 };
    });
  }, [archive]);

  useEffect(
    () => () => {
      for (const it of items) {
        it.ring.dispose();
        it.mat.dispose();
      }
    },
    [items]
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (const p of pulses.current) {
      if (!p.mesh) continue;
      const beat = p.lost
        ? 1 + Math.sin(t * 2.4 + p.phase) * 0.14 * (0.5 + 0.5 * Math.sin(t * 0.7))
        : 1 + Math.sin(t * 0.9 + p.phase) * 0.05;
      p.mesh.scale.setScalar(beat);
    }
  });

  return (
    <group ref={group}>
      {items.map((it, i) => (
        <mesh
          key={it.station.id}
          ref={(m) => {
            if (m) pulses.current[i] = { mesh: m, lost: it.station.status !== 'active', phase: it.phase };
          }}
          geometry={it.ring}
          material={it.mat}
          position={[it.x, it.y, it.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Plinths under the four diversity blooms.
// ---------------------------------------------------------------------------
function BloomPlinths({ archive, active }: { archive: Archive; active: number }) {
  const group = useFade(active);

  const items = useMemo(() => {
    return bloomSites(archive).map((s) => {
      // Three quarters of the bloom's reach — where the grains actually end up,
      // rather than the theoretical maximum of the rose curve.
      const radius = BLOOM_REACH(s.shannon) * 0.75;
      const ring = new RingGeometry(radius * 0.985, radius, 96);
      const mat = tagOpacity(
        new MeshBasicMaterial({
          color: new Color(s.accent),
          side: DoubleSide,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
        0.5
      );
      return { site: s, ring, mat };
    });
  }, [archive]);

  useEffect(
    () => () => {
      for (const it of items) {
        it.ring.dispose();
        it.mat.dispose();
      }
    },
    [items]
  );

  return (
    <group ref={group}>
      {items.map((it) => (
        <mesh
          key={it.site.site}
          geometry={it.ring}
          material={it.mat}
          position={[it.site.center[0], -8, it.site.center[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ))}
    </group>
  );
}

export function Scenery({
  archive,
  act,
  controls,
}: {
  archive: Archive;
  act: number;
  controls: React.MutableRefObject<FieldControls>;
}) {
  return (
    <>
      <StationBeacons archive={archive} active={act === 1 || act === 4 ? 1 : 0} />
      <ChronosGuides active={act === 2 ? 1 : 0} controls={controls} />
      <VoiceEdges archive={archive} active={act === 3 ? 1 : 0} />
      <BloomPlinths archive={archive} active={act === 5 ? 1 : 0} />
    </>
  );
}
