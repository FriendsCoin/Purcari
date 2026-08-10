import type { Readout } from '../engine/Scene';

/**
 * The piece speaks French — that is its typographic voice, and the species
 * names are the survey's own French vernaculars. EN and RU are reading
 * languages layered over it: the narration (chapter texts, labels, buttons,
 * chips) translates, the names of species and places do not, and any deep
 * detail sentence without a translation falls back to French rather than to a
 * machine guess.
 *
 * Translation happens here, at the display boundary, keyed on the French
 * strings the scenes emit — the scenes themselves know nothing about language,
 * which keeps eleven chapters out of the refactor.
 */

export type Lang = 'fr' | 'en' | 'ru';

type Pair = { en: string; ru: string };

/** Exact matches: labels, chips, eyebrow segments, short UI strings. */
const EXACT: Record<string, Pair> = {
  // -- chrome ---------------------------------------------------------------
  'Touchez pour explorer': { en: 'Touch to explore', ru: 'Коснитесь, чтобы исследовать' },
  'En savoir plus': { en: 'Learn more', ru: 'Подробнее' },
  Fermer: { en: 'Close', ru: 'Закрыть' },
  'Observatoire de la biodiversité': { en: 'Biodiversity observatory', ru: 'Обсерватория биоразнообразия' },
  // -- stat labels ----------------------------------------------------------
  Détections: { en: 'Detections', ru: 'Детекции' },
  Espèces: { en: 'Species', ru: 'Виды' },
  Stations: { en: 'Stations', ru: 'Станции' },
  Postes: { en: 'Posts', ru: 'Посты' },
  Passages: { en: 'Passings', ru: 'Проходы' },
  Pièges: { en: 'Camera traps', ru: 'Фотоловушки' },
  Confiance: { en: 'Confidence', ru: 'Уверенность' },
  'Confiance médiane': { en: 'Median confidence', ru: 'Медианная уверенность' },
  'La nuit': { en: 'At night', ru: 'Ночью' },
  'Heure moyenne': { en: 'Mean hour', ru: 'Средний час' },
  Nocturnité: { en: 'Nocturnality', ru: 'Ночной образ' },
  Nocturnes: { en: 'Nocturnal', ru: 'Ночных' },
  Ressorts: { en: 'Springs', ru: 'Пружины' },
  Tension: { en: 'Tension', ru: 'Натяжение' },
  Groupes: { en: 'Groups', ru: 'Группы' },
  Partagées: { en: 'Shared', ru: 'Общие' },
  'Une seule fois': { en: 'Heard once', ru: 'Единожды' },
  Catégorie: { en: 'Category', ru: 'Категория' },
  Groupe: { en: 'Group', ru: 'Группа' },
  'À Purcari': { en: 'At Purcari', ru: 'В Пуркарь' },
  'non trouvée': { en: 'not found', ru: 'не найден' },
  Heure: { en: 'Hour', ru: 'Час' },
  'Pic du chœur': { en: 'Chorus peak', ru: 'Пик хора' },
  Domaine: { en: 'Estate', ru: 'Поместье' },
  'Espèces protégées ici': { en: 'Protected species here', ru: 'Охраняемых видов здесь' },
  'Du livre national': { en: 'Of the national book', ru: 'Из национальной книги' },
  'Postes concernés': { en: 'Posts involved', ru: 'Задействовано постов' },
  'Livre transcrit': { en: 'Book transcribed', ru: 'Транскрибировано' },
  'Trouvées ici': { en: 'Found here', ru: 'Найдено здесь' },
  'Distance au château': { en: 'Distance to the château', ru: 'До замка' },
  'Espèces au ciel': { en: 'Species in the sky', ru: 'Видов в небе' },
  Visée: { en: 'Sight', ru: 'Прицел' },
  'espèce en vue': { en: 'species in sight', ru: 'вид в прицеле' },
  'ciel libre': { en: 'open sky', ru: 'чистое небо' },
  Voix: { en: 'Voice', ru: 'Голос' },
  'Seuil BirdNET': { en: 'BirdNET threshold', ru: 'Порог BirdNET' },
  Altitude: { en: 'Altitude', ru: 'Высота' },
  // -- mode chips -----------------------------------------------------------
  Rythme: { en: 'Rhythm', ru: 'Ритм' },
  Guildes: { en: 'Guilds', ru: 'Гильдии' },
  Abondance: { en: 'Abundance', ru: 'Обилие' },
  Doigt: { en: 'Finger', ru: 'Палец' },
  Capteur: { en: 'Sensor', ru: 'Сенсор' },
  // -- eyebrow segments -----------------------------------------------------
  'Sur le domaine': { en: 'On the estate', ru: 'На поместье' },
  'en visée': { en: 'in the sight', ru: 'в прицеле' },
  'Château Purcari · Biodiversité': { en: 'Château Purcari · Biodiversity', ru: 'Château Purcari · Биоразнообразие' },
  // -- guilds & tiers (legend + eyebrows) ----------------------------------
  Passereaux: { en: 'Songbirds', ru: 'Воробьиные' },
  'Rapaces nocturnes': { en: 'Owls', ru: 'Совы' },
  'Rapaces diurnes': { en: 'Raptors', ru: 'Дневные хищники' },
  'Oiseaux d’eau': { en: 'Waterbirds', ru: 'Водные птицы' },
  Mammifères: { en: 'Mammals', ru: 'Млекопитающие' },
  Mammifère: { en: 'Mammal', ru: 'Млекопитающее' },
  Oiseau: { en: 'Bird', ru: 'Птица' },
  'Non identifié': { en: 'Unidentified', ru: 'Не определено' },
  'En danger critique': { en: 'Critically endangered', ru: 'На грани исчезновения' },
  'En danger': { en: 'Endangered', ru: 'Под угрозой' },
  Vulnérable: { en: 'Vulnerable', ru: 'Уязвимый' },
  'Quasi menacée': { en: 'Near threatened', ru: 'Близок к угрозе' },
};

