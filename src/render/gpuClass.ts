// Graphics card classes (AutoTier-1): pure TS, no three and no DOM. `classifyRenderer` turns the unmasked WebGL renderer string (and the
// vendor string as a second opinion) into 'software' | 'integrated' | 'capable'; `src/render/quality.ts` picks the default tier from it.
//
// The table below is ordered; the FIRST matching row of the renderer string wins, and the vendor string is asked only when the renderer
// string matches no row (D159 in docs/DECISIONS.md explains each rule and the tests pin 25+ real strings).
//
//   1. software   SwiftShader, llvmpipe, softpipe, lavapipe, WARP, Microsoft Basic Render Driver, "software": no GPU at all.
//   2. capable    Intel Arc: a discrete-class Intel part, unlike the shared-memory HD / UHD / Iris.
//   3. integrated Intel (HD, UHD, Iris, Iris Xe, "Graphics"): shares memory and power with the CPU.
//   4. capable    Radeon RX / Pro / VII / Vega with "RX" in the name (discrete cards), named before the APU rule on purpose.
//   5. integrated AMD APU graphics: "Radeon(TM) Graphics", "Radeon Vega N Graphics", "Radeon 780M" (a Ryzen's built-in part: the string
//                 carries no model, and the part has a fraction of a discrete card's throughput).
//   6. capable    other AMD / ATI Radeon (older discrete cards, Radeon Pro of a Mac).
//   7. capable    NVIDIA GeForce / RTX / GTX / Quadro / Titan, also "Laptop GPU" and "Max-Q" (a discrete chip).
//   8. capable    Apple (the M series, "Apple GPU"): a strong integrated design that is far above the Intel parts.
//   9. integrated mobile parts: Mali, Adreno, PowerVR, VideoCore, Immortalis, Xclipse, Vivante.
//  10. capable    anything unknown. A wrong guess toward the strong side is corrected later by the adaptive resolution (AutoTier-2) and costs
//                 only one slow first minute; a wrong guess toward the weak side takes picture quality from a player with a good card.

export type GpuClass = 'software' | 'integrated' | 'capable';

interface GpuRule {
  readonly cls: GpuClass;
  readonly pattern: RegExp;
}

export const GPU_RULES: readonly GpuRule[] = [
  { cls: 'software', pattern: /swiftshader|llvmpipe|softpipe|lavapipe|\bwarp\b|basic render|software|mesa offscreen/i },
  { cls: 'capable', pattern: /intel.*\barc\b/i },
  { cls: 'integrated', pattern: /\bintel\b/i },
  { cls: 'capable', pattern: /radeon\s*(\(tm\)\s*)?(rx|pro|vii|r9|hd\s*[5-7]\d{3}\b)|radeon rx|\brx\s*\d/i },
  { cls: 'integrated', pattern: /radeon\s*(\(tm\)\s*)?(graphics|vega|\d{3}m\b)|\bvega\s*\d+\s*graphics|ryzen/i },
  { cls: 'capable', pattern: /radeon|\bamd\b|\bati\b/i },
  { cls: 'capable', pattern: /nvidia|geforce|quadro|titan|\brtx\b|\bgtx\b/i },
  { cls: 'capable', pattern: /\bapple\b/i },
  { cls: 'integrated', pattern: /\bmali\b|adreno|powervr|videocore|immortalis|xclipse|vivante/i },
];

function classOf(text: string): GpuClass | null {
  for (const rule of GPU_RULES) if (rule.pattern.test(text)) return rule.cls;
  return null;
}

/** The class of a graphics card by its WebGL renderer string (vendor only consulted when the renderer matches nothing). Unknown = capable. */
export function classifyRenderer(renderer: string, vendor?: string): GpuClass {
  return classOf(renderer) ?? (vendor === undefined ? null : classOf(vendor)) ?? 'capable';
}

/**
 * A short readable card name for the player: "Intel UHD Graphics" out of
 * `ANGLE (Intel, Intel(R) UHD Graphics (0x0000A721) Direct3D11 vs_5_0 ps_5_0, D3D11)`. Drops the ANGLE wrapper, the vendor field,
 * the device id, the Direct3D tail and the trademark marks. Returns '' for an empty string.
 */
export function readableGpuName(renderer: string): string {
  let s = renderer.trim();
  const angle = /^ANGLE\s*\((.*)\)$/i.exec(s);
  if (angle !== null) {
    const parts = (angle[1] as string).split(', ');
    s = parts.length >= 3 ? (parts[1] as string) : (parts[parts.length - 1] as string);
  }
  const vulkan = /^Vulkan [\d.]+ \((.*)\)$/.exec(s);
  if (vulkan !== null) s = vulkan[1] as string;
  s = s
    .replace(/^ANGLE Metal Renderer:\s*/i, '')
    .replace(/^Mesa\s+(DRI\s+)?/i, '')
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .replace(/\s*Direct3D\d*\s*(vs_\d_\d\s*)?(ps_\d_\d)?/gi, ' ')
    .replace(/\(R\)|\(TM\)/gi, '')
    .replace(/\/PCIe\/SSE2$/i, '')
    .replace(/\s*OpenGL Engine$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}
