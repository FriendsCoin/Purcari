import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { InstallationData, Species } from '../core/types';
import { logScale } from '../core/data';
import { GUILD_COLORS, PALETTE, toRGB } from '../core/palette';
import { SIMPLEX_3D, SPRITE } from './chunks';
import { glyphFor, sampleOutline } from './silhouettes';

/**
 * "The Choir" — every species recorded at Purcari, at once.
 *
 * Each species is one mark. Guild sets the hue and the orbital shell; abundance
 * sets the radius (log-scaled, so a 6,133-call pheasant and a 3-sighting otter
 * can share a frame); nocturnality sets the vertical band, so the night animals
 * literally sink below the day ones. The swarm drifts on a curl-like noise field
 * and pulls apart into guild clusters when the visitor asks it to.
 *
 * Touching a mark selects that species; the surrounding marks dim and the
 * selected one's own hourly rhythm drives its pulse.
 */

/**
 * Where a mark ends up, given its two arrangements.
 *
 * This is shared verbatim by the marks, the guild filaments and nothing else,
 * because the filaments have to *touch* their animal: if the two shaders drifted
 * apart by so much as one noise octave the lines would visibly miss the marks
 * they are drawn to. One function, two shaders, no possibility of disagreement.
 */
const CHOIR_PLACE = /* glsl */ `
vec3 choirPlace(vec3 swarm, vec3 clustered, float seed, float night, float drift, out float awake){
  vec3 p = mix(swarm, clustered, uCluster);

  // Organic drift. Sampling noise at three offsets approximates a curl field
  // cheaply enough to run on every mark every frame.
  //
  // Damped as the guilds gather: a free swarm wants to breathe, but a full
  // 1.2-unit wander inside clusters barely 2 units apart smears the rosette back
  // into the cloud it was sorted out of — the arrangement stops arranging.
  float t = uTime * 0.06 + seed * 30.0;
  vec3 n = vec3(
    snoise(vec3(p.yz * 0.22, t)),
    snoise(vec3(p.zx * 0.22, t + 11.0)),
    snoise(vec3(p.xy * 0.22, t + 23.0))
  );
  p += n * drift * mix(1.0, 0.30, uCluster) * (0.5 + seed * 0.9);

  // Night species sit low and rise only when the clock says they are active.
  float dayness = 1.0 - night;
  float hourPhase = uHour / 24.0;
  float isNightNow = smoothstep(0.30, 0.05, hourPhase) + smoothstep(0.78, 0.95, hourPhase);
  awake = mix(1.0 - isNightNow, isNightNow, night);
  p.y += (dayness - 0.5) * 1.6 + awake * 0.5;
  return p;
}
`;

const CHOIR_VERT = /* glsl */ `
${SIMPLEX_3D}
attribute vec3 aColor;
attribute float aScale;
attribute float aSeed;
attribute float aNight;
attribute float aGuild;
attribute vec3 aCluster;
attribute float aSelected;
attribute float aDimmed;
attribute float aWave;    // 0..1 distance from the selected mark, filled on selection

uniform float uTime;
uniform float uReveal;
uniform float uCluster;   // 0 = single swarm, 1 = split into guild clusters
uniform float uHour;      // 0..24, drives which marks are awake
uniform float uDrift;
uniform float uPulse;     // 0..1 shockwave age since the last selection, >1 = spent

varying vec3 vColor;
varying float vSelected;
varying float vDimmed;
varying float vAwake;
varying float vRing;

${CHOIR_PLACE}

void main(){
  vColor = aColor;
  vSelected = aSelected;
  vDimmed = aDimmed;

  float awake;
  vec3 p = choirPlace(position, aCluster, aSeed, aNight, uDrift, awake);
  vAwake = awake;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  float breathe = 1.0 + sin(uTime * 1.1 + aSeed * 6.2831) * 0.10;
  float pick = 1.0 + aSelected * 1.5;

  // A shockwave leaving the touched mark: aWave is each mark's normalised
  // distance from it, so the flare genuinely travels outward through the swarm
  // rather than twinkling at random.
  float wave = uPulse > 1.0 ? 0.0 : exp(-pow((aWave - uPulse) * 6.0, 2.0));
  vRing = wave;

  // Sleeping species stay clearly present rather than nearly vanishing — the
  // chapter is a census of the whole year, not only of this hour.
  float size = aScale * breathe * pick * (1.0 + wave * 0.55) * uReveal * (0.72 + awake * 0.28);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const CHOIR_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vSelected;
varying float vDimmed;
varying float vAwake;
varying float vRing;

void main(){
  vec2 coord = gl_PointCoord - 0.5;
  float d = length(coord) * 2.0;
  if (d > 1.0) discard;

  float core = 1.0 - smoothstep(0.0, 0.34, d);
  float halo = pow(1.0 - d, 2.4);

  vec3 color = vColor;
  color += vec3(1.0, 0.93, 0.78) * core * (0.4 + vSelected * 0.9);

  float a = (core * 0.95 + halo * 0.55);
  a *= mix(1.0, 0.3, vDimmed);
  a *= (0.55 + vAwake * 0.45);

  // The passing shockwave lifts a mark toward the candle white and back.
  color += vec3(1.0, 0.90, 0.72) * vRing * 0.8;
  a += vRing * 0.45 * (core + halo * 0.5);

  // Selected marks get a tight ring so a fingertip has unambiguous feedback.
  if (vSelected > 0.5) {
    float ring = 1.0 - smoothstep(0.0, 0.06, abs(d - 0.72));
    a += ring * 0.8;
    color += vec3(1.0, 0.94, 0.8) * ring;
  }

  gl_FragColor = vec4(color * a, a);
}
`;

