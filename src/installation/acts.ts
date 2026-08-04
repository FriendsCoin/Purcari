/**
 * The score: six states the installation moves through.
 *
 * Each act declares where the camera stands, how restless the cloud is, and the
 * single reading it is making from the data. Captions quote the archive rather
 * than describing it.
 */

import type { Archive } from './data';
import type { Layout, LayoutContext } from './layouts';
import {
  layoutBloom,
  layoutChronos,
  layoutDormant,
  layoutSeason,
  layoutStations,
  layoutTail,
  layoutTerrain,
  layoutVoices,
} from './layouts';

export interface ActDefinition {
  id: number;
  key: string;
  numeral: string;
  title: string;
  subtitle: string;
  caption: (a: Archive) => string;
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
  orbit: number;
  drift: number;
  build: (ctx: LayoutContext) => Layout;
  /** Which readout panel the overlay shows alongside this act. */
  panel: 'summary' | 'stations' | 'clock' | 'season' | 'species' | 'tail' | 'network' | 'diversity';
}

const nf = new Intl.NumberFormat('ru-RU');

export const ACTS: ActDefinition[] = [
  {
    id: 0,
    key: 'prologue',
    numeral: '00',
    title: 'Живой архив',
    subtitle: 'Purcari · биомониторинг 2025',
    caption: (a) =>
      `${nf.format(a.meta.counts.detections)} регистраций · ${a.meta.counts.species} видов · ` +
      `${a.meta.counts.stations} станций · ${a.meta.window.days} дней`,
    camera: { position: [0, 5, 78], target: [0, 0, 0], fov: 42 },
    orbit: 0.018,
    drift: 0.85,
    build: layoutDormant,
    panel: 'summary',
  },
  {
    id: 1,
    key: 'land',
    numeral: 'I',
    title: 'Земля',
    subtitle: 'Где слушали',
    caption: (a) => {
      const km = ((a.bounds.lat1 - a.bounds.lat0) * 111.32).toFixed(1).replace('.', ',');
      const drop = a.bounds.alt1 - a.bounds.alt0;
      return (
        `${a.meta.counts.stations} станций на ${km} км склона, перепад ${drop} м. ` +
        `Высота султана света — число регистраций; координаты и рельеф настоящие.`
      );
    },
    camera: { position: [34, 88, 88], target: [-8, 8, 8], fov: 36 },
    orbit: 0.03,
    drift: 0.4,
    build: layoutTerrain,
    panel: 'stations',
  },
  {
    id: 2,
    key: 'stations',
    numeral: 'II',
    title: 'Станции',
    subtitle: 'Сеть и её потери',
    caption: (a) =>
      `${a.meta.counts.stationsActive} станции работают, ${a.meta.counts.stationsLost} замолчали — ` +
      `оборудование потеряно летом 2025 года.`,
    camera: { position: [38, 92, 90], target: [-8, 18, 8], fov: 36 },
    orbit: 0.034,
    drift: 0.28,
    build: layoutStations,
    panel: 'network',
  },
  {
    id: 3,
    key: 'chronos',
    numeral: 'III',
    title: 'Хронос',
    subtitle: 'Одни сутки на всех',
    caption: (a) => {
      const audioPeak = a.hourly.audio.indexOf(Math.max(...a.hourly.audio));
      const camPeak = a.hourly.camera.indexOf(Math.max(...a.hourly.camera));
      return (
        `Внутреннее кольцо — акустика, внешнее — фотоловушки. ` +
        `Птицы звучат в ${String(audioPeak).padStart(2, '0')}:00, звери идут в ${String(camPeak).padStart(2, '0')}:00. ` +
        `Двадцать четыре пучка — это ритм самой записи: микрофон слушает ` +
        `${a.meta.dutyCycle.acousticMinutesPerHour} минут в начале каждого часа.`
      );
    },
    camera: { position: [0, 68, 56], target: [0, 3, 0], fov: 38 },
    orbit: 0.02,
    drift: 0.22,
    build: layoutChronos,
    panel: 'clock',
  },
  {
    id: 4,
    key: 'season',
    numeral: 'IV',
    title: 'Сезон',
    subtitle: 'Восемьдесят дней',
    caption: (a) => {
      const acoustic = a.daily.filter((d) => d.audio > 0).length;
      const camera = a.daily.filter((d) => d.camera > 0).length;
      return (
        `Тот же циферблат, вытянутый через сезон: час по кругу, день вверх. ` +
        `Фотоловушки писали ${camera} дней, микрофоны — ${acoustic}. ` +
        `Плотный воротник наверху не всплеск жизни, а включённый микрофон.`
      );
    },
    camera: { position: [0, 48, 92], target: [0, 0, 0], fov: 38 },
    orbit: 0.05,
    drift: 0.26,
    build: layoutSeason,
    panel: 'season',
  },
  {
    id: 5,
    key: 'voices',
    numeral: 'V',
    title: 'Голоса',
    subtitle: 'Кто здесь живёт',
    caption: (a) => {
      const once = a.species.filter((s) => s.count === 1).length;
      return `${a.meta.counts.species} вида. В центре — массовые, по краю — ${once} видов, записанных единственный раз.`;
    },
    camera: { position: [2, 26, 56], target: [0, 0, 0], fov: 42 },
    orbit: 0.038,
    drift: 0.3,
    build: layoutVoices,
    panel: 'species',
  },
  {
    id: 6,
    key: 'tail',
    numeral: 'VI',
    title: 'Хвост',
    subtitle: 'Немногие и многие',
    caption: (a) => {
      const counts = a.species.map((s) => s.count).sort((x, y) => x - y);
      const median = counts[Math.floor(counts.length / 2)];
      const rare = counts.filter((c) => c <= median).length;
      const top = a.species.slice(0, 10).reduce((sum, s) => sum + s.count, 0);
      const all = counts.reduce((x, y) => x + y, 0);
      return (
        `Каждый столб — вид, сложенный из своих же регистраций. ` +
        `${rare} вида из ${a.meta.counts.species} записаны не чаще ${median} раз, ` +
        `а первая десятка — ${Math.round((top / all) * 100)} % всего архива. Хвост и есть разнообразие.`
      );
    },
    camera: { position: [38, 21, 57], target: [0, 2, -20], fov: 40 },
    // A rank curve is a chart: the orbit accumulates session time, so any
    // non-zero value would eventually swing it round and read as nonsense.
    orbit: 0,
    drift: 0.22,
    build: layoutTail,
    panel: 'tail',
  },
  {
    id: 7,
    key: 'index',
    numeral: 'VII',
    title: 'Индекс',
    subtitle: 'Чем измеряется живое',
    caption: (a) => {
      const rows = a.diversity.filter((d) => d.filter === 'all species');
      const best = rows.reduce((x, y) => (y.shannon > x.shannon ? y : x));
      const worst = rows.reduce((x, y) => (y.shannon < x.shannon ? y : x));
      return `Индекс Шеннона: ${best.site} ${best.shannon.toFixed(2)} против ${worst.shannon.toFixed(2)} в зоне «${worst.site}».`;
    },
    camera: { position: [14, 10, 84], target: [14, -2, 0], fov: 40 },
    orbit: 0.05,
    drift: 0.5,
    build: layoutBloom,
    panel: 'diversity',
  },
];

export const LAST_ACT = ACTS.length - 1;
