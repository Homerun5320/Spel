// The ship controller (M13c-2): the page-side glue of the ship mode, kept out of globeApp.ts. It owns the mode on the input stack, the picked cell, the preview of it (the sim's own check
// and route, src/app/shipPreview.ts), the marker and the route line on the deploy layer (no draw call of its own) and the model of the ship box. It reads the match only through a
// `ShipHost` the page hands in, so a unit test drives it with synthetic events. It holds no rule: LaunchShip is checked by the sim.
import { STRUCT_PORT, launchShipBody, type SimView } from '../sim/public';
import { SHIP } from '../ui/uiConfig';
import type { ShipBox, ShipBoxModel } from '../ui/shipBox';
import { shipPanelInfo } from '../ui/shipInfo';
import { rejectKey } from '../ui/hudLogic';
import type { TextKey } from '../ui/i18n';
import type { InputStack } from './input';
import { previewShip, type ShipPreview } from './shipPreview';
import { createShipMode, type ShipMode } from './shipMode';

/** The part of the `MatchSession` the controller reads (the page hands the session itself in: nothing is built per frame). */
export interface ShipMatch {
  readonly view: SimView;
  readonly localSeat: number;
  readonly localOwner: number;
  submit(body: ReturnType<typeof launchShipBody>): void;
}

/** What the controller needs of the page. */
export interface ShipHost {
  /** The match as a read-only view with the local seat, or null when none is on. */
  match(): ShipMatch | null;
  stack: InputStack;
  pickCell(x: number, y: number): number | null;
  cameraMoved(): boolean;
  /** The deploy layer's route line and landing marker (state 0 waiting, 1 valid, 2 refused; cell -1 hides it). */
  setRoute(cells: readonly number[] | null, liftM: number): void;
  setMarker(cell: number, state: 0 | 1 | 2): void;
  toast(key: TextKey, params: Record<string, string | number>, kind: 'info' | 'warn' | 'error'): void;
  /** Leaves the other modes that use the same layer and the panel (placement, deploy). */
  exitOthers(): void;
}

export interface ShipControllerInfo {
  active: boolean;
  port: number;
  hover: number;
  pinned: number;
  /** The preview's verdict for the pinned cell (-1 = none yet), its route length in points and sailing time. */
  reason: number;
  routePoints: number;
  etaSeconds: number;
  markerState: number;
}

export interface ShipController {
  /** Starts the mode for Port `port` (a refused start shows the reason as a toast). */
  enter(port: number): void;
  exit(): void;
  /** The key / button: starts the mode for the selected Port, or leaves it when it is on. */
  toggle(port: number): void;
  isActive(): boolean;
  /** Once per frame while a match is on: keeps the mode honest (the Port lost ends it), the marker and the route. */
  frame(): void;
  /** Once per frame while an own Port is selected: fills the box's model and updates it. */
  boxFrame(port: number): void;
  /** Sends LaunchShip for the pinned cell with the slider's troops when the preview is valid. Returns true when it was sent. */
  confirm(): boolean;
  info(): ShipControllerInfo;
}