/**
 * The guild filaments — one hairline from each animal to the centre of its
 * guild, drawn only once the rosette has formed.
 *
 * In the swarm the guilds are an invisible property of 213 scattered marks; in
 * the rosette they are the whole structure, and the filaments are what make a
 * cluster read as a *thing that belongs together* rather than as marks that
 * happen to be near each other. Touch an animal and a bead of light runs out
 * along its own filament, from the guild it belongs to, to it.
 */
const FILAMENT_VERT = /* glsl */ `
${SIMPLEX_3D}
attribute vec3 aSwarm;
attribute vec3 aClusterEnd;
attribute vec3 aColor;
attribute float aSeed;
attribute float aNight;
attribute float aDrift;     // 0 at the guild's centre — only the animal end wanders
attribute float aEnd;       // 0 = the animal, 1 = its guild's centre
attribute float aSelected;
attribute float aDimmed;

uniform float uTime;
uniform float uReveal;
uniform float uCluster;
uniform float uHour;
uniform float uDrift;
uniform float uPulse;

varying vec3 vColor;
varying float vAlpha;
varying float vSelected;
varying float vT;

${CHOIR_PLACE}

void main(){
  float awake;
  vec3 p = choirPlace(aSwarm, aClusterEnd, aSeed, aNight, uDrift * aDrift, awake);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

  vColor = aColor;
  vSelected = aSelected;
  // 0 at the guild's centre, 1 at the animal — the direction the bead travels.
  vT = 1.0 - aEnd;

  // The web only exists once the rosette has actually formed; drawing it during
  // the morph would fill the frame with lines going nowhere in particular.
  float formed = smoothstep(0.35, 1.0, uCluster);
  vAlpha = formed * uReveal * (0.34 + aSelected * 0.9) * mix(1.0, 0.25, aDimmed)
         * (0.55 + awake * 0.45);
}
`;

const FILAMENT_FRAG = /* glsl */ `
uniform float uPulse;

varying vec3 vColor;
varying float vAlpha;
varying float vSelected;
varying float vT;

void main(){
  // Both ends taper out, so a filament is a stroke of light rather than a wire
  // welded to two points.
  float taper = smoothstep(0.0, 0.22, vT) * (1.0 - smoothstep(0.82, 1.0, vT));
  float a = vAlpha * taper;

  // The bead: only on the touched animal's own filament, and only while the
  // pulse is in flight.
  float bead = uPulse > 1.0 ? 0.0 : exp(-pow((vT - uPulse) * 7.0, 2.0)) * vSelected;
  vec3 color = vColor + vec3(1.0, 0.92, 0.76) * bead;
  a += bead * 0.55;

  if (a <= 0.002) discard;
  gl_FragColor = vec4(color * a, a);
}
`;

/**
 * A lit circle around each guild's cluster, its radius set by how many species
 * that guild holds. Eighty-eight songbirds get a wide ring; the three amphibians
 * get a small one. The rings are the rosette's legend, drawn in the same light
 * as everything else instead of as an overlay.
 */
const HALO_VERT = /* glsl */ `
attribute vec3 aCentre;
attribute vec2 aRadial;   // unit direction × the guild's radius, in the screen plane
attribute vec3 aColor;
attribute float aAngle;
attribute float aGuild;

uniform float uTime;
uniform float uReveal;
uniform float uCluster;
uniform float uGuildSel;   // index of the selected animal's guild, or -1

varying vec3 vColor;
varying float vAlpha;

void main(){
  float sel = 1.0 - step(0.5, abs(aGuild - uGuildSel));

  // A slow breath, out of phase per guild so the ring of rings never pulses as
  // one organism.
  float breathe = 1.0 + sin(uTime * 0.42 + aGuild * 1.7) * 0.035 + sel * 0.05;
  vec3 p = aCentre + vec3(aRadial * breathe, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

  // A travelling dash, so each ring reads as turning.
  float dash = 0.5 + 0.5 * sin(aAngle * 19.0 - uTime * 0.55 + aGuild);
  float formed = smoothstep(0.45, 1.0, uCluster);
  vColor = aColor;
  vAlpha = formed * uReveal * (0.16 + 0.22 * dash) * (1.0 + sel * 2.0);
}
`;

