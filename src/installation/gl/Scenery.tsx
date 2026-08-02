/**
 * Everything in the scene that is not a detection: the interpolated relief of
 * the estate, the 24 hour dial, the co-occurrence web and the station beacons.
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
} from 'three';
import type { Archive } from '../data';
import { BLOOM_REACH, CHRONOS_RINGS, GROUND_SPAN, bloomSites, geoProjector, speciesNodes } from '../layouts';
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
        if ('opacity' in m) {
          (m as MeshBasicMaterial).opacity = (m.userData.baseOpacity ?? 1) * v;
        }
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
// Relief of the estate, inverse-distance interpolated from the ten station
// altitudes. It is an interpolation, not a survey — enough to read the valley
// the low stations sit in.
// ---------------------------------------------------------------------------
function Relief({ archive, active }: { archive: Archive; active: number }) {
  const group = useFade(active);

  const lines = useMemo(() => {
    const geo = geoProjector(archive);
    const pts = archive.stations.map((s) => {
      const [x, z] = geo.project(s.lat, s.lng);
      return { x, z, y: geo.elevation(s.alt) };
    });

    const RES = 44;
    const spanX = GROUND_SPAN * 0.62;
    const spanZ = GROUND_SPAN * 1.02;
    const height = (x: number, z: number) => {
      let num = 0;
      let den = 0;
      for (const p of pts) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2 + 1.5;
        const w = 1 / (d2 * d2);
        num += p.y * w;
        den += w;
      }
      return num / den;
    };

    const grid: number[][] = [];
    for (let i = 0; i <= RES; i += 1) {
      grid[i] = [];
      for (let j = 0; j <= RES; j += 1) {
        const x = -spanX / 2 + (spanX * i) / RES;
        const z = -spanZ / 2 + (spanZ * j) / RES;
        grid[i][j] = height(x, z);
      }
    }

    const verts: number[] = [];
    const push = (i: number, j: number) => {
      verts.push(-spanX / 2 + (spanX * i) / RES, grid[i][j] - 0.6, -spanZ / 2 + (spanZ * j) / RES);
    };
    for (let i = 0; i <= RES; i += 1) {
      for (let j = 0; j <= RES; j += 1) {
        if (i < RES) {
          push(i, j);
          push(i + 1, j);
        }
        if (j < RES) {
          push(i, j);
          push(i, j + 1);
        }
      }
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(Float32Array.from(verts), 3));
    return g;
  }, [archive]);

  const material = useMemo(
    () => tagOpacity(new LineBasicMaterial({ color: new Color('#1d3a4a'), blending: AdditiveBlending, depthWrite: false }), 0.5),
    []
  );

  useEffect(() => () => lines.dispose(), [lines]);

  return (
    <group ref={group}>
      <lineSegments geometry={lines} material={material} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// The 24 hour dial: two rings — acoustic inside, camera outside — plus spokes
// every three hours and a marker on the horizon.
// ---------------------------------------------------------------------------
function ChronosGuides({ active }: { active: number }) {
  const group = useFade(active);

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

  useEffect(
    () => () => {
      rings.dispose();
      spokes.dispose();
    },
    [rings, spokes]
  );

  return (
    <group ref={group}>
      <lineSegments geometry={rings} material={ringMat} />
      <lineSegments geometry={spokes} material={spokeMat} />
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

    for (const e of archive.edges) {
      const t = Math.min(1, e.w / maxW);
      const c = cool.clone().lerp(warm, t);
      verts.push(nodes[e.a * 3], nodes[e.a * 3 + 1], nodes[e.a * 3 + 2]);
      verts.push(nodes[e.b * 3], nodes[e.b * 3 + 1], nodes[e.b * 3 + 2]);
      const amp = 0.1 + t * 0.5;
      colors.push(c.r * amp, c.g * amp, c.b * amp, c.r * amp, c.g * amp, c.b * amp);
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(Float32Array.from(verts), 3));
    g.setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3));
    return g;
  }, [archive]);

  const material = useMemo(
    () => tagOpacity(new LineBasicMaterial({ vertexColors: true, blending: AdditiveBlending, depthWrite: false }), 0.85),
    []
  );

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
      return { station: s, x, y: geo.elevation(s.alt) - 0.4, z, ring, mat, phase: i * 0.7 };
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

export function Scenery({ archive, act }: { archive: Archive; act: number }) {
  return (
    <>
      <Relief archive={archive} active={act === 1 || act === 4 ? 1 : 0} />
      <StationBeacons archive={archive} active={act === 1 || act === 4 ? 1 : 0} />
      <ChronosGuides active={act === 2 ? 1 : 0} />
      <VoiceEdges archive={archive} active={act === 3 ? 1 : 0} />
      <BloomPlinths archive={archive} active={act === 5 ? 1 : 0} />
    </>
  );
}
