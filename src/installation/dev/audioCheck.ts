import { loadInstallationData } from '../core/data';
import { SoundField, soundField, voiceFor } from '../core/audio';
import { GUILD_COLORS } from '../core/palette';
import type { Species } from '../core/types';

/**
 * Development harness for the synthesised voices.
 *
 * The voices are procedural, so the failure modes are silent output, clipping,
 * and every species sounding the same. All three are measurable: render each
 * phrase to an offline buffer and report peak, RMS, duration and spectral
 * centroid. This is how the voices were verified without listening to 213 of
 * them, and how they should be re-checked after any change to the synthesis.
 */

interface Row {
  species: Species;
  peak: number;
  rms: number;
  duration: number;
  centroid: number;
}

/** Spectral centroid in Hz via a coarse DFT over a decimated window. */
function centroidOf(data: Float32Array, sampleRate: number): number {
  const N = 2048;
  // Take the loudest window so silence at the head does not skew the estimate.
  let best = 0;
  let bestEnergy = 0;
  for (let start = 0; start + N < data.length; start += N) {
    let energy = 0;
    for (let i = 0; i < N; i++) energy += data[start + i] * data[start + i];
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = start;
    }
  }
  if (bestEnergy === 0) return 0;

  let weighted = 0;
  let total = 0;
  // Only the first 160 bins matter here (up to ~3.4 kHz at 44.1 k / 2048).
  for (let k = 1; k < 400; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / N;
    for (let n = 0; n < N; n += 2) {
      const sample = data[best + n] * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
      re += sample * Math.cos(w * n);
      im -= sample * Math.sin(w * n);
    }
    const mag = Math.hypot(re, im);
    const freq = (k * sampleRate) / N;
    weighted += mag * freq;
    total += mag;
  }
  return total > 0 ? weighted / total : 0;
}

function analyse(buffer: AudioBuffer): Omit<Row, 'species'> {
  const data = buffer.getChannelData(0);
  let peak = 0;
  let sumSq = 0;
  let lastSound = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
    sumSq += data[i] * data[i];
    if (a > 0.002) lastSound = i;
  }
  return {
    peak,
    rms: Math.sqrt(sumSq / data.length),
    duration: lastSound / buffer.sampleRate,
    centroid: centroidOf(data, buffer.sampleRate),
  };
}

async function main() {
  const summary = document.getElementById('summary') as HTMLDivElement;
  const table = document.getElementById('table') as HTMLTableElement;
  const data = await loadInstallationData();

  // Every guild's loudest member, plus every flagship — the set that actually
  // reaches a visitor's ear.
  const byGuild = new Map<string, Species>();
  for (const s of data.species) if (!byGuild.has(s.guild)) byGuild.set(s.guild, s);
  const sample = [
    ...byGuild.values(),
    ...data.species.filter((s) => s.flagship).slice(0, 12),
  ].filter((s, i, arr) => arr.findIndex((x) => x.sci === s.sci) === i);

  const rows: Row[] = [];
  for (const species of sample) {
    const buffer = await SoundField.render(species, 3.5);
    rows.push({ species, ...analyse(buffer) });
  }

  const silent = rows.filter((r) => r.peak < 0.01);
  const clipped = rows.filter((r) => r.peak > 0.98);
  const centroids = rows.map((r) => r.centroid).filter((c) => c > 0);
  const spread = Math.max(...centroids) - Math.min(...centroids);

  summary.innerHTML = `
    <strong>${rows.length}</strong> voices rendered ·
    silent: <span class="${silent.length ? 'bad' : 'ok'}">${silent.length}</span> ·
    clipped: <span class="${clipped.length ? 'bad' : 'ok'}">${clipped.length}</span> ·
    centroid spread: <span class="${spread > 400 ? 'ok' : 'bad'}">${spread.toFixed(0)} Hz</span>
    (want &gt; 400 Hz, i.e. the voices are audibly different from one another)
  `;

  table.innerHTML =
    '<tr><th>Species</th><th>Guild</th><th>Timbre</th><th>Peak</th><th>RMS</th>' +
    '<th>Length</th><th>Centroid</th></tr>' +
    rows
      .map((r) => {
        const v = voiceFor(r.species);
        const colour = GUILD_COLORS[r.species.guild] ?? '#e8c86a';
        return `<tr data-sci="${r.species.sci}" style="cursor:pointer">
          <td style="color:${colour}">${r.species.name}</td>
          <td>${r.species.guild}</td>
          <td>${v.timbre}</td>
          <td class="${r.peak < 0.01 ? 'bad' : ''}">${r.peak.toFixed(3)}</td>
          <td>${r.rms.toFixed(4)}</td>
          <td>${r.duration.toFixed(2)}s</td>
          <td>${r.centroid.toFixed(0)} Hz</td>
        </tr>`;
      })
      .join('');

  // Click any row to hear that voice on a live context.
  table.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest('tr');
    const sci = row?.getAttribute('data-sci');
    if (!sci) return;
    const species = data.species.find((s) => s.sci === sci);
    if (!species) return;
    void soundField.start().then(() => soundField.play(species, { gain: 1.2 }));
  });

  // Expose the measurements so a headless run can assert on them.
  (window as unknown as { __audioCheck: unknown }).__audioCheck = {
    count: rows.length,
    silent: silent.map((r) => r.species.sci),
    clipped: clipped.map((r) => r.species.sci),
    spread,
    rows: rows.map((r) => ({
      sci: r.species.sci,
      guild: r.species.guild,
      peak: +r.peak.toFixed(4),
      rms: +r.rms.toFixed(5),
      duration: +r.duration.toFixed(3),
      centroid: Math.round(r.centroid),
    })),
  };
}

void main();