/**
 * Narration: the chapter texts, matched on a distinctive opening and replaced
 * whole. The numbers inside are constants of this dataset, so baking them into
 * the translations is safe — the build that changes the data regenerates the
 * French too, and an unmatched body simply stays French.
 */
const BODIES: { starts: string; en: string; ru: string }[] = [
  {
    starts: '2 665 détections, 121 espèces',
    en: '2,665 detections, 121 species, five listening stations. 31 July to 16 August 2025.',
    ru: '2 665 детекций, 121 вид, пять станций прослушивания. С 31 июля по 16 августа 2025.',
  },
  {
    starts: 'Cinq points d’écoute',
    en: 'Five listening posts across the estate. The two richest stand by the park ponds, a step from the château — that is where the herons, the bitterns and the crakes come from.',
    ru: 'Пять точек прослушивания на поместье. Две самые богатые стоят у прудов парка, в двух шагах от замка — оттуда цапли, выпи и погоныши.',
  },
  {
    starts: 'L’étalon : chaque nœud',
    en: 'The reference: every node at the mean hour of its song, radius from abundance, and a spring toward the species that share its rhythm. The springs are calibrated on this figure — it is the shape at rest. Sort the same species any other way and they pull.',
    ru: 'Эталон: каждый узел — на среднем часе своего пения, радиус — от обилия, и пружина к видам с общим ритмом. Пружины откалиброваны по этой фигуре — это форма покоя. Разложите те же виды иначе — и они натянутся.',
  },
  {
    starts: 'Les mêmes 121 espèces en 6 îles',
    en: 'The same 121 species in 6 islands, one per group, each island the same clock in miniature. The springs have not moved: the ones that must now cross the void burn gold. That is what this sorting costs the rhythm.',
    ru: 'Те же 121 вид на 6 островах, по одному на группу, и каждый остров — те же часы в миниатюре. Пружины не сдвинулись: те, что теперь тянутся через пустоту, горят золотом. Вот чего эта сортировка стоит ритму.',
  },
  {
    starts: 'Une île par enregistreur',
    en: 'One island per recorder, in the estate’s own north-south order. 47 species were heard at a single post and stay on their island; 74 travel between several and gather in the middle. The gold here is rhythms shared from post to post.',
    ru: 'Остров на каждый рекордер, в порядке север–юг самого поместья. 47 видов слышны лишь на одном посту и остаются на своём острове; 74 кочуют и собираются в центре. Золото здесь — ритмы, общие между постами.',
  },
  {
    starts: 'Le classement pur',
    en: 'The bare ranking: the most heard at the centre, the tail toward the rim. 8 species make half the record, 32 were heard exactly once. Gold is everywhere — rank says nothing about rhythm.',
    ru: 'Чистый ранг: самый слышимый в центре, хвост к краю. 8 видов дают половину записи, 32 слышны ровно один раз. Золото повсюду — ранг ничего не говорит о ритме.',
  },
  {
    starts: 'Dix-huit espèces partagent',
    en: 'Eighteen species share the estate without meeting. The ring is ordered by the dominant axis of their rhythms: the mammals on one side, the birds on the other, and every chord between two species is how much of the day they share.',
    ru: 'Восемнадцать видов делят поместье, не встречаясь. Кольцо упорядочено по главной оси их ритмов: млекопитающие с одной стороны, птицы с другой, и каждая хорда между двумя видами — сколько суток они делят.',
  },
  {
    starts: 'Quatre-vingts nuits',
    en: 'Eighty nights, one per row, midnight at both edges and noon at the centre. Every light is an animal passing a camera trap. The violet field is the real night for this latitude, computed day by day.',
    ru: 'Восемьдесят ночей, по одной на строку, полночь по краям и полдень в центре. Каждый огонёк — животное, прошедшее мимо фотоловушки. Фиолетовое поле — настоящая ночь этой широты, посчитанная по дням.',
  },
  {
    starts: 'Le domaine, et les 12 espèces',
    en: 'The estate, and the 12 protected species the two surveys found on it. Each stands over the posts that recorded it — one thread per post — and its territory is only a shiver of light: touch it, and the animal draws itself, the line first, then its own detections climb from the posts to fill it. Far off in the dark, the rest of the Red Book: 44 species never seen here. Touch an animal.',
    ru: 'Поместье — и 12 охраняемых видов, найденных на нём двумя обследованиями. Каждый стоит над постами, которые его записали — по нити на пост, — а его территория лишь дрожь света: коснитесь, и животное нарисует себя — сперва линия, потом его собственные детекции поднимутся с постов и заполнят её. Вдали, в темноте, остальная Красная книга: 44 вида, которых здесь не видели. Коснитесь животного.',
  },
  {
    starts: 'Les 2 665 détections vous entourent',
    en: 'All 2,665 detections surround you: every species has its patch of sky, at the hour it sings, the higher the more nocturnal it is. Aim at one and it gathers, then it speaks.',
    ru: 'Все 2 665 детекций вокруг вас: у каждого вида свой участок неба, на часе его пения, тем выше, чем он ночнее. Прицельтесь — вид соберётся и заговорит.',
  },
  {
    starts: 'Voix de synthèse',
    en: 'A synthesised voice: the register follows the species’ nocturnality, the syllable count its number of detections, the phrasing its guild. No recording is played — the survey kept detections, not sound.',
    ru: 'Синтезированный голос: регистр — от ночного образа вида, число слогов — от числа детекций, фразировка — от гильдии. Записи не воспроизводятся — обследование сохранило детекции, а не звук.',
  },
];

