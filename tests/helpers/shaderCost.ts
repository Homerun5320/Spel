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

// ---- the EXECUTED cost (M07b audit) -------------------------------------------------------------------------------------------------------
// `shaderCost` counts call sites of one text. `fineMottle` has 74 operators in its own text but calls `ownerNoise2` five times, which is four hashes of
// about fourteen integer operations each and a bilinear mix: about 380 operations a pixel in a ground view that the call-site count never shows. The
// functions below EXPAND the callees: the cost of a function is its own operators plus the cost of every function it calls, times the constant trip
// count of the `for` loop a call sits in. Branches count in full (an upper bound of what a pixel runs when every gate is open: a near view).
export interface ExecutedCost {
  operators: number;
  fetches: number;
  transcendentals: number;
  derivatives: number;
  /** Loops whose bound could not be read as a number or a named int constant (counted once). */
  unresolvedLoops: number;
}

interface FnDef {
  name: string;
  body: string;
}

/** The functions defined in a GLSL text (brace matched; comments are removed first). */
export function parseFunctions(glsl: string): Map<string, FnDef> {
  const code = stripComments(glsl);
  const out = new Map<string, FnDef>();
  const re = /(?:^|\n)\s*(?:float|vec[234]|ivec[234]|int|uint|bool|void|mat[234]|[A-Z]\w*)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let k = open;
    for (; k < code.length; k++) {
      if (code[k] === '{') depth++;
      else if (code[k] === '}' && --depth === 0) break;
    }
    out.set(m[1] as string, { name: m[1] as string, body: code.slice(open + 1, k) });
    re.lastIndex = k;
  }
  return out;
}

const countIn = (code: string, re: RegExp): number => (code.match(re) ?? []).length;

function ownCounts(code: string): Omit<ExecutedCost, 'unresolvedLoops'> {
  return {
    // + - * / (as the call-site proxy counts them) and the integer operators of the hashes: ^ >> << & |
    operators: countIn(code, /[^+\-*/=<>!]([+\-*/])=?(?![+\-*/=])/g) + countIn(code, />>=?|<<=?|\^=?|&(?!&)=?|\|(?!\|)=?/g),
    fetches: countIn(code, /\b(texture|textureLod|texelFetch|fetchCode)\s*\(/g),
    transcendentals: countIn(code, /\b(sin|cos|tan|asin|acos|atan|exp|exp2|log|log2|pow|sqrt|inversesqrt)\s*\(/g),
    derivatives: countIn(code, /\b(dFdx|dFdy|fwidth)\s*\(/g),
  };
}

const add = (a: ExecutedCost, b: ExecutedCost, times = 1): ExecutedCost => ({
  operators: a.operators + times * b.operators,
  fetches: a.fetches + times * b.fetches,
  transcendentals: a.transcendentals + times * b.transcendentals,
  derivatives: a.derivatives + times * b.derivatives,
  unresolvedLoops: a.unresolvedLoops + b.unresolvedLoops,
});
const ZERO: ExecutedCost = { operators: 0, fetches: 0, transcendentals: 0, derivatives: 0, unresolvedLoops: 0 };

/**
 * The expanded cost of function `entry` of a GLSL text. `skip` names functions whose call sites count nothing (the orbit-view figure leaves out the
 * gated near-view mottling), `gate` names functions whose cost is only the code before their first `if` (the always-run test of a gated function).
 */
export function executedCost(glsl: string, entry: string, opts: { skip?: readonly string[]; gate?: readonly string[] } = {}): ExecutedCost {
  const code = stripComments(glsl);
  const fns = parseFunctions(glsl);
  const intConsts = new Map<string, number>();
  for (const m of code.matchAll(/const\s+int\s+(\w+)\s*=\s*(\d+)\s*;/g)) intConsts.set(m[1] as string, Number(m[2]));
  const memo = new Map<string, ExecutedCost>();
  const skip = new Set(opts.skip ?? []);
  const gate = new Set(opts.gate ?? []);
  const names = [...fns.keys()];

  const calls = (text: string, self: string): ExecutedCost => {
    let total = ZERO;
    for (const n of names) {
      if (n === self || skip.has(n)) continue;
      const k = countIn(text, new RegExp(`\\b${n}\\s*\\(`, 'g'));
      if (k > 0) total = add(total, fnCost(n), k);
    }
    return total;
  };

  const blockCost = (text: string, self: string): ExecutedCost => {
    let total = ZERO;
    let rest = text;
    // split at the top-level `for` loops: the code around them runs once, a loop body runs `trip` times
    for (;;) {
      const f = /\bfor\s*\(/.exec(rest);
      if (!f) break;
      const before = rest.slice(0, f.index);
      total = add(total, { ...ownCounts(before), unresolvedLoops: 0 });
      total = add(total, calls(before, self));
      let depth = 0;
      let k = f.index + f[0].length - 1;
      for (; k < rest.length; k++) {
        if (rest[k] === '(') depth++;
        else if (rest[k] === ')' && --depth === 0) break;
      }
      const header = rest.slice(f.index, k + 1);
      // `for (int k = S; k < B; k++)` or `k <= B`: B a number or a named int constant
      const lm = /=\s*(\d+)\s*;\s*\w+\s*(<=?)\s*(\w+)\s*;/.exec(header);
      const bound = lm?.[3] ?? '';
      const limit = /^\d+$/.test(bound) ? Number(bound) : (intConsts.get(bound) ?? NaN);
      const trip = lm ? limit - Number(lm[1]) + (lm[2] === '<=' ? 1 : 0) : NaN;
      let bodyStart = k + 1;
      while (/\s/.test(rest[bodyStart] ?? '')) bodyStart++;
      let bodyEnd: number;
      if (rest[bodyStart] === '{') {
        depth = 0;
        bodyEnd = bodyStart;
        for (; bodyEnd < rest.length; bodyEnd++) {
          if (rest[bodyEnd] === '{') depth++;
          else if (rest[bodyEnd] === '}' && --depth === 0) break;
        }
        bodyEnd += 1;
      } else {
        bodyEnd = rest.indexOf(';', bodyStart) + 1;
      }
      const inner = blockCost(rest.slice(bodyStart, bodyEnd), self);
      const t = Number.isFinite(trip) ? trip : 1;
      total = add(total, inner, t);
      if (!Number.isFinite(trip)) total = { ...total, unresolvedLoops: total.unresolvedLoops + 1 };
      rest = rest.slice(bodyEnd);
    }
    total = add(total, { ...ownCounts(rest), unresolvedLoops: 0 });
    return add(total, calls(rest, self));
  };

  const fnCost = (name: string): ExecutedCost => {
    const hit = memo.get(name);
    if (hit) return hit;
    const def = fns.get(name);
    if (!def) throw new Error(`shader function ${name} not found`);
    memo.set(name, ZERO); // recursion guard (GLSL has none)
    let body = def.body;
    if (gate.has(name)) {
      const i = body.search(/\bif\s*\(/);
      if (i >= 0) body = body.slice(0, i);
    }
    const c = blockCost(body, name);
    memo.set(name, c);
    return c;
  };

  return fnCost(entry);
}
