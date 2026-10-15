// A static cost proxy of a GLSL shader text (M07b). NOT a measurement of GPU time (there is no GPU in the cloud container) and not even a count of
// executed instructions: it counts the CALL SITES and OPERATORS of the source after the comments are removed, so a change that adds per-pixel
// work (a texture fetch, a loop, a transcendental function, an octave of noise) shows up as a different number. The tests pin the numbers of the
// chunk FRAGMENT shader (the per-pixel cost of the default tier: the user sees a steady 30 fps there, so it must not grow without a decision).
export interface ShaderCost {
  /** Texture fetch call sites: texture, textureLod, texelFetch and the fetchCode helper. */
  fetches: number;
  /** `for` loops. */
  loops: number;
  /** Transcendental and square-root call sites. */
  transcendentals: number;
  /** Screen-space derivative call sites. */
  derivatives: number;
  /** Binary + - * / operators and compound assignments: a rough size of the arithmetic. */
  operators: number;
  /** Non-empty lines of code (comments removed). */
  lines: number;
}

export function stripComments(glsl: string): string {
  return glsl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function shaderCost(glsl: string): ShaderCost {
  const code = stripComments(glsl);
  const count = (re: RegExp): number => (code.match(re) ?? []).length;
  return {
    fetches: count(/\b(texture|textureLod|texelFetch|fetchCode)\s*\(/g),
    loops: count(/\bfor\s*\(/g),
    transcendentals: count(/\b(sin|cos|tan|asin|acos|atan|exp|exp2|log|log2|pow|sqrt|inversesqrt)\s*\(/g),
    derivatives: count(/\b(dFdx|dFdy|fwidth)\s*\(/g),
    operators: count(/[^+\-*/=<>!]([+\-*/])=?(?![+\-*/=])/g),
    lines: code.split('\n').filter((l) => l.trim().length > 0).length,
  };
}
