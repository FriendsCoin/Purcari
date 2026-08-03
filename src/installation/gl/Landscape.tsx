/**
 * The real place.
 *
 * Relief from the SRTM-derived DEM, everything else from OpenStreetMap: the
 * château and the village houses, the vineyard parcels with their rows running
 * along their own long axis, the Dniester, the roads. It fades in for the two
 * acts that are actually about the ground — I and IV — and wipes in from the
 * north as the camera arrives.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  type Blending,
  BufferGeometry,
  Color,
  DoubleSide,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { Archive } from '../data';
import {
  buildAreas,
  buildBuildings,
  buildPolylines,
  buildTerrain,
  buildVineyardRows,
  riverWeight,
  roadWeight,
} from '../landscapeGeometry';
import { PALETTE } from '../theme';
import {
  AREA_FRAGMENT,
  AREA_VERTEX,
  CROWN_FRAGMENT,
  CROWN_VERTEX,
  LINE_FRAGMENT,
  LINE_VERTEX,
  ROWS_FRAGMENT,
  ROWS_VERTEX,
  TERRAIN_FRAGMENT,
  TERRAIN_VERTEX,
  WALL_FRAGMENT,
  WALL_VERTEX,
  WATER_FRAGMENT,
} from './landscapeShaders';

interface Props {
  archive: Archive;
  /** 1 while the landscape belongs on stage, 0 otherwise. */
  active: number;
}

