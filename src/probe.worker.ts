// Module worker of the probe page: proves that a worker started from our own file runs and that siteUrl()
// resolves correctly inside a worker (it fetches probe/expected.json through it).
import { ROOT_URL, siteUrl } from './app/paths';

interface ProbeRequest {
  ping: number;
}

self.addEventListener('message', (event: MessageEvent<ProbeRequest>) => {
  void (async () => {
    try {
      const res = await fetch(siteUrl('probe/expected.json'));
      const expected: unknown = res.ok ? await res.json() : null;
      self.postMessage({ ok: true, pong: event.data.ping, rootUrl: ROOT_URL, status: res.status, expected });
    } catch (err) {
      self.postMessage({ ok: false, error: String(err) });
    }
  })();
});