/** Zone gates on the map: “what this opens”, in the visitor's language. */
const ZONES: Record<string, Pair> = {
  Circadien: {
    en: 'The estate’s day, hour by hour: twenty-four blades standing on this place’s real sunrise and sunset.',
    ru: 'День поместья, час за часом: двадцать четыре лопасти на настоящем здешнем восходе и закате.',
  },
  Espèces: {
    en: 'The 121 species heard, held together by their rhythms — and the same species sorted otherwise, to see what each ordering costs.',
    ru: '121 услышанный вид, связанный своими ритмами — и те же виды в других раскладках, чтобы видеть цену каждой.',
  },
  Flux: {
    en: 'The seventeen days of the acoustic survey, 31 July to 16 August, as a thinning river.',
    ru: 'Семнадцать дней акустической съёмки, с 31 июля по 16 августа, — истончающаяся река.',
  },
  Chevauchement: {
    en: 'The eighteen camera-trap species and the hours they share or avoid.',
    ru: 'Восемнадцать видов фотоловушек и часы, которые они делят или избегают.',
  },
  Passages: {
    en: 'Eighty nights in eighty rows: the 367 animals that passed a trap, to the minute.',
    ru: 'Восемьдесят ночей в восьмидесяти строках: 367 животных перед ловушками, с точностью до минуты.',
  },
  'Livre rouge': {
    en: 'The twelve protected species found here, standing on the estate, and the rest of the Red Book far off.',
    ru: 'Двенадцать охраняемых видов, найденных здесь, — стоящие на поместье, и остальная Красная книга вдали.',
  },
  'L’appel': {
    en: 'The chorus around you: aim your phone at a species and it gathers, then it speaks.',
    ru: 'Хор вокруг вас: наведите телефон на вид — он соберётся и заговорит.',
  },
};

