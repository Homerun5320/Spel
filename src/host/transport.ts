// LocalTransport: a pair of connected message ports inside one thread. Every message is copied with structuredClone (the
// copy semantics of postMessage) and delivered asynchronously in order, so code that works over this transport also works
// over a Worker's port, and code that shares an object reference across it fails its test instead of working by accident.
import type { Port, Unsubscribe } from './protocol';

class LocalPort<Send, Receive> implements Port<Send, Receive> {
  private handlers: Array<(m: Receive) => void> = [];
  private inbox: Receive[] = [];
  private scheduled = false;
  private closed = false;
  peer: LocalPort<Receive, Send> | null = null;

  constructor(private readonly stats: { copies: number; inFlight: number }) {}

  post(message: Send, transfer: ArrayBuffer[] = []): void {
    if (this.closed || this.peer === null) return;
    const copy = structuredClone(message, { transfer }) as Send;
    this.stats.copies++;
    this.stats.inFlight++;
    (this.peer as unknown as LocalPort<unknown, Send>).receive(copy);
  }

  onMessage(handler: (message: Receive) => void): Unsubscribe {
    this.handlers = [...this.handlers, handler];
    this.schedule();
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  close(): void {
    this.closed = true;
    this.handlers = [];
    this.inbox = [];
  }

  private receive(message: Receive): void {
    if (this.closed) {
      this.stats.inFlight--;
      return;
    }
    this.inbox.push(message);
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || this.inbox.length === 0 || this.handlers.length === 0) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      // Messages that arrive while a handler runs are delivered in a later microtask, never re-entrantly.
      const batch = this.inbox;
      this.inbox = [];
      for (const m of batch) {
        this.stats.inFlight--;
        for (const h of this.handlers) h(m);
      }
      this.schedule();
    });
  }
}

export interface LocalTransport<ClientToHost, HostToClient> {
  /** The end the client (UI, RemoteHost) holds. */
  readonly client: Port<ClientToHost, HostToClient>;
  /** The end the host (HostServer) holds. */
  readonly host: Port<HostToClient, ClientToHost>;
  /** Resolves when no message is in flight in either direction. */
  idle(): Promise<void>;
  /** Number of messages copied so far. */
  readonly copies: number;
}

export function createLocalTransport<ClientToHost, HostToClient>(): LocalTransport<ClientToHost, HostToClient> {
  const stats = { copies: 0, inFlight: 0 };
  const client = new LocalPort<ClientToHost, HostToClient>(stats);
  const host = new LocalPort<HostToClient, ClientToHost>(stats);
  client.peer = host;
  host.peer = client;
  return {
    client,
    host,
    get copies() {
      return stats.copies;
    },
    async idle() {
      // Each round trip needs at most a few microtasks; loop until nothing is in flight.
      for (let i = 0; i < 1000 && stats.inFlight > 0; i++) await Promise.resolve();
    },
  };
}
