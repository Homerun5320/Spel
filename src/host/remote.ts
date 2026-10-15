// HostServer and RemoteHost: the two halves of a SimHost split over a Port. HostServer sits next to the real host and
// translates messages into SimHost calls; RemoteHost sits next to the UI and implements SimHost by sending messages.
// Together with LocalTransport this is the whole Worker design of M24a; only the port changes then.
import { copyBody } from '../sim/intents';
import {
  cloneEvent,
  isSpeed,
  type ClientMessage,
  type HostEvent,
  type HostListener,
  type HostMessage,
  type Port,
  type SimHost,
  type Snapshot,
  type Speed,
  type Unsubscribe,
  type ViewSnapshot,
} from './protocol';
import type { IntentBody } from '../sim/intents';

function transferablesOf(event: HostEvent): ArrayBuffer[] {
  if (event.type !== 'diff') return [];
  const list = [event.diff.cells.buffer as ArrayBuffer, event.diff.owners.buffer as ArrayBuffer];
  if (event.diff.fullOwner !== null) list.push(event.diff.fullOwner.buffer as ArrayBuffer);
  list.push(...viewBuffers(event.diff.view));
  return list;
}

function viewBuffers(v: ViewSnapshot): ArrayBuffer[] {
  const list = [v.stats.buffer as ArrayBuffer, v.attacks.buffer as ArrayBuffer, v.match.buffer as ArrayBuffer];
  if (v.owner !== null) list.push(v.owner.buffer as ArrayBuffer);
  if (v.terrain !== null) list.push(v.terrain.buffer as ArrayBuffer);
  const st = v.structures;
  if (st !== null) {
    list.push(st.type.buffer as ArrayBuffer, st.owner.buffer as ArrayBuffer, st.cell.buffer as ArrayBuffer, st.level.buffer as ArrayBuffer);
    list.push(st.buildTick.buffer as ArrayBuffer, st.readyTick.buffer as ArrayBuffer, st.upgradeReadyTick.buffer as ArrayBuffer, st.deleteReady.buffer as ArrayBuffer, st.counts.buffer as ArrayBuffer);
    list.push(st.districtKind.buffer as ArrayBuffer, st.districtLevel.buffer as ArrayBuffer, st.districtReadyTick.buffer as ArrayBuffer, st.districtUpgradeReadyTick.buffer as ArrayBuffer, st.districtCounts.buffer as ArrayBuffer);
  }
  return list;
}

/** Serves `host` on `port`. Malformed messages are ignored (the port is a trust boundary). Returns a function that stops serving. */
export function serveHost(host: SimHost, port: Port<HostMessage, ClientMessage>): () => void {
  const stopEvents = host.subscribe((event) => port.post({ type: 'event', event }, transferablesOf(event)));
  const stopMessages = port.onMessage((m) => {
    if (typeof m !== 'object' || m === null) return;
    switch (m.type) {
      case 'submit':
        host.submitIntent(copyBody(m.body));
        break;
      case 'speed':
        if (isSpeed(m.speed)) host.setSpeed(m.speed);
        break;
      case 'advance':
        if (typeof m.dtMs === 'number') host.advance(m.dtMs);
        break;
      case 'snapshot': {
        const requestId = m.requestId;
        if (typeof requestId !== 'number') break;
        host.requestSnapshot().then(
          (snapshot) => port.post({ type: 'snapshot', requestId, snapshot }, [snapshot.bytes.buffer as ArrayBuffer]),
          (err: unknown) => port.post({ type: 'error', message: String(err) }),
        );
        break;
      }
      case 'view': {
        const requestId = m.requestId;
        if (typeof requestId !== 'number') break;
        host.requestView().then(
          (view) => port.post({ type: 'view', requestId, view }, viewBuffers(view)),
          (err: unknown) => port.post({ type: 'error', message: String(err) }),
        );
        break;
      }
      case 'dispose':
        host.dispose();
        break;
      default:
        break;
    }
  });
  return () => {
    stopEvents();
    stopMessages();
  };
}

/** A SimHost that talks to a served host over a port. */
export class RemoteHost implements SimHost {
  private listeners: HostListener[] = [];
  private readonly requests = new Map<number, { resolve: (s: Snapshot) => void; reject: (e: Error) => void }>();
  private readonly viewRequests = new Map<number, { resolve: (v: ViewSnapshot) => void; reject: (e: Error) => void }>();
  private nextRequest = 1;
  private readonly stop: Unsubscribe;
  /** The last error message the host sent, if any. */
  lastError: string | null = null;

  constructor(private readonly port: Port<ClientMessage, HostMessage>) {
    this.stop = port.onMessage((m) => {
      if (m.type === 'event') {
        for (const l of this.listeners) {
          try {
            l(cloneEvent(m.event));
          } catch (err) {
            console.error('[sim host] listener threw', err);
          }
        }
      } else if (m.type === 'snapshot') {
        const r = this.requests.get(m.requestId);
        if (r !== undefined) {
          this.requests.delete(m.requestId);
          r.resolve(m.snapshot);
        }
      } else if (m.type === 'view') {
        const r = this.viewRequests.get(m.requestId);
        if (r !== undefined) {
          this.viewRequests.delete(m.requestId);
          r.resolve(m.view);
        }
      } else if (m.type === 'error') {
        this.lastError = m.message;
      }
    });
  }

  submitIntent(body: IntentBody): void {
    this.port.post({ type: 'submit', body: copyBody(body) });
  }

  setSpeed(speed: Speed): void {
    this.port.post({ type: 'speed', speed });
  }

  advance(dtMs: number): void {
    this.port.post({ type: 'advance', dtMs });
  }

  subscribe(listener: HostListener): Unsubscribe {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  requestSnapshot(): Promise<Snapshot> {
    const requestId = this.nextRequest++;
    return new Promise<Snapshot>((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject });
      this.port.post({ type: 'snapshot', requestId });
    });
  }

  requestView(): Promise<ViewSnapshot> {
    const requestId = this.nextRequest++;
    return new Promise<ViewSnapshot>((resolve, reject) => {
      this.viewRequests.set(requestId, { resolve, reject });
      this.port.post({ type: 'view', requestId });
    });
  }

  dispose(): void {
    this.port.post({ type: 'dispose' });
    this.stop();
    this.listeners = [];
    for (const r of this.requests.values()) r.reject(new Error('host disposed'));
    for (const r of this.viewRequests.values()) r.reject(new Error('host disposed'));
    this.requests.clear();
    this.viewRequests.clear();
  }
}
