// Preview probe page (M00b): shows, in a Swedish table, what works in the environment the page is opened in
// (a Claude Artifact, a static server or the dev server). Packs come from probe/ (made by
// `npm run artifact:pack -- --probe`); expected.json holds the length and FNV-1a of the decompressed payload.
import { decodeBase64, fnv1a32, gunzip } from './app/dataPack';
import { ROOT_URL, siteUrl } from './app/paths';

type Status = 'ok' | 'fel' | 'ej testat';

interface Row {
  key: string;
  label: string;
  status: Status;
  detail: string;
}

interface Expected {
  len: number;
  fnv1a: number;
}

const rows: Row[] = [];
const root = document.getElementById('probe-root');
if (!root) throw new Error('missing #probe-root');

function setRow(key: string, label: string, status: Status, detail: string): void {
  const existing = rows.find((r) => r.key === key);
  if (existing) {
    existing.status = status;
    existing.detail = detail;
    existing.label = label;
  } else {
    rows.push({ key, label, status, detail });
  }
  render();
}

function tableText(): string {
  return rows.map((r) => `${r.label} | ${r.status} | ${r.detail}`).join('\n');
}

const style = document.createElement('style');
style.textContent =
  'body{margin:0;padding:16px;font:15px/1.5 system-ui,sans-serif;background:#0b1020;color:#e8ecf4}' +
  'table{border-collapse:collapse;width:100%;max-width:760px}th,td{border:1px solid #38425e;padding:6px 8px;text-align:left;vertical-align:top}' +
  'td[data-status=ok]{color:#7fe08a}td[data-status=fel]{color:#ff8a8a}td[data-status="ej testat"]{color:#f2d27a}' +
  'a{color:#9cf}button{font:inherit;padding:8px 12px;margin:8px 8px 8px 0}textarea{width:100%;max-width:760px;height:8em;box-sizing:border-box}';
document.head.appendChild(style);

const h1 = document.createElement('h1');
h1.textContent = 'Testsida: vad fungerar här?';
const intro = document.createElement('p');
intro.textContent = 'Den här sidan testar vad miljön klarar. Klistra gärna in tabellen nedan i chatten.';
const table = document.createElement('table');
const out = document.createElement('textarea');
out.readOnly = true;
out.setAttribute('aria-label', 'Tabell som text');
const clipBtn = document.createElement('button');
clipBtn.textContent = 'Testa urklipp (kopierar tabellen)';
const back = document.createElement('p');
const backLink = document.createElement('a');
backLink.href = './index.html';
backLink.textContent = 'Tillbaka till spelet (index.html)';
back.appendChild(backLink);
root.append(h1, intro, table, clipBtn, out, back);

function render(): void {
  table.replaceChildren();
  const head = table.insertRow();
  for (const t of ['Test', 'Resultat', 'Detalj']) {
    const th = document.createElement('th');
    th.textContent = t;
    head.appendChild(th);
  }
  for (const r of rows) {
    const tr = table.insertRow();
    tr.dataset.probe = r.key;
    tr.insertCell().textContent = r.label;
    const st = tr.insertCell();
    st.textContent = r.status;
    st.dataset.status = r.status;
    tr.insertCell().textContent = r.detail;
  }
  out.value = tableText();
}