export function createShipController(host: ShipHost, getBox: () => ShipBox | null): ShipController {
  let mode: ShipMode | null = null;
  let port = -1;
  let hover = -1;
  let pinned = -1;
  let preview: ShipPreview | null = null;
  let previewTroops = -1;
  let drawnPreview: ShipPreview | null = null;
  let markerCell = -2;
  let markerState = -1;
  const model = { reason: 0, price: 0, fleet: 0, cap: 0, active: false, status: 'idle', previewReason: 0, etaSeconds: 0, maxTroops: 0 } as { -readonly [K in keyof ShipBoxModel]: ShipBoxModel[K] };

  const clear = (): void => {
    mode = null;
    port = -1;
    hover = -1;
    pinned = -1;
    preview = null;
    previewTroops = -1;
    drawnPreview = null;
    markerCell = -2;
    markerState = -1;
    host.setRoute(null, 0);
    host.setMarker(-1, 0);
  };

  const exit = (): void => {
    if (mode !== null && host.stack.top === mode) host.stack.pop();
    else if (mode !== null) clear();
  };

  const enter = (p: number): void => {
    const m = host.match();
    if (m === null) return;
    const s = m.view.structures;
    if (p < 0 || p >= s.highWater || s.type[p] !== STRUCT_PORT || s.owner[p] !== m.localOwner) {
      host.toast('reject.ship.noPort', {}, 'error');
      return;
    }
    const why = shipPanelInfo(m.view, m.localSeat, p).reason;
    if (why !== 0) {
      host.toast(rejectKey(why), { code: why }, 'error');
      return;
    }
    if (mode !== null) {
      if (port === p) return;
      exit();
    }
    host.exitOthers();
    port = p;
    hover = -1;
    pinned = -1;
    preview = null;
    const next = createShipMode(p, {
      pickCell: host.pickCell,
      cameraMoved: host.cameraMoved,
      hover: (c) => {
        hover = c === null ? -1 : c;
      },
      pin: (c) => {
        pinned = c;
        preview = null; // asked again in the next frame with the slider's troops
      },
      exit,
      ended: clear,
    });
    mode = next;
    host.stack.push(next);
  };

  const ask = (m: ShipMatch, box: ShipBox | null): void => {
    if (pinned < 0) {
      preview = null;
      return;
    }
    const troops = box === null ? SHIP.troopsDefault : box.troops();
    if (preview !== null && preview.cell === pinned && previewTroops === troops) return;
    previewTroops = troops;
    preview = previewShip(m.view, m.localSeat, port, pinned, troops);
  };

  return {
    enter,
    exit,
    toggle: (p) => (mode !== null ? exit() : enter(p)),
    isActive: () => mode !== null,
    frame(): void {
      if (mode === null) return;
      const m = host.match();
      const s = m?.view.structures;
      if (m === null || s === undefined || port >= s.highWater || s.type[port] !== STRUCT_PORT || s.owner[port] !== m.localOwner) {
        exit(); // the Port was lost
        return;
      }
      ask(m, getBox());
      const state: 0 | 1 | 2 = pinned < 0 || preview === null ? 0 : preview.reason === 0 ? 1 : 2;
      const cell = pinned >= 0 ? pinned : hover;
      if (cell !== markerCell || state !== markerState) {
        markerCell = cell;
        markerState = state;
        host.setMarker(cell, state);
      }
      if (preview !== drawnPreview) {
        drawnPreview = preview;
        const wp = preview === null ? null : preview.waypoints;
        if (wp === null || preview === null) host.setRoute(null, 0);
        else host.setRoute(wp[wp.length - 1] === preview.cell ? wp : [...wp, preview.cell], SHIP.routeLiftM);
      }
    },
    boxFrame(p: number): void {
      const box = getBox();
      const m = host.match();
      if (box === null || m === null) return;
      const info = shipPanelInfo(m.view, m.localSeat, p);
      model.reason = info.reason;
      model.price = info.price;
      model.fleet = info.fleet;
      model.cap = info.cap;
      model.maxTroops = info.maxTroops;
      model.active = mode !== null;
      const cur = mode !== null && pinned >= 0 ? preview : null;
      model.status = cur === null ? 'idle' : cur.reason === 0 ? 'valid' : 'invalid';
      model.previewReason = cur === null ? 0 : cur.reason;
      model.etaSeconds = cur === null ? 0 : cur.etaSeconds;
      box.update(model);
    },
    confirm(): boolean {
      const m = host.match();
      const box = getBox();
      if (mode === null || m === null || box === null || pinned < 0) return false;
      ask(m, box);
      if (preview === null || preview.reason !== 0) return false;
      m.submit(launchShipBody(m.localSeat, port, pinned, box.troops()));
      exit();
      return true;
    },
    info: () => ({
      active: mode !== null,
      port,
      hover,
      pinned,
      reason: preview === null ? -1 : preview.reason,
      routePoints: preview === null || preview.waypoints === null ? 0 : preview.waypoints.length,
      etaSeconds: preview === null ? 0 : preview.etaSeconds,
      markerState,
    }),
  };
}
