// Site-relative addresses. ALL runtime fetches of data/ and all links to other pages go through
// siteUrl(); never './data/...', '/data/...' or import.meta.env.BASE_URL + ... (docs/DECISIONS.md, M00b).
//
// In the build every chunk (also worker chunks) lives in assets/, so the site root is one level up from
// import.meta.url. In dev the Vite server serves the site at the origin root.

/** Pure helper (unit-tested): resolve `path` (no leading slash needed) against a site root URL. */
export function joinSiteUrl(root: string, path: string): string {
  return new URL(path.replace(/^\/+/, ''), root).href;
}

function computeRootUrl(): string {
  if (import.meta.env.DEV) {
    // `self` is also defined in a Worker; the fallback only matters for unit tests in Node.
    const here = typeof self !== 'undefined' ? self.location.href : 'http://localhost/';
    return new URL('/', here).href;
  }
  // Held in a variable so that Vite does not treat `new URL('../', import.meta.url)` as an asset reference.
  const up = '../';
  return new URL(up, import.meta.url).href;
}

/** Absolute URL of the site root (always ends with a slash). */
export const ROOT_URL: string = computeRootUrl();

/** Absolute URL of a file or page of the site, e.g. siteUrl('data/manifest.json') or siteUrl('probe.html'). */
export function siteUrl(path: string): string {
  return joinSiteUrl(ROOT_URL, path);
}
