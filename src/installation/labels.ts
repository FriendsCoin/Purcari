/**
 * Anchors for the on-screen typography.
 *
 * Labels live in the DOM, not in the canvas: real text rendering, real font
 * metrics, selectable and readable at projector scale. Each anchor carries a
 * world position that the projector converts to screen coordinates every frame.
 */

import type { Archive } from './data';
import { CHRONOS_RINGS, GROUND_SPAN, bloomSites, geoProjector, speciesNodes } from './layouts';
import { SITE_RU } from './layouts';
import { VERTICAL_EXAGGERATION } from './projection';

export interface LabelAnchor {
  id: string;
  world: [number, number, number];
  title: string;
  meta?: string;
  tone?: 'default' | 'warn' | 'accent';
  /** Optional payload so hovering a label can focus the matching grains. */
  species?: number;
  station?: number;
}

export function labelsForAct(archive: Archive, act: number): LabelAnchor[] {
  switch (act) {
    case 1:
      return [...placeLabels(archive), ...stationLabels(archive, 'terrain')];
    case 2:
      return clockLabels();
    case 3:
      return speciesLabels(archive);
    case 4:
      return [...placeLabels(archive), ...stationLabels(archive, 'columns')];
    case 5:
      return siteLabels(archive);
    default:
      return [];
  }
}

/**
 * The place itself: the winery the estate is named after, and the two villages
 * it sits between. Without them the relief is just a shape.
 */
function placeLabels(archive: Archive): LabelAnchor[] {
  const landscape = archive.landscape;
  if (!landscape) return [];
  const geo = geoProjector(archive);

  const RU: Record<string, string> = {
    'Chateau Purcari': 'Chateau Purcari',
    Purcari: 'Пуркарь',
    Antonești: 'Антонешты',
  };

  return landscape.places
    .filter((p) => p.name && (p.kind === 'winery' || p.kind === 'village'))
    .map((p) => {
      const [x, z] = geo.project(p.lat, p.lng);
      const winery = p.kind === 'winery';
      return {
        id: `place-${p.name}`,
        world: [x, geo.ground(p.lat, p.lng) + (winery ? 6 : 3.5), z] as [number, number, number],
        title: RU[p.name] ?? p.name,
        meta: winery ? 'винодельня · 1827' : 'село',
        tone: winery ? ('accent' as const) : ('default' as const),
      };
    });
}

function stationLabels(archive: Archive, mode: 'terrain' | 'columns'): LabelAnchor[] {
  const geo = geoProjector(archive);
  const maxTotal = Math.max(...archive.stations.map((s) => s.total), 1);

  // Act I is about where the life is, so stations that never recorded anything
  // stay unlabelled there; act IV is about the network itself and names them all.
  const shown = archive.stations
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => mode === 'columns' || s.total > 0);

  return shown.map(({ s, i }) => {
    const [x, z] = geo.project(s.lat, s.lng);
    const ground = geo.ground(s.lat, s.lng);
    const top =
      mode === 'terrain'
        ? ground + 3 + 16 * (s.total / maxTotal) ** 0.55 + 2
        : ground + 5 + 17 * (s.total / maxTotal) ** 0.5 + 2.5;

    const silenced = s.status !== 'active';
    // Act I annotates lightly — the plumes are the subject. Act IV is the
    // network audit and carries the full line.
    const meta =
      mode === 'terrain'
        ? `${s.total} рег. · ${s.alt} м`
        : s.total
          ? `${s.total} рег. · ${s.richness} видов · H′ ${s.shannon.toFixed(2)} · ${s.alt} м`
          : `нет данных · ${s.alt} м`;

    return {
      id: `st-${s.id}`,
      world: [x, top, z] as [number, number, number],
      title: `${s.id} · ${s.plot}`,
      meta: silenced ? `${meta} · ${s.status === 'moved' ? 'перенесена' : 'потеряна'} ${s.lostAt ?? ''}`.trim() : meta,
      tone: silenced ? 'warn' : 'default',
      station: i,
    };
  });
}

function clockLabels(): LabelAnchor[] {
  const out: LabelAnchor[] = [];
  // Hours sit inside the acoustic ring, like the face of a clock — outside they
  // collided with the title on one side and the readout panel on the other.
  const r = CHRONOS_RINGS.inner - 5.5;
  for (let h = 0; h < 24; h += 3) {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    out.push({
      id: `h-${h}`,
      world: [Math.cos(a) * r, 0, Math.sin(a) * r],
      title: `${String(h).padStart(2, '0')}:00`,
      tone: h >= 21 || h < 5 ? 'accent' : 'default',
    });
  }
  // Ring names go where the data is thinnest — the 20:00 quadrant.
  const quiet = (20 / 24) * Math.PI * 2 - Math.PI / 2;
  out.push(
    {
      id: 'ring-audio',
      world: [Math.cos(quiet) * CHRONOS_RINGS.inner, 1.2, Math.sin(quiet) * CHRONOS_RINGS.inner],
      title: 'Акустика',
      meta: 'BirdNET · внутреннее кольцо',
    },
    {
      id: 'ring-camera',
      world: [Math.cos(quiet) * CHRONOS_RINGS.outer, 1.2, Math.sin(quiet) * CHRONOS_RINGS.outer],
      title: 'Фотоловушки',
      meta: 'внешнее кольцо',
    }
  );
  return out;
}

function speciesLabels(archive: Archive): LabelAnchor[] {
  const nodes = speciesNodes(archive);
  const chosen = new Set<number>();

  archive.species.slice(0, 8).forEach((s) => chosen.add(s.id));
  archive.species.filter((s) => s.iucn).forEach((s) => chosen.add(s.id));
  const topMammal = archive.species.find((s) => s.kind === 'mammal');
  if (topMammal) chosen.add(topMammal.id);

  return [...chosen].map((id) => {
    const s = archive.species[id];
    return {
      id: `sp-${id}`,
      world: [nodes[id * 3], nodes[id * 3 + 1] + 1.6, nodes[id * 3 + 2]] as [number, number, number],
      title: s.ru,
      meta: s.iucn ? `${s.count} · ${s.iucn.status}` : `${s.count}`,
      tone: s.iucn ? 'accent' : 'default',
      species: id,
    };
  });
}

function siteLabels(archive: Archive): LabelAnchor[] {
  return bloomSites(archive).map((s) => ({
    id: `site-${s.site}`,
    world: [s.center[0], -10, s.center[2]] as [number, number, number],
    title: SITE_RU[s.site] ?? s.site,
    meta: `H′ ${s.shannon.toFixed(2)} · 1−D ${s.simpson.toFixed(2)} · S ${s.richness}`,
    tone: s.site === 'Purcari' ? 'accent' : 'default',
  }));
}

/** Scene extent, used to keep labels from drifting off at extreme angles. */
export const SCENE_RADIUS = Math.max(GROUND_SPAN, CHRONOS_RINGS.outer * 2, VERTICAL_EXAGGERATION * 6);