const HALO_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main(){
  if (vAlpha <= 0.002) discard;
  gl_FragColor = vec4(vColor * vAlpha, vAlpha);
}
`;

/**
 * The ghost the swarm gathers when an animal is chosen.
 *
 * Marks fly out of the cloud and settle onto the contour of a pictogram — a bird
 * or a quadruped, chosen by the species' own guild — hold there, and scatter
 * again when the selection clears. It is the one figurative moment in a piece
 * made entirely of abstract marks, and it earns its place by being what a
 * visitor actually asks of a species list: *what is it?*
 *
 * Deliberately a pictogram and not a portrait. See `silhouettes.ts`.
 */
const GLYPH_POINTS = 620;

const GLYPH_VERT = /* glsl */ `
${SIMPLEX_3D}
attribute vec2 aBird;
attribute vec2 aMammal;
attribute vec3 aScatter;
attribute float aSeed;

uniform float uTime;
uniform float uForm;    // 0 = dispersed in the cloud, 1 = settled on the contour
uniform float uGlyph;   // 0 = bird, 1 = quadruped
uniform float uScale;
uniform float uSize;

varying float vAlpha;

void main(){
  vec2 shape = mix(aBird, aMammal, uGlyph) * uScale;

  // The contour breathes and drifts a little even when fully formed. A silhouette
  // pinned to exact coordinates reads as clip art; one that is still made of
  // living marks reads as the swarm holding a shape, which is what it is.
  float t = uTime * 0.25 + aSeed * 30.0;
  vec2 breath = vec2(snoise(vec3(shape * 0.6, t)), snoise(vec3(shape.yx * 0.6, t + 11.0)));
  vec3 target = vec3(shape + breath * 0.16, 0.0);

  // Each mark arrives on its own beat, so the form assembles rather than snaps.
  float lag = 1.0 - aSeed * 0.45;
  float form = clamp(uForm * 1.45 * lag, 0.0, 1.0);
  form = form * form * (3.0 - 2.0 * form);

  vec3 p = mix(aScatter, target, form);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.45 + form * 0.55) * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;

  vAlpha = form;
}
`;

const GLYPH_FRAG = /* glsl */ `
${SPRITE}
uniform vec3 uColor;

varying float vAlpha;