async function testContainer(key: string, label: string, path: string, enc: 'raw' | 'b64', expected: Expected): Promise<void> {
  setRow(key, label, 'ej testat', 'laddar...');
  const t0 = performance.now();
  try {
    const res = await fetch(siteUrl(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = enc === 'b64' ? decodeBase64(await res.text()) : new Uint8Array(await res.arrayBuffer());
    const raw = await gunzip(bytes);
    const hash = fnv1a32(raw);
    const ms = Math.round(performance.now() - t0);
    const good = raw.length === expected.len && hash === expected.fnv1a;
    setRow(
      key,
      label,
      good ? 'ok' : 'fel',
      `${ms} ms, ${bytes.length} byte in, ${raw.length} byte ut, fnv1a ${hash}${good ? '' : ` (väntade ${expected.len} byte, fnv1a ${expected.fnv1a})`}`,
    );
  } catch (err) {
    setRow(key, label, 'fel', String(err));
  }
}

function testWorker(): Promise<void> {
  setRow('worker', 'Modul-Worker (egen fil)', 'ej testat', 'startar...');
  return new Promise((resolve) => {
    let worker: Worker;
    const timer = setTimeout(() => {
      setRow('worker', 'Modul-Worker (egen fil)', 'fel', 'inget svar inom 5 s');
      resolve();
    }, 5000);
    const done = (status: Status, detail: string): void => {
      clearTimeout(timer);
      setRow('worker', 'Modul-Worker (egen fil)', status, detail);
      worker?.terminate();
      resolve();
    };
    try {
      worker = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('error', (e) => done('fel', `workerfel: ${e.message || 'okänt'}`));
      worker.addEventListener('message', (e: MessageEvent<{ ok: boolean; pong?: number; rootUrl?: string; status?: number; error?: string }>) => {
        const d = e.data;
        if (d.ok && d.pong === 42 && d.rootUrl === ROOT_URL) done('ok', `svar från workern, fetch via siteUrl gav HTTP ${d.status}`);
        else done('fel', d.ok ? `oväntat svar, rot ${d.rootUrl} (sidan har ${ROOT_URL})` : String(d.error));
      });
      worker.postMessage({ ping: 42 });
    } catch (err) {
      done('fel', String(err));
    }
  });
}

clipBtn.addEventListener('click', () => {
  setRow('clipboard', 'Urklipp (klick)', 'ej testat', 'provar...');
  const text = tableText();
  const nav = navigator.clipboard as Clipboard | undefined;
  if (!nav) {
    setRow('clipboard', 'Urklipp (klick)', 'fel', 'navigator.clipboard saknas, markera texten i rutan och kopiera för hand');
    return;
  }
  nav.writeText(text).then(
    () => setRow('clipboard', 'Urklipp (klick)', 'ok', 'tabellen kopierades'),
    (err: unknown) => setRow('clipboard', 'Urklipp (klick)', 'fel', `${String(err)} (markera texten i rutan och kopiera för hand)`),
  );
});

async function main(): Promise<void> {
  setRow('hash', 'location.hash', 'ok', JSON.stringify(location.hash));
  setRow('search', 'location.search', 'ok', JSON.stringify(location.search));
  setRow('root', 'Sidans rot (ROOT_URL)', 'ok', ROOT_URL);
  setRow('gl', 'WebGL2', 'ej testat', 'provar...');
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    setRow('gl', 'WebGL2', gl ? 'ok' : 'fel', gl ? 'fungerar' : 'saknas');
  } catch (err) {
    setRow('gl', 'WebGL2', 'fel', String(err));
  }
  setRow('clipboard', 'Urklipp (klick)', 'ej testat', 'tryck på knappen');
  let expected: Expected | null = null;
  try {
    const res = await fetch(siteUrl('probe/expected.json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    expected = (await res.json()) as Expected;
  } catch (err) {
    const detail = `probe/expected.json saknas (${String(err)}). Kör npm run artifact:pack -- --probe och publicera.`;
    for (const [key, label] of [
      ['png', 'Container .png (rå gzip)'],
      ['wasm', 'Container .wasm (rå gzip)'],
      ['b64', 'Container .txt (base64)'],
    ] as const) {
      setRow(key, label, 'ej testat', detail);
    }
  }
  const tasks: Promise<void>[] = [testWorker()];
  if (expected) {
    tasks.push(
      testContainer('png', 'Container .png (rå gzip)', 'probe/pack.png', 'raw', expected),
      testContainer('wasm', 'Container .wasm (rå gzip)', 'probe/pack.wasm', 'raw', expected),
      testContainer('b64', 'Container .txt (base64)', 'probe/pack.b64.txt', 'b64', expected),
    );
  }
  await Promise.all(tasks);
  document.body.dataset.probeDone = '1';
}

void main();
