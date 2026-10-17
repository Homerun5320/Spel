// showReport(json): shows a JSON report in a selectable textarea with a Download link. The clipboard is tried FIRST and
// synchronously: call it from inside the click handler (a clipboard write needs a user gesture). Downloads can be inert
// in an Artifact (page-initiated downloads are blocked), so the textarea is the real fallback.

export interface ReportHandle {
  /** The modal element (removed by `close`). */
  element: HTMLElement;
  /** Resolves true when the clipboard accepted the text, false when it refused or does not exist. */
  copied: Promise<boolean>;
  close(): void;
}

let current: ReportHandle | null = null;

export function reportText(json: unknown): string {
  return typeof json === 'string' ? json : JSON.stringify(json, null, 2);
}

export function showReport(json: unknown, opts: { title?: string; filename?: string; parent?: HTMLElement } = {}): ReportHandle {
  current?.close();
  const text = reportText(json);
  const parent = opts.parent ?? document.body;

  // The clipboard first, inside the caller's click handler (no await before this line).
  let copied: Promise<boolean>;
  try {
    copied = navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false);
  } catch {
    copied = Promise.resolve(false);
  }

  const box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.dataset.report = '1';
  box.style.cssText =
    'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);' +
    'font:14px system-ui,sans-serif;color:#e8f0ff;';
  const card = document.createElement('div');
  card.style.cssText =
    'box-sizing:border-box;width:min(640px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;gap:8px;' +
    'padding:12px;border-radius:8px;background:#0e1626;border:1px solid #2a3d63;';
  const title = document.createElement('div');
  title.textContent = opts.title ?? 'Rapport';
  title.style.cssText = 'font-weight:600;';
  const status = document.createElement('div');
  status.dataset.reportStatus = '1';
  status.style.cssText = 'font-size:13px;color:#9bd;min-height:18px;';
  status.textContent = 'Försöker kopiera till urklipp...';
  const area = document.createElement('textarea');
  area.readOnly = true;
  area.value = text;
  area.spellcheck = false;
  area.style.cssText =
    'box-sizing:border-box;width:100%;height:min(360px,50vh);resize:vertical;background:#070c16;color:#cfe;border:1px solid #2a3d63;' +
    'border-radius:4px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:6px;';
  area.addEventListener('focus', () => area.select());

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  const btn = 'padding:10px 14px;border-radius:6px;border:1px solid #3a5a9a;background:#16294a;color:#e8f0ff;font:14px system-ui,sans-serif;text-decoration:none;cursor:pointer;';

  const download = document.createElement('a');
  const blobUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  download.href = blobUrl;
  download.download = opts.filename ?? 'rapport.json';
  download.textContent = 'Ladda ner';
  download.dataset.reportDownload = '1';
  download.style.cssText = btn;

  const select = document.createElement('button');
  select.type = 'button';
  select.textContent = 'Markera allt';
  select.style.cssText = btn;
  select.addEventListener('click', () => {
    area.focus();
    area.select();
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Stäng';
  closeBtn.style.cssText = btn;

  row.append(download, select, closeBtn);
  card.append(title, status, area, row);
  box.appendChild(card);
  parent.appendChild(box);

  const close = (): void => {
    box.remove();
    URL.revokeObjectURL(blobUrl);
    if (current === handle) current = null;
  };
  closeBtn.addEventListener('click', close);
  box.addEventListener('click', (e) => {
    if (e.target === box) close();
  });

  const handle: ReportHandle = { element: box, copied, close };
  current = handle;
  void copied.then((ok) => {
    status.textContent = ok
      ? 'Kopierat till urklipp. Texten nedan är samma rapport.'
      : 'Urklipp nekades: markera texten i rutan nedan och kopiera den för hand (Markera allt).';
  });
  return handle;
}
