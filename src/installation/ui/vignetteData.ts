import plates from './vignettes.json';

/**
 * The vignette plates, as data.
 *
 * Split from `Vignette.tsx` so that file exports a component and nothing else —
 * a module mixing components with constants loses fast refresh, and these two
 * are imported by the chapter code without the canvas.
 */
export type VignetteKind = keyof typeof plates.plates;

/** Where the clouds came from, for the colophon. */
export const VIGNETTE_SOURCE = plates.source;
