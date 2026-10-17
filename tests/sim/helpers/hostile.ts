// Replaces every source of non-determinism with a function that throws while `fn` runs, then restores it. If the
// simulation touched any of them, fn throws; nothing is caught here.
const MATH_FORBIDDEN = ['random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'pow', 'cbrt', 'hypot'] as const;

export function withHostileGlobals<T>(fn: () => T): T {
  const g = globalThis as any;
  const savedMath: Record<string, unknown> = {};
  for (const name of MATH_FORBIDDEN) {
    savedMath[name] = (Math as any)[name];
    (Math as any)[name] = () => {
      throw new Error(`Math.${name} called inside the simulation`);
    };
  }
  const savedDate = g.Date;
  const hostileDate: any = function HostileDate() {
    throw new Error('Date used inside the simulation');
  };
  hostileDate.now = () => {
    throw new Error('Date.now called inside the simulation');
  };
  g.Date = hostileDate;
  const perf = g.performance;
  const hadOwnNow = Object.hasOwn(perf, 'now');
  const savedNow = perf.now;
  perf.now = () => {
    throw new Error('performance.now called inside the simulation');
  };
  const cryptoDesc = Object.getOwnPropertyDescriptor(g, 'crypto');
  Object.defineProperty(g, 'crypto', {
    configurable: true,
    get() {
      throw new Error('crypto used inside the simulation');
    },
  });
  try {
    return fn();
  } finally {
    for (const name of MATH_FORBIDDEN) (Math as any)[name] = savedMath[name];
    g.Date = savedDate;
    if (hadOwnNow) perf.now = savedNow;
    else delete perf.now;
    if (cryptoDesc) Object.defineProperty(g, 'crypto', cryptoDesc);
    else delete g.crypto;
  }
}