export function Landscape({ archive, active }: Props) {
  const landscape = archive.landscape;

  const built = useMemo(() => {
    if (!landscape) return null;
    const p = archive.projection;

    const depth = p.extent.depth;
    const revealRange = new Vector2(-depth / 2, depth / 2);

    const shared = () => ({
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uReveal: { value: 1 },
      uRevealRange: { value: revealRange },
      uFog: { value: new Vector2(80, 260) },
      uExtent: { value: new Vector2(p.extent.width / 2, p.extent.depth / 2) },
    });

    const maxHeight =
      landscape.terrain
        ? (landscape.terrain.max - landscape.terrain.min) * p.scale * 5.5
        : 20;

    const material = (
      vertexShader: string,
      fragmentShader: string,
      uniforms: Record<string, { value: unknown }>,
      blending: Blending = AdditiveBlending
    ) =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { ...shared(), ...uniforms },
        transparent: true,
        depthWrite: false,
        blending,
      });

    // --- relief ---------------------------------------------------------
    const terrainGeometry = buildTerrain(p, landscape);
    const terrainMaterial = terrainGeometry
      ? new ShaderMaterial({
          vertexShader: TERRAIN_VERTEX,
          fragmentShader: TERRAIN_FRAGMENT,
          uniforms: {
            ...shared(),
            uValley: { value: new Color('#0e2029') },
            uRidge: { value: new Color('#1d3733') },
            uContour: { value: new Color('#357284') },
            uScan: { value: new Color('#7fd8e8') },
            uSun: { value: new Vector3(-0.62, 0.55, -0.32) },
            uMaxHeight: { value: maxHeight },
            uContourStep: { value: p.metresToUnits(20) * 5.5 },
          },
          transparent: true,
          // The relief is the only thing that writes depth, so the detection
          // cloud can be occluded by the hills it sits on.
          depthWrite: true,
          side: DoubleSide,
          blending: NormalBlending,
        })
      : null;

    // --- landcover ------------------------------------------------------
    const wood = buildAreas(p, landscape.wood);
    const scrub = buildAreas(p, landscape.scrub);
    const vineyardBodies = buildAreas(p, landscape.vineyards);
    const water = buildAreas(p, landscape.water, 0.2);
    const rows = buildVineyardRows(p, landscape.vineyards);
    const rivers = buildPolylines(p, landscape.rivers, riverWeight, 0.24);
    const roads = buildPolylines(p, landscape.roads, roadWeight);
    const { walls, crowns } = buildBuildings(p, landscape.buildings, landscape.chateau);

    const layers = [
      terrainGeometry && terrainMaterial
        ? { key: 'terrain', geometry: terrainGeometry, material: terrainMaterial, mode: 'mesh' as const, order: -20 }
        : null,
      wood
        ? {
            key: 'wood',
            geometry: wood,
            material: material(AREA_VERTEX, AREA_FRAGMENT, {
              uColor: { value: new Color('#16341f') },
              uJitter: { value: 0.5 },
            }),
            mode: 'mesh' as const,
            order: -18,
          }
        : null,
      scrub
        ? {
            key: 'scrub',
            geometry: scrub,
            material: material(AREA_VERTEX, AREA_FRAGMENT, {
              uColor: { value: new Color('#1d2c1c') },
              uJitter: { value: 0.6 },
            }),
            mode: 'mesh' as const,
            order: -17,
          }
        : null,
      vineyardBodies
        ? {
            key: 'vineyard-body',
            geometry: vineyardBodies,
            material: material(AREA_VERTEX, AREA_FRAGMENT, {
              uColor: { value: new Color('#241a2c') },
              uJitter: { value: 0.35 },
            }),
            mode: 'mesh' as const,
            order: -16,
          }
        : null,
      water
        ? {
            key: 'water',
            geometry: water,
            material: material(AREA_VERTEX, WATER_FRAGMENT, {
              uDeep: { value: new Color('#0d3350') },
              uSheen: { value: new Color('#9fe4ff') },
            }),
            mode: 'mesh' as const,
            order: -15,
          }
        : null,
      rows
        ? {
            key: 'rows',
            geometry: rows,
            material: material(ROWS_VERTEX, ROWS_FRAGMENT, {
              uColor: { value: new Color('#5d5330') },
              uGlint: { value: new Color('#f0d089') },
            }),
            mode: 'lines' as const,
            order: -12,
          }
        : null,
      roads
        ? {
            key: 'roads',
            geometry: roads,
            material: material(LINE_VERTEX, LINE_FRAGMENT, {
              uColor: { value: new Color('#333d4a') },
              uPulse: { value: new Color('#93a4bb') },
              uFlow: { value: 0.06 },
            }),
            mode: 'lines' as const,
            order: -11,
          }
        : null,
      rivers
        ? {
            key: 'rivers',
            geometry: rivers,
            material: material(LINE_VERTEX, LINE_FRAGMENT, {
              uColor: { value: new Color('#12455e') },
              uPulse: { value: new Color('#6fd0ee') },
              uFlow: { value: 0.11 },
            }),
            mode: 'lines' as const,
            order: -10,
          }
        : null,
      walls
        ? {
            key: 'walls',
            geometry: walls,
            material: material(
              WALL_VERTEX,
              WALL_FRAGMENT,
              {
                uWall: { value: new Color('#2b3340') },
                uEstateWall: { value: new Color('#6a4a2c') },
                uWindow: { value: new Color(PALETTE.gold) },
              },
              NormalBlending
            ),
            mode: 'mesh' as const,
            order: -8,
          }
        : null,
      crowns
        ? {
            key: 'crowns',
            geometry: crowns,
            material: material(CROWN_VERTEX, CROWN_FRAGMENT, {
              uColor: { value: new Color('#7e8ea0') },
              uEstateColor: { value: new Color(PALETTE.gold) },
            }),
            mode: 'lines' as const,
            order: -7,
          }
        : null,
    ].filter(Boolean) as Array<{
      key: string;
      geometry: BufferGeometry;
      material: ShaderMaterial;
      mode: 'mesh' | 'lines';
      order: number;
    }>;

    return layers;
  }, [archive, landscape]);

  const opacity = useRef(0);
  // The wipe runs ahead of the fade, so the ground draws itself in from the
  // north as the camera arrives instead of simply becoming visible.
  const reveal = useRef(0);

  useEffect(
    () => () => {
      for (const layer of built ?? []) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
    },
    [built]
  );

  useFrame((_, delta) => {
    if (!built) return;
    const d = Math.min(delta, 0.05);
    opacity.current += (active - opacity.current) * Math.min(1, d * 1.8);
    reveal.current = active > 0.5 ? Math.min(1.2, reveal.current + d * 0.72) : 0;

    for (const layer of built) {
      const u = layer.material.uniforms;
      u.uTime.value += d;
      u.uOpacity.value = opacity.current;
      u.uReveal.value = reveal.current;
    }
  });

  if (!built) return null;

  return (
    <group visible={active > 0 || opacity.current > 0.01}>
      {built.map((layer) =>
        layer.mode === 'mesh' ? (
          <mesh
            key={layer.key}
            geometry={layer.geometry}
            material={layer.material}
            renderOrder={layer.order}
            frustumCulled={false}
          />
        ) : (
          <lineSegments
            key={layer.key}
            geometry={layer.geometry}
            material={layer.material}
            renderOrder={layer.order}
            frustumCulled={false}
          />
        )
      )}
    </group>
  );
}