void main(){
  float mask = spriteAlpha(gl_PointCoord, 0.5);
  // Kept low: this sits behind two hundred marks and a caption, and a bright
  // pictogram would out-shout the animal it is labelling.
  float a = mask * vAlpha * 0.72;
  if (a <= 0.003) discard;
  gl_FragColor = vec4((uColor + vec3(0.35, 0.31, 0.24) * vAlpha) * a, a);
}
`;

export interface ChoirProps {
  data: InstallationData;
  reveal?: number;
  /** 0 = one swarm, 1 = separated into ecological guilds. */
  cluster?: number;
  /** Clock hour driving which species are lit. */
  hour?: number;
  selected?: Species | null;
  onSelect?: (species: Species | null) => void;
  /**
   * Show only the species the survey singles out — the ones carrying a
   * conservation status or narrative weight. The rest stay faintly present
   * rather than disappearing, so the rare are seen *against* the common:
   * the turtle dove is Vulnerable in a crowd of two hundred that are not.
   */
  flagshipOnly?: boolean;
}

export function Choir({
  data,
  reveal = 1,
  cluster = 0,
  hour = 12,
  selected = null,
  onSelect,
  flagshipOnly = false,
}: ChoirProps) {
  const pointsRef = useRef<THREE.Points>(null);
  /** Marks, filaments and rings all hang off this so they can never drift apart. */
  const swarmRef = useRef<THREE.Group>(null);
  const revealRef = useRef(0);
  const spinRef = useRef(0);
  const clusterRef = useRef(0);
  const hourRef = useRef(hour);
  const { camera, size } = useThree();

  /**
   * Ring order for the guild rosette.
   *
   * `data.guilds` arrives sorted by abundance, which would seat the 88-species
   * songbird cluster next to the other big groups and leave the far side nearly
   * empty. Dealing the size-sorted guilds alternately to opposite sides of the
   * ring keeps the figure balanced without touching any species' membership.
   */
  const guilds = useMemo(() => {
    const bySize = Object.keys(data.guilds).sort(
      (a, b) => data.guilds[b].species - data.guilds[a].species,
    );
    const n = bySize.length;
    const half = Math.floor(n / 2);
    const ring: string[] = new Array(n);
    bySize.forEach((guild, i) => {
      // Even ranks fill the near half, odd ranks the far half, so the two
      // largest guilds land diametrically opposite each other.
      const slot = i % 2 === 0 ? i / 2 : half + (i - 1) / 2;
      ring[slot % n] = guild;
    });
    return ring;
  }, [data.guilds]);

  /**
   * Positions are deterministic per species — the same animal always occupies
   * the same place in the choir, so a returning visitor can find it again.
   */
  const { geometry, filamentGeometry, haloGeometry, species } = useMemo(() => {
    const list = data.species;
    const n = list.length;
    const maxTotal = Math.max(...list.map((s) => s.total));

    const positions = new Float32Array(n * 3);
    const clusters = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const scales = new Float32Array(n);
    const seeds = new Float32Array(n);
    const nights = new Float32Array(n);
    const guildIndex = new Float32Array(n);
    const selectedAttr = new Float32Array(n);
    const dimmed = new Float32Array(n);
    const waves = new Float32Array(n);

    // Deterministic pseudo-random from the species name.
    const rand = (text: string, salt: number) => {
      let h = 2166136261 ^ salt;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return ((h >>> 0) % 100000) / 100000;
    };

    const guildCounts = new Map<string, number>();

    /**
     * How wide each guild's cluster is allowed to be, by how many species it
     * holds. Eighty-eight songbirds packed into the same disc as three
     * amphibians is not a denser reading, it is a white blob: additive marks
     * stacked that hard clip long before the bloom pass sees them. Spreading the
     * big guilds also puts the count into the *size* of the cluster, which is the
     * thing the eye compares first.
     */
    const sizeByGuild = new Map<string, number>();
    for (const sp of list) sizeByGuild.set(sp.guild, (sizeByGuild.get(sp.guild) ?? 0) + 1);
    const largestGuild = Math.max(...sizeByGuild.values(), 1);
    const spreadOf = (guild: string) =>
      0.5 + 0.7 * Math.sqrt((sizeByGuild.get(guild) ?? 1) / largestGuild);

    list.forEach((sp, i) => {
      const abundance = logScale(sp.total, maxTotal);

      // Unified swarm: a sphere shell whose radius shrinks with abundance, so
      // the commonest animals sit at the luminous centre.
      const radius = 2.2 + (1 - abundance) * 6.2;
      const theta = rand(sp.sci, 1) * Math.PI * 2;
      const phi = Math.acos(2 * rand(sp.sci, 2) - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.55;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      // Guild arrangement: a rosette of one cluster per guild.
      //
      // Laid out in the screen-facing XY plane rather than the ground plane —
      // an XZ ring seen from the chapter's low camera projects almost edge-on
      // and the clusters smear into a horizontal band. Squashed vertically to
      // suit a 16:9 panel.
      const gi = Math.max(0, guilds.indexOf(sp.guild));
      const seen = guildCounts.get(sp.guild) ?? 0;
      guildCounts.set(sp.guild, seen + 1);
      const guildAngle = (gi / Math.max(1, guilds.length)) * Math.PI * 2;
      const guildRadius = 5.6;
      // Fifteen seats on a ring of radius 5.6 are ~2.3 units apart, so a cluster
      // that reached 2.15 for its rarest member overlapped its neighbours and the
      // rosette read as one smear. Kept comfortably inside the seat spacing.
      const inner = (0.35 + (1 - abundance) * 1.05) * spreadOf(sp.guild);
      const spin = seen * 2.399963; // golden angle keeps clusters evenly filled
      clusters[i * 3] = Math.cos(guildAngle) * guildRadius + Math.cos(spin) * inner;
      clusters[i * 3 + 1] =
        Math.sin(guildAngle) * guildRadius * 0.58 + Math.sin(spin) * inner * 0.72;
      clusters[i * 3 + 2] = (rand(sp.sci, 3) - 0.5) * 1.4;

      const [r, g, b] = toRGB(GUILD_COLORS[sp.guild] ?? PALETTE.foil);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      // World units, converted to pixels by distance in the vertex shader.
      // Flagship species are enlarged so a 3-detection otter stays findable.
      scales[i] = (1.05 + abundance * 2.6) * (sp.flagship ? 1.55 : 1);
      seeds[i] = rand(sp.sci, 4);
      nights[i] = sp.nightRatio;
      guildIndex[i] = gi;
      selectedAttr[i] = 0;
      dimmed[i] = 0;
      waves[i] = 0;
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aCluster', new THREE.BufferAttribute(clusters, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    g.setAttribute('aNight', new THREE.BufferAttribute(nights, 1));
    g.setAttribute('aGuild', new THREE.BufferAttribute(guildIndex, 1));
    g.setAttribute('aSelected', new THREE.BufferAttribute(selectedAttr, 1));
    g.setAttribute('aDimmed', new THREE.BufferAttribute(dimmed, 1));
    g.setAttribute('aWave', new THREE.BufferAttribute(waves, 1));

    /* ---- guild centres, in both arrangements ---- */

    // Swarm centroid per guild, so a filament in swarm space still points at
    // where its guild actually is rather than at the origin.
    const swarmSum = guilds.map(() => [0, 0, 0, 0, 0]); // x, y, z, nightSum, count
    list.forEach((sp, i) => {
      const gi = Math.max(0, guilds.indexOf(sp.guild));
      const acc = swarmSum[gi];
      acc[0] += positions[i * 3];
      acc[1] += positions[i * 3 + 1];
      acc[2] += positions[i * 3 + 2];
      acc[3] += sp.nightRatio;
      acc[4] += 1;
    });

    const centre = guilds.map((guild, gi) => {
      const acc = swarmSum[gi];
      const count = Math.max(1, acc[4]);
      const angle = (gi / Math.max(1, guilds.length)) * Math.PI * 2;
      return {
        guild,
        count: acc[4],
        // The rosette seat, matching the layout above exactly.
        cluster: [Math.cos(angle) * 5.6, Math.sin(angle) * 5.6 * 0.58, 0] as const,
        swarm: [acc[0] / count, acc[1] / count, acc[2] / count] as const,
        night: acc[3] / count,
      };
    });

    /* ---- filaments: two vertices per species ---- */

    const fSwarm = new Float32Array(n * 2 * 3);
    const fCluster = new Float32Array(n * 2 * 3);
    const fColor = new Float32Array(n * 2 * 3);
    const fSeed = new Float32Array(n * 2);
    const fNight = new Float32Array(n * 2);
    const fDrift = new Float32Array(n * 2);
    const fEnd = new Float32Array(n * 2);
    const fSelected = new Float32Array(n * 2);
    const fDimmed = new Float32Array(n * 2);

    list.forEach((sp, i) => {
      const gi = Math.max(0, guilds.indexOf(sp.guild));
      const hub = centre[gi];
      const [r, g2, b] = toRGB(GUILD_COLORS[sp.guild] ?? PALETTE.foil);

      // v0 = the animal. Same seed, same night ratio and full drift as its mark,
      // which is what makes the line land on it.
      const v0 = i * 2;
      const v1 = v0 + 1;
      for (const v of [v0, v1]) {
        fColor[v * 3] = r;
        fColor[v * 3 + 1] = g2;
        fColor[v * 3 + 2] = b;
        fSeed[v] = seeds[i];
      }

      fSwarm[v0 * 3] = positions[i * 3];
      fSwarm[v0 * 3 + 1] = positions[i * 3 + 1];
      fSwarm[v0 * 3 + 2] = positions[i * 3 + 2];
      fCluster[v0 * 3] = clusters[i * 3];
      fCluster[v0 * 3 + 1] = clusters[i * 3 + 1];
      fCluster[v0 * 3 + 2] = clusters[i * 3 + 2];
      fNight[v0] = sp.nightRatio;
      fDrift[v0] = 1;
      fEnd[v0] = 0;

      // v1 = the guild's centre. No drift, and the guild's mean night ratio, so
      // the hub sits at the height of the cluster it gathers.
      fSwarm[v1 * 3] = hub.swarm[0];
      fSwarm[v1 * 3 + 1] = hub.swarm[1];
      fSwarm[v1 * 3 + 2] = hub.swarm[2];
      fCluster[v1 * 3] = hub.cluster[0];
      fCluster[v1 * 3 + 1] = hub.cluster[1];
      fCluster[v1 * 3 + 2] = hub.cluster[2];
      fNight[v1] = hub.night;
      fDrift[v1] = 0;
      fEnd[v1] = 1;

      fSelected[v0] = 0;
      fSelected[v1] = 0;
      fDimmed[v0] = 0;
      fDimmed[v1] = 0;
    });

    const fg = new THREE.BufferGeometry();
    // `position` is never read by the filament shader — the two arrangements are
    // the real inputs — but three.js needs one to compute a draw range, and the
    // swarm layout is the honest bounding volume for it.
    fg.setAttribute('position', new THREE.BufferAttribute(fSwarm.slice(), 3));
    fg.setAttribute('aSwarm', new THREE.BufferAttribute(fSwarm, 3));
    fg.setAttribute('aClusterEnd', new THREE.BufferAttribute(fCluster, 3));
    fg.setAttribute('aColor', new THREE.BufferAttribute(fColor, 3));
    fg.setAttribute('aSeed', new THREE.BufferAttribute(fSeed, 1));
    fg.setAttribute('aNight', new THREE.BufferAttribute(fNight, 1));
    fg.setAttribute('aDrift', new THREE.BufferAttribute(fDrift, 1));
    fg.setAttribute('aEnd', new THREE.BufferAttribute(fEnd, 1));
    fg.setAttribute('aSelected', new THREE.BufferAttribute(fSelected, 1));
    fg.setAttribute('aDimmed', new THREE.BufferAttribute(fDimmed, 1));
    // The rosette reaches further out than the swarm does, so bound for both.
    fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12);

    /* ---- halo rings ---- */

    const RING_SEGMENTS = 72;
    const hCentre: number[] = [];
    const hRadial: number[] = [];
    const hColor: number[] = [];
    const hAngle: number[] = [];
    const hGuild: number[] = [];

    centre.forEach((hub, gi) => {
      // Drawn just outside the widest mark its guild can place, using the same
      // spread function — so the ring is a boundary the cluster really has,
      // not a second, disagreeing statement about the same count.
      const radius = 1.4 * spreadOf(hub.guild) + 0.3;
      const [r, g2, b] = toRGB(GUILD_COLORS[hub.guild] ?? PALETTE.foil);
      for (let s = 0; s < RING_SEGMENTS; s++) {
        for (const step of [s, s + 1]) {
          const angle = (step / RING_SEGMENTS) * Math.PI * 2;
          hCentre.push(hub.cluster[0], hub.cluster[1], hub.cluster[2]);
          // Squashed to match the rosette's own vertical compression.
          hRadial.push(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.82);
          hColor.push(r, g2, b);
          hAngle.push(step / RING_SEGMENTS);
          hGuild.push(gi);
        }
      }
    });

    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(hCentre.slice(), 3));
    hg.setAttribute('aCentre', new THREE.Float32BufferAttribute(hCentre, 3));
    hg.setAttribute('aRadial', new THREE.Float32BufferAttribute(hRadial, 2));
    hg.setAttribute('aColor', new THREE.Float32BufferAttribute(hColor, 3));
    hg.setAttribute('aAngle', new THREE.Float32BufferAttribute(hAngle, 1));
    hg.setAttribute('aGuild', new THREE.Float32BufferAttribute(hGuild, 1));
    hg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12);

    return { geometry: g, filamentGeometry: fg, haloGeometry: hg, species: list };
  }, [data.species, guilds]);

  /**
   * One uniform record shared by all three materials. Sharing the object — not
   * copying the values — is what guarantees the marks, their filaments and the
   * guild rings can never be a frame out of step with each other. three.js
   * uploads only the uniforms a given program actually declares, so the extras
   * cost nothing.
   */
  /**
   * The pictogram layer. Both outlines are baked into one buffer so the shader
   * can hold either — or morph between them if the visitor jumps from a bird to
   * a mammal — without rebuilding anything.
   */
  const glyphGeometry = useMemo(() => {
    const bird = sampleOutline('bird', GLYPH_POINTS);
    const mammal = sampleOutline('mammal', GLYPH_POINTS);
    const scatter = new Float32Array(GLYPH_POINTS * 3);
    const seeds = new Float32Array(GLYPH_POINTS);
    for (let i = 0; i < GLYPH_POINTS; i++) {
      // Where a mark waits when nothing is chosen: a loose cloud the size of the
      // swarm, so the form gathers out of the same space the animals live in.
      const theta = (i * 2.399963) % (Math.PI * 2);
      const radius = 3 + ((i * 0.7548776662466927) % 1) * 6;
      scatter[i * 3] = Math.cos(theta) * radius;
      scatter[i * 3 + 1] = (((i * 0.5698402909980532) % 1) - 0.5) * 6;
      scatter[i * 3 + 2] = Math.sin(theta) * radius * 0.4;
      seeds[i] = (i * 0.6180339887498949) % 1;
    }

    const g = new THREE.BufferGeometry();
    // `position` is unused by the glyph shader but three.js needs one to bound
    // the draw; the scattered cloud is the honest extent.
    g.setAttribute('position', new THREE.BufferAttribute(scatter.slice(), 3));
    g.setAttribute('aBird', new THREE.BufferAttribute(bird, 2));
    g.setAttribute('aMammal', new THREE.BufferAttribute(mammal, 2));
    g.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 14);
    return g;
  }, []);

  const glyphUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uForm: { value: 0 },
      uGlyph: { value: 0 },
      uScale: { value: 5.6 },
      uSize: { value: 0.5 },
      uColor: { value: new THREE.Color(PALETTE.foil) },
    }),
    [],
  );

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uCluster: { value: 0 },
      uHour: { value: hour },
      uDrift: { value: 0.9 },
      // Above 1 means "no pulse in flight"; a selection resets it to 0.
      uPulse: { value: 2 },
      uGuildSel: { value: -1 },
    }),
    // `hour` seeds the initial value only; it is driven imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* Selection highlighting is pushed straight into the attribute buffers so a
     tap never triggers a React re-render of 213 marks. */
  const applySelection = useMemo(
    () => (target: Species | null) => {
      const selectedAttr = geometry.getAttribute('aSelected') as THREE.BufferAttribute;
      const dimmed = geometry.getAttribute('aDimmed') as THREE.BufferAttribute;
      const waveAttr = geometry.getAttribute('aWave') as THREE.BufferAttribute;
      const fSel = filamentGeometry.getAttribute('aSelected') as THREE.BufferAttribute;
      const fDim = filamentGeometry.getAttribute('aDimmed') as THREE.BufferAttribute;
      const sel = selectedAttr.array as Float32Array;
      const dim = dimmed.array as Float32Array;
      const wave = waveAttr.array as Float32Array;
      const fs = fSel.array as Float32Array;
      const fd = fDim.array as Float32Array;

      // Distances are measured in the arrangement that is actually on screen at
      // the moment of the touch, so the shockwave travels through the figure the
      // visitor is looking at — swarm or rosette.
      const blend = clusterRef.current;
      const swarm = geometry.getAttribute('position') as THREE.BufferAttribute;
      const rosette = geometry.getAttribute('aCluster') as THREE.BufferAttribute;
      const at = (i: number, axis: 0 | 1 | 2) => {
        const s = axis === 0 ? swarm.getX(i) : axis === 1 ? swarm.getY(i) : swarm.getZ(i);
        const c = axis === 0 ? rosette.getX(i) : axis === 1 ? rosette.getY(i) : rosette.getZ(i);
        return s * (1 - blend) + c * blend;
      };

      let originIndex = -1;
      if (target !== null) originIndex = species.findIndex((s) => s.sci === target.sci);

      let maxDistance = 1;
      const distances = new Float32Array(species.length);
      if (originIndex >= 0) {
        const ox = at(originIndex, 0);
        const oy = at(originIndex, 1);
        const oz = at(originIndex, 2);
        for (let i = 0; i < species.length; i++) {
          const d = Math.hypot(at(i, 0) - ox, at(i, 1) - oy, at(i, 2) - oz);
          distances[i] = d;
          if (d > maxDistance) maxDistance = d;
        }
      }

      for (let i = 0; i < species.length; i++) {
        const isTarget = target !== null && species[i].sci === target.sci;
        sel[i] = isTarget ? 1 : 0;
        wave[i] = originIndex >= 0 ? distances[i] / maxDistance : 0;
        // Dim everything outside the selected animal's own guild.
        let d = target === null ? 0 : species[i].guild === target.guild ? (isTarget ? 0 : 0.55) : 1;
        // The flagship filter pushes everything else back, but never to zero.
        if (filterRef.current && !species[i].flagship && !isTarget) d = Math.max(d, 0.88);
        dim[i] = d;
        // Both ends of the filament carry the same state as the mark it serves.
        fs[i * 2] = sel[i];
        fs[i * 2 + 1] = sel[i];
        fd[i * 2] = d;
        fd[i * 2 + 1] = d;
      }

      selectedAttr.needsUpdate = true;
      dimmed.needsUpdate = true;
      waveAttr.needsUpdate = true;
      fSel.needsUpdate = true;
      fDim.needsUpdate = true;
    },
    [geometry, filamentGeometry, species],
  );

  const lastSelected = useRef<string | null>(null);
  const filterRef = useRef(flagshipOnly);
  const lastFilter = useRef(flagshipOnly);
  /** Age of the shockwave, 0..1 in flight and parked above 1 when spent. */
  const pulseRef = useRef(2);

  /**
   * Nearest-mark picking in screen space. Raycasting `Points` with a threshold
   * mis-picks badly when marks vary this much in size, so this projects each
   * mark and takes the closest within a finger-sized radius.
   */
  const pick = (clientX: number, clientY: number): Species | null => {
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const clusters = geometry.getAttribute('aCluster') as THREE.BufferAttribute;
    const blend = clusterRef.current;
    const spin = swarmRef.current;
    const v = new THREE.Vector3();
    let best: Species | null = null;
    let bestDistance = 60; // px

    for (let i = 0; i < species.length; i++) {
      v.set(
        positions.getX(i) * (1 - blend) + clusters.getX(i) * blend,
        positions.getY(i) * (1 - blend) + clusters.getY(i) * blend,
        positions.getZ(i) * (1 - blend) + clusters.getZ(i) * blend,
      );
      // Through the swarm's own transform first: the figure turns, and picking
      // against the untransformed buffer drifts further off the longer the piece
      // has been running.
      if (spin) v.applyMatrix4(spin.matrixWorld);
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestDistance) {
        bestDistance = d;
        best = species[i];
      }
    }
    return best;
  };

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    revealRef.current += (reveal - revealRef.current) * Math.min(1, delta * 2);
    clusterRef.current += (cluster - clusterRef.current) * Math.min(1, delta * 1.4);
    hourRef.current += (hour - hourRef.current) * Math.min(1, delta * 1.2);

    uniforms.uTime.value = t;
    uniforms.uReveal.value = revealRef.current;
    uniforms.uCluster.value = clusterRef.current;
    uniforms.uHour.value = hourRef.current;

    filterRef.current = flagshipOnly;
    if (lastSelected.current !== (selected?.sci ?? null) || lastFilter.current !== flagshipOnly) {
      const isNewAnimal = lastSelected.current !== (selected?.sci ?? null);
      lastSelected.current = selected?.sci ?? null;
      lastFilter.current = flagshipOnly;
      applySelection(selected);
      // Only a change of animal fires the shockwave; toggling the flagship
      // filter re-runs the same buffer write and must not look like a touch.
      if (isNewAnimal) pulseRef.current = selected ? 0 : 2;
    }

    /* ---- the pictogram ---- */
    glyphUniforms.uTime.value = t;
    // Only ever holds a form while something is chosen, and it takes its time
    // both ways: gathering is the point, and a form that snapped would read as
    // an overlay rather than as the swarm doing something.
    glyphUniforms.uForm.value +=
      ((selected ? 1 : 0) - glyphUniforms.uForm.value) * Math.min(1, delta * 1.5);
    if (selected) {
      // Held until the next selection rather than eased back: with nothing
      // chosen there is no form on screen to be wrong about, and morphing the
      // ghost to a bird as it disperses looks like an error.
      glyphUniforms.uGlyph.value +=
        ((glyphFor(selected.guild) === 'mammal' ? 1 : 0) - glyphUniforms.uGlyph.value) *
        Math.min(1, delta * 2.2);
      glyphUniforms.uColor.value.set(GUILD_COLORS[selected.guild] ?? PALETTE.foil);
    }

    // A little over half a second from the mark to the far edge of the swarm.
    if (pulseRef.current <= 1) pulseRef.current = Math.min(1.2, pulseRef.current + delta * 1.6);
    uniforms.uPulse.value = pulseRef.current;
    uniforms.uGuildSel.value = selected ? guilds.indexOf(selected.guild) : -1;

    // The swarm turns slowly, but the guild rosette is a screen-facing figure —
    // spinning it would hide the very structure the arrangement exists to show.
    //
    // The angle is *accumulated* rather than derived from elapsed time: with
    // `t * rate * (1 - cluster)` the figure snaps back toward zero every time the
    // cluster control moves, which after a few minutes is a visible lurch.
    spinRef.current += delta * 0.018 * (1 - clusterRef.current);
    // As the rosette forms, the accumulated angle unwinds to zero — the guild
    // arrangement is a flat, screen-facing figure and any Y rotation left in it
    // would foreshorten the very structure the arrangement exists to show.
    spinRef.current *= Math.exp(-delta * 1.1 * clusterRef.current);
    if (swarmRef.current) swarmRef.current.rotation.y = spinRef.current;
  });

  return (
    <group>
      {/*
        Behind everything, and outside the swarm's rotation: the ghost is a label
        held up beside the constellation, not a member of it.
      */}
      <points geometry={glyphGeometry} position={[0, 0, -3.5]} renderOrder={-1}>
        <shaderMaterial
          vertexShader={GLYPH_VERT}
          fragmentShader={GLYPH_FRAG}
          uniforms={glyphUniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      <group ref={swarmRef}>
        {/* Drawn before the marks so the marks always sit on top of their own web. */}
        <lineSegments geometry={filamentGeometry} renderOrder={0}>
          <shaderMaterial
            vertexShader={FILAMENT_VERT}
            fragmentShader={FILAMENT_FRAG}
            uniforms={uniforms}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>

        <lineSegments geometry={haloGeometry} renderOrder={0}>
          <shaderMaterial
            vertexShader={HALO_VERT}
            fragmentShader={HALO_FRAG}
            uniforms={uniforms}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>

        <points
          ref={pointsRef}
          geometry={geometry}
          onPointerDown={(event) => {
            event.stopPropagation();
            const hit = pick(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
            onSelect?.(hit);
          }}
        >
          <shaderMaterial
            vertexShader={CHOIR_VERT}
            fragmentShader={CHOIR_FRAG}
            uniforms={uniforms}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>
      </group>

      {/* A wide invisible plane so taps on empty space clear the selection. */}
      <mesh
        position={[0, 0, -6]}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect?.(null);
        }}
      >
        <planeGeometry args={[80, 50]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
