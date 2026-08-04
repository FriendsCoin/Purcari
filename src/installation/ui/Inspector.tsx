/**
 * The inspector: what one grain of light actually was.
 *
 * Every particle in the piece is a real row in the archive, and until you can
 * click one and read it back, that claim is just a caption. This card is the
 * proof — species, station, date, minute, which instrument heard or saw it.
 */

import type { Archive, DetectionDetail } from '../data';

interface Props {
  archive: Archive;
  detail: DetectionDetail | null;
  onClose: () => void;
  onIsolate: (speciesId: number) => void;
  isolated: boolean;
}

export function Inspector({ archive, detail, onClose, onIsolate, isolated }: Props) {
  if (!detail) return null;

  const { species, station } = detail;
  const share = ((species.count / archive.meta.counts.detections) * 100).toFixed(1);

  return (
    <aside className="inspector" role="dialog" aria-label="Регистрация">
      <div className="inspector__head">
        <span className="inspector__kicker">
          {detail.source === 'acoustic' ? 'Акустика · BirdNET' : 'Фотоловушка'}
          {detail.night ? ' · ночь' : ''}
        </span>
        <button type="button" className="inspector__close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>

      <h2 className="inspector__title">{species.ru}</h2>
      {species.sci && <p className="inspector__sci">{species.sci}</p>}

      <dl className="inspector__facts">
        <div>
          <dt>Когда</dt>
          <dd>
            {detail.date}, {detail.time}
          </dd>
        </div>
        <div>
          <dt>Где</dt>
          <dd>{station ? `${station.id} · ${station.plot} · ${station.alt} м` : 'станция не указана'}</dd>
        </div>
        <div>
          <dt>Вид в архиве</dt>
          <dd>
            {species.count} рег. · {share} % · место {species.rank + 1}
          </dd>
        </div>
        {station && station.status !== 'active' && (
          <div>
            <dt>Станция</dt>
            <dd className="inspector__warn">
              {station.status === 'moved' ? 'перенесена' : 'потеряна'} {station.lostAt}
            </dd>
          </div>
        )}
        {species.iucn && (
          <div>
            <dt>Статус</dt>
            <dd className="inspector__accent">
              {species.iucn.status} — {species.iucn.note}
            </dd>
          </div>
        )}
      </dl>

      <button type="button" className="inspector__action" onClick={() => onIsolate(species.id)}>
        {isolated ? 'Показать всех' : `Показать только этот вид`}
      </button>
    </aside>
  );
}
