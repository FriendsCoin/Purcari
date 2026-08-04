/**
 * Sunrise and sunset for the estate, from the NOAA solar position equations.
 *
 * Chapter VI plots eighty nights as eighty rows. Drawing the night as a fixed
 * band would be off by an hour and a half across the survey: the dark shortens
 * to 8 h 10 at the solstice and is back out to 9 h 50 by 16 August. The whole
 * point of the chapter is that the animals move inside the real dark, so the
 * band it draws has to be the real one.
 *
 * The approximation is good to about a minute at this latitude, which is far
 * inside the width of a drawn line. Times are returned as minutes after local
 * midnight, on the same clock the export is written in: Moldova keeps UTC+3 from
 * late March to late October, so the whole survey sits in one offset and it is
 * applied as a constant.
 */

/** Moldova, EEST. Constant across the survey window. */
const UTC_OFFSET_MINUTES = 180;

/** Refraction plus the sun's own radius — the standard sunrise/sunset altitude. */
const ZENITH = 90.833 * (Math.PI / 180);

export interface SolarDay {
  /** Minutes after local midnight. */
  sunrise: number;
  sunset: number;
  /** Hours of darkness, for the readout. */
  nightHours: number;
}

/**
 * Day of the year, 1-based, from a `YYYY-MM-DD` date.
 *
 * Parsed and read back in UTC so the number never slips a day on a panel
 * configured for another timezone.
 */
function dayOfYear(date: string): number {
  const d = new Date(`${date}T12:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1, 12);
  return Math.round((d.getTime() - start) / 86400000) + 1;
}

export function solarDay(date: string, latitude: number, longitude: number): SolarDay {
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear(date) - 1);

  // Equation of time, in minutes: the difference between clock noon and the
  // sun's own noon, which swings by a quarter of an hour across the year.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const lat = latitude * (Math.PI / 180);
  const cosHourAngle =
    Math.cos(ZENITH) / (Math.cos(lat) * Math.cos(declination)) - Math.tan(lat) * Math.tan(declination);

  // Polar day and polar night, which cannot happen at 46° N but the clamp keeps
  // the maths defined if this is ever pointed somewhere else.
  const hourAngle = Math.acos(Math.min(1, Math.max(-1, cosHourAngle))) * (180 / Math.PI);

  const noonUtc = 720 - 4 * longitude - eqTime;
  const sunrise = noonUtc - 4 * hourAngle + UTC_OFFSET_MINUTES;
  const sunset = noonUtc + 4 * hourAngle + UTC_OFFSET_MINUTES;

  return {
    sunrise,
    sunset,
    nightHours: (1440 - (sunset - sunrise)) / 60,
  };
}

/** Formats minutes after midnight as `HH:MM`, wrapping at the day boundary. */
export function formatClock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}
