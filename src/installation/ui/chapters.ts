import type { ChapterId } from '../engine/Scene';

export interface ChapterEntry {
  id: ChapterId;
  numeral: string;
  name: string;
}

/**
 * Chapter order as the visitor walks it. The prologue is listed so the way back
 * to the ambient state is always one touch away, never a timeout the visitor has
 * to wait out.
 */
export const CHAPTERS: ChapterEntry[] = [
  { id: 'chorus', numeral: '\u2014', name: 'Le ch\u0153ur' },
  { id: 'terroir', numeral: 'I', name: 'Terroir' },
  { id: 'circadian', numeral: 'II', name: 'Circadien' },
  { id: 'species', numeral: 'III', name: 'Esp\u00e8ces' },
  { id: 'flux', numeral: 'IV', name: 'Flux' },
  { id: 'overlap', numeral: 'V', name: 'Chevauchement' },
  { id: 'passages', numeral: 'VI', name: 'Passages' },
];