function exact(value: string, lang: Lang): string {
  const hit = EXACT[value];
  return hit ? hit[lang as 'en' | 'ru'] : value;
}

/** Eyebrows are dot-joined segments; translate each segment that matches. */
function eyebrow(value: string, lang: Lang): string {
  return value
    .split(' · ')
    .map(part => exact(part.trim(), lang))
    .join(' · ');
}

/** Returns the readout as the visitor's language sees it. French passes through. */
export function translateReadout(readout: Readout, lang: Lang): Readout {
  if (lang === 'fr') return readout;

  const body = readout.body
    ? (BODIES.find(rule => readout.body!.startsWith(rule.starts))?.[lang] ??
      (readout.title && ZONES[readout.title] && readout.eyebrow?.startsWith('Sur le domaine')
        ? ZONES[readout.title][lang]
        : readout.body))
    : readout.body;

  return {
    ...readout,
    eyebrow: readout.eyebrow ? eyebrow(readout.eyebrow, lang) : readout.eyebrow,
    body,
    stats: readout.stats?.map(stat => ({
      label: exact(stat.label, lang),
      value: exact(stat.value, lang),
    })),
    legend: readout.legend?.map(entry => ({ ...entry, label: exact(entry.label, lang) })),
    modes: readout.modes?.map(mode => ({
      ...mode,
      label: mode.label.startsWith('Ouvrir · ')
        ? (lang === 'en' ? 'Open · ' : 'Открыть · ') + mode.label.slice('Ouvrir · '.length)
        : exact(mode.label, lang),
    })),
  };
}

/** The few DOM strings that live outside the readout. */
export function ui(key: 'hint' | 'more' | 'close' | 'sub', lang: Lang): string {
  const table: Record<string, Record<Lang, string>> = {
    hint: { fr: 'Touchez pour explorer', en: 'Touch to explore', ru: 'Коснитесь, чтобы исследовать' },
    more: { fr: 'En savoir plus', en: 'Learn more', ru: 'Подробнее' },
    close: { fr: 'Fermer', en: 'Close', ru: 'Закрыть' },
    sub: {
      fr: 'Observatoire de la biodiversité',
      en: 'Biodiversity observatory',
      ru: 'Обсерватория биоразнообразия',
    },
  };
  return table[key][lang];
}
