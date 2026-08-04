/**
 * The readout panel — the dashboard half of the piece.
 *
 * Each act exposes a different reading of the same archive. Rows are live
 * controls: hovering a species or a station focuses those grains in the cloud,
 * so the numbers and the image are never describing different things.
 */

import type { Archive } from '../data';
import type { ActDefinition } from '../acts';
import { SITE_RU, bloomSites } from '../layouts';

const nf = new Intl.NumberFormat('ru-RU');

interface Props {
  archive: Archive;
  act: ActDefinition;
  onFocusSpecies: (id: number) => void;
  onFocusStation: (id: number) => void;
  window: [number, number];
}

function Bar({ value, tone = '' }: { value: number; tone?: string }) {
  return (
    <div className="bar">
      <div
        className={`bar__fill${tone ? ` bar__fill--${tone}` : ''}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

function HourBand({ series, tone, height }: { series: number[]; tone: 'audio' | 'camera'; height: number }) {
  const max = Math.max(...series, 1);
  return (
    <div className="clockchart" style={{ height }}>
      {series.map((v, h) => (
        <div className="clockchart__col" key={h} title={`${String(h).padStart(2, '0')}:00 — ${v}`}>
          <div className={`clockchart__seg clockchart__seg--${tone}`} style={{ height: `${(v / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

export function Panel({ archive, act, onFocusSpecies, onFocusStation, window: win }: Props) {
  const m = archive.meta;

  switch (act.panel) {
    case 'summary': {
      const audioShare = m.counts.acoustic / m.counts.detections;
      return (
        <Shell title="Архив" note={`${m.window.firstDay} — ${m.window.lastDay}`}>
          <Row name="Всего регистраций" value={nf.format(m.counts.detections)} accent />
          <Row name="Акустика · BirdNET" value={nf.format(m.counts.acoustic)} />
          <Bar value={audioShare} />
          <Row name="Фотоловушки" value={nf.format(m.counts.camera)} />
          <Bar value={1 - audioShare} tone="wine" />
          <Row name="Видов всего" value={String(m.counts.species)} accent />
          <Row name="— птицы" value={String(m.counts.birds)} />
          <Row name="— млекопитающие" value={String(m.counts.mammals)} />
          <Row name="Станций" value={`${m.counts.stationsActive} / ${m.counts.stations}`} />
          <Row name="Период наблюдений" value={`${m.window.days} дн.`} />
          <Row name="Индекс Шеннона H′" value={m.shannonOverall.toFixed(2)} accent />
          <Row name="Индекс Симпсона 1−D" value={m.simpsonOverall.toFixed(2)} />
          <Legend />
        </Shell>
      );
    }

    case 'stations':
    case 'network': {
      const sorted = [...archive.stations].sort((a, b) => b.total - a.total);
      const max = Math.max(...sorted.map((s) => s.total), 1);
      const lost = sorted.filter((s) => s.status !== 'active');
      return (
        <Shell
          title={act.panel === 'network' ? 'Сеть' : 'Станции'}
          note={`${m.counts.stationsActive} активны · ${m.counts.stationsLost} нет`}
        >
          {sorted.map((s) => (
            <button
              type="button"
              key={s.id}
              className="row row--interactive"
              onMouseEnter={() => onFocusStation(archive.stationIndex.get(s.id) ?? -1)}
              onMouseLeave={() => onFocusStation(-1)}
              onFocus={() => onFocusStation(archive.stationIndex.get(s.id) ?? -1)}
              onBlur={() => onFocusStation(-1)}
            >
              <span className="row__label">
                <span className="row__name">
                  {s.id} · {s.plot}
                </span>
                <span className="row__meta">
                  {s.alt} м · {s.zone === 'core' ? 'ядро' : s.zone === 'edge' ? 'опушка' : 'матрица'}
                  {s.status !== 'active' ? ` · ${s.status === 'moved' ? 'перенесена' : 'потеряна'} ${s.lostAt}` : ''}
                </span>
              </span>
              <span className={`row__value${s.status !== 'active' ? ' row__value--warn' : ''}`}>
                {s.total ? nf.format(s.total) : '—'}
              </span>
              <Bar value={s.total / max} tone={s.status !== 'active' ? 'wine' : ''} />
            </button>
          ))}
          {act.panel === 'network' && lost.length > 0 && (
            <p className="row__meta" style={{ marginTop: 14, whiteSpace: 'normal', lineHeight: 1.7 }}>
              Пять точек сети замолчали в июне и августе 2025 года: оборудование потеряно или перенесено.
              Пропуск в данных — тоже данные.
            </p>
          )}
        </Shell>
      );
    }

    case 'clock': {
      const audioPeak = archive.hourly.audio.indexOf(Math.max(...archive.hourly.audio));
      const camPeak = archive.hourly.camera.indexOf(Math.max(...archive.hourly.camera));
      const dawn = archive.hourly.audio.slice(4, 7).reduce((a, b) => a + b, 0);
      const nightCam =
        archive.hourly.camera.slice(21).reduce((a, b) => a + b, 0) +
        archive.hourly.camera.slice(0, 5).reduce((a, b) => a + b, 0);
      const camTotal = archive.hourly.camera.reduce((a, b) => a + b, 0);
      return (
        <Shell title="Сутки" note="нормировано по сети">
          <div style={{ marginBottom: 4 }}>
            <div className="row__meta" style={{ marginBottom: 6 }}>Акустика</div>
            <HourBand series={archive.hourly.audio} tone="audio" height={64} />
            <div className="row__meta" style={{ margin: '12px 0 6px' }}>Фотоловушки</div>
            <HourBand series={archive.hourly.camera} tone="camera" height={44} />
            <div className="clockchart__axis">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h}>{String(h).padStart(2, '0')}</span>
              ))}
            </div>
          </div>
          <Row name="Пик голосов" value={`${String(audioPeak).padStart(2, '0')}:00`} accent />
          <Row name="Пик зверей" value={`${String(camPeak).padStart(2, '0')}:00`} />
          <Row name="Рассвет 04–07" value={`${Math.round((dawn / m.counts.acoustic) * 100)} %`} />
          <Row name="Звери ночью 21–05" value={`${Math.round((nightCam / camTotal) * 100)} %`} />
          <Row name="Окно просмотра" value={`${fmt(win[0])} — ${fmt(win[1])}`} />
          <p className="row__meta" style={{ marginTop: 12, whiteSpace: 'normal', lineHeight: 1.7 }}>
            Усилие наблюдения неодинаково: микрофон пишет{' '}
            {archive.meta.dutyCycle.acousticMinutesPerHour} минут в начале каждого часа, фотоловушки
            работают непрерывно. Сравнивать сети по абсолютным числам нельзя — только по форме суток.
          </p>
          <Legend />
        </Shell>
      );
    }

    case 'season': {
      const acousticDays = archive.daily.filter((d) => d.audio > 0).length;
      const cameraDays = archive.daily.filter((d) => d.camera > 0).length;
      const peak = archive.daily.reduce((a, b) => (a.audio + a.camera > b.audio + b.camera ? a : b));
      const max = Math.max(...archive.daily.map((d) => d.audio + d.camera), 1);
      return (
        <Shell title="Сезон" note={`${m.window.days} дней`}>
          <div className="daybars" role="img" aria-label="Регистрации по дням">
            {archive.daily.map((d) => (
              <span
                key={d.date}
                className="daybars__col"
                title={`${d.date} — акустика ${d.audio}, камеры ${d.camera}`}
              >
                <i
                  className="daybars__seg daybars__seg--audio"
                  style={{ height: `${(d.audio / max) * 100}%` }}
                />
                <i
                  className="daybars__seg daybars__seg--camera"
                  style={{ height: `${(d.camera / max) * 100}%` }}
                />
              </span>
            ))}
          </div>
          <Row name="Дней с камерами" value={String(cameraDays)} />
          <Row name="Дней с акустикой" value={String(acousticDays)} accent />
          <Row name="Самый плотный день" value={peak.date.slice(5)} />
          <Row name="— в нём регистраций" value={nf.format(peak.audio + peak.camera)} />
          <p className="row__meta" style={{ marginTop: 12, whiteSpace: 'normal', lineHeight: 1.7 }}>
            Две сети покрывают сезон совершенно по-разному: фотоловушки стояли всё лето,
            микрофоны включили в конце июля. Поэтому августовский «взрыв» — это про технику,
            а не про животных.
          </p>
          <Legend />
        </Shell>
      );
    }

    case 'tail': {
      const counts = archive.species.map((s) => s.count).sort((a, b) => a - b);
      const median = counts[Math.floor(counts.length / 2)];
      const once = counts.filter((c) => c === 1).length;
      const all = counts.reduce((a, b) => a + b, 0);
      const top10 = archive.species.slice(0, 10).reduce((sum, s) => sum + s.count, 0);
      const notable = archive.species.filter((s) => s.iucn && s.count <= median);
      return (
        <Shell title="Редкость" note={`${m.counts.species} видов`}>
          <Row name="Медиана регистраций" value={String(median)} accent />
          <Row name="Записаны один раз" value={`${once} вида`} />
          <Row name="Не чаще медианы" value={`${counts.filter((c) => c <= median).length} вида`} />
          <Row name="Доля первой десятки" value={`${Math.round((top10 / all) * 100)} %`} />
          <Bar value={top10 / all} />
          <p className="row__meta" style={{ marginTop: 12, whiteSpace: 'normal', lineHeight: 1.7 }}>
            Так устроено любое живое сообщество: несколько массовых видов и длинный хвост
            редких. Индексы Шеннона и Симпсона в следующем акте измеряют именно длину
            и ровность этого хвоста.
          </p>
          {notable.length > 0 && (
            <>
              <div className="panel__head" style={{ marginTop: 18 }}>
                <span className="panel__title">Редкие и охраняемые</span>
              </div>
              {notable.slice(0, 5).map((s) => (
                <button
                  type="button"
                  key={`tail-${s.id}`}
                  className="row row--interactive"
                  onMouseEnter={() => onFocusSpecies(s.id)}
                  onMouseLeave={() => onFocusSpecies(-1)}
                  onFocus={() => onFocusSpecies(s.id)}
                  onBlur={() => onFocusSpecies(-1)}
                >
                  <span className="row__label">
                    <span className="row__name">{s.ru}</span>
                    <span className="row__meta">{s.iucn?.note}</span>
                  </span>
                  <span className="row__value row__value--accent">{s.count}</span>
                </button>
              ))}
            </>
          )}
        </Shell>
      );
    }

    case 'species': {
      const top = archive.species.slice(0, 12);
      const max = top[0]?.count ?? 1;
      const notable = archive.species.filter((s) => s.iucn).slice(0, 5);
      return (
        <Shell title="Виды" note={`${m.counts.species} всего`}>
          {top.map((s) => (
            <button
              type="button"
              key={s.id}
              className="row row--interactive"
              onMouseEnter={() => onFocusSpecies(s.id)}
              onMouseLeave={() => onFocusSpecies(-1)}
              onFocus={() => onFocusSpecies(s.id)}
              onBlur={() => onFocusSpecies(-1)}
            >
              <span className="row__label">
                <span className="row__name">{s.ru}</span>
                <span className="row__meta">{s.sci || s.name}</span>
              </span>
              <span className="row__value">{nf.format(s.count)}</span>
              <Bar value={s.count / max} tone={s.kind === 'mammal' ? 'wine' : ''} />
            </button>
          ))}
          {notable.length > 0 && (
            <>
              <div className="panel__head" style={{ marginTop: 18 }}>
                <span className="panel__title">Охранный статус</span>
              </div>
              {notable.map((s) => (
                <button
                  type="button"
                  key={`iucn-${s.id}`}
                  className="row row--interactive"
                  onMouseEnter={() => onFocusSpecies(s.id)}
                  onMouseLeave={() => onFocusSpecies(-1)}
                  onFocus={() => onFocusSpecies(s.id)}
                  onBlur={() => onFocusSpecies(-1)}
                >
                  <span className="row__label">
                    <span className="row__name">{s.ru}</span>
                    <span className="row__meta">{s.iucn?.note}</span>
                  </span>
                  <span className="row__value row__value--accent">{s.iucn?.status}</span>
                </button>
              ))}
            </>
          )}
        </Shell>
      );
    }

    case 'diversity': {
      const sites = bloomSites(archive);
      const maxH = Math.max(...sites.map((s) => s.shannon), 1);
      const maxS = Math.max(...sites.map((s) => s.richness), 1);
      return (
        <Shell title="Индексы" note="по типам землепользования">
          {sites.map((s) => (
            <div key={s.site} className="row" style={{ display: 'grid' }}>
              <span className="row__label">
                <span className="row__name">{SITE_RU[s.site] ?? s.site}</span>
                <span className="row__meta">
                  1−D {s.simpson.toFixed(2)} · S {s.richness}
                </span>
              </span>
              <span className={`row__value${s.site === 'Purcari' ? ' row__value--accent' : ''}`}>
                {s.shannon.toFixed(2)}
              </span>
              <Bar value={s.shannon / maxH} tone={s.site === 'Purcari' ? '' : 'dim'} />
              <Bar value={s.richness / maxS} tone="cyan" />
            </div>
          ))}
          <p className="row__meta" style={{ marginTop: 14, whiteSpace: 'normal', lineHeight: 1.7 }}>
            H′ — индекс Шеннона, S — число видов. Виноградник держит самое высокое разнообразие,
            пригородная зона — самое низкое, при сопоставимом числе видов.
          </p>
          <Legend />
        </Shell>
      );
    }

    default:
      return null;
  }
}

function Shell({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <aside className="panel">
      <div className="panel__head">
        <span className="panel__title">{title}</span>
        {note && <span className="panel__note">{note}</span>}
      </div>
      {children}
    </aside>
  );
}

function Row({ name, value, accent }: { name: string; value: string; accent?: boolean }) {
  return (
    <div className="row">
      <span className="row__label">
        <span className="row__name">{name}</span>
      </span>
      <span className={`row__value${accent ? ' row__value--accent' : ''}`}>{value}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="panel__legend">
      <span className="legend-key" style={{ color: 'var(--gold)' }}>
        <i /> рассвет
      </span>
      <span className="legend-key" style={{ color: 'var(--cyan)' }}>
        <i /> ночь
      </span>
      <span className="legend-key" style={{ color: 'var(--wine)' }}>
        <i /> звери
      </span>
    </div>
  );
}

function fmt(minute: number): string {
  const m = Math.round(minute);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
