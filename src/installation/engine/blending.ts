import { AddEquation, CustomBlending, OneFactor, type MaterialParameters } from 'three';

/**
 * True additive blending: `dst += src.rgb`, with the alpha channel ignored.
 *
 * three's AdditiveBlending is `SrcAlpha, One`, which multiplies the fragment
 * colour by its own alpha on the way out. Every shader here already scales its
 * colour by coverage, so that preset squares the term — a line at 10% intensity
 * lands at 1%, and the faint structural passes (the vine rows, the dial guides,
 * the species links) disappear entirely while the hot cores still bloom. Making
 * the blend purely additive is what lets the intensity written in a shader mean
 * the intensity that reaches the screen.
 */
export const ADDITIVE: Pick<MaterialParameters, 'blending' | 'blendEquation' | 'blendSrc' | 'blendDst'> = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneFactor,
};
