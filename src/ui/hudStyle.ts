// The style sheet of the match HUD and the start screen, built from the tokens in uiConfig.ts. One <style> element per root; the
// classes are prefixed `hud-` / `start-`. No transitions or animations (CSS time is not the fx clock; tests/fxClock.test.ts
// forbids them): every visible change is a state change driven from JS.
import { BOARD_RESERVE_BOTTOM_EM, NARROW_BAR_ROWS, NARROW_HINT_EM, BUILD_BAR_TWO_ROWS_MIN_PX, CITY_VIEW, GPU_TIP, HELP_OVERLAY, MATCH_PANELS, NARROW_MAX_PX, TOPBAR, HUD_FONT_BIAS_PX, HUD_FONT_MAX_PX, HUD_FONT_MIN_PX, HUD_FONT_VW, SETUP_PANEL_EM, SETUP_SHEET_VH, TARGET_MIN_PX, DIPLO, FED_BOARD, TECH_UI, UI_COLORS as C, Z_HUD, Z_SETUP, Z_START_SCREEN } from './uiConfig';

export function hudCss(): string {
  const fontSize = `clamp(${HUD_FONT_MIN_PX}px, calc(${HUD_FONT_VW}vw + ${HUD_FONT_BIAS_PX}px), ${HUD_FONT_MAX_PX}px)`;
  const target = `${TARGET_MIN_PX}px`;
  return `
.hud-root, .start-root, .setup-root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.3; color: ${C.text}; box-sizing: border-box; -webkit-font-smoothing: antialiased; }
.hud-root *, .start-root *, .setup-root * { box-sizing: border-box; }
.hud-root [hidden], .start-root [hidden], .setup-root [hidden], .start-root[hidden], .setup-root[hidden] { display: none !important; }
.hud-root { position: absolute; inset: 0; z-index: ${Z_HUD}; pointer-events: none; user-select: none; -webkit-user-select: none; }
.hud-panel { pointer-events: auto; background: ${C.panel}; border: 1px solid ${C.panelBorder}; border-radius: 0.6em; box-shadow: 0 0.15em 0.7em rgba(0, 0, 0, 0.5); padding: 0.5em 0.8em; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.hud-label, .hud-win-label { color: ${C.textDim}; font-size: 0.85em; letter-spacing: 0.02em; }
.hud-num { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 1.25em; }
.hud-dim { color: ${C.textDim}; font-variant-numeric: tabular-nums; }

.hud-banner { position: absolute; left: 50%; top: ${TOPBAR.wideEm + 0.4}em; transform: translateX(-50%); width: max-content; max-width: min(34em, calc(100vw - 33em)); display: flex; align-items: center; gap: 0.8em; text-align: left; padding: 0.35em 1em; } /* M20a-lite: one row (text, countdown), so it stays clear of the middle of the globe where a spawn click lands */
.hud-root:has(.hud-board[data-labels="1"]) .hud-banner { max-width: min(34em, calc(100vw - 37em)); } /* Fix-6B: the wide federation board (17.5em) starts left of where the centred banner ended at 960 px */
.hud-banner[data-tone="prompt"] { border-color: ${C.accent}; }
.hud-banner[data-tone="missed"] { border-color: ${C.danger}; }
.hud-banner-text { font-weight: 600; font-size: 1.05em; }
.hud-banner-seconds { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 1.6em; line-height: 1.1; color: ${C.accent}; flex: none; }
.hud-badge { position: absolute; left: 50%; top: ${TOPBAR.wideEm + 3.5}em; transform: translateX(-50%); padding: 0.2em 0.9em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.barWarning}; pointer-events: none; }

.hud-board { position: absolute; right: 0.6em; top: ${TOPBAR.wideEm + 0.4}em; width: 14.5em; padding: 0.45em 0.6em 0.5em; max-height: calc(100% - ${TOPBAR.wideEm + 0.4 + BOARD_RESERVE_BOTTOM_EM}em); overflow-y: auto; overflow-x: hidden; }
.hud-board[data-labels="1"] { width: 17.5em; }
.hud-board-title { color: ${C.textDim}; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.2em; }
.hud-row { display: grid; grid-template-columns: 1.6em 0.9em minmax(0, 1fr) auto auto; align-items: center; column-gap: 0.4em; min-height: 1.7em; padding: 0 0.3em; border-radius: 0.3em; }
.hud-row[data-you="1"] { background: ${C.youRow}; font-weight: 700; }
.hud-row[data-group="1"] { cursor: pointer; border-left: 3px solid ${FED_BOARD.accent}; }
.hud-row[data-group="1"]:hover { background: rgba(255, 255, 255, 0.07); }
.hud-row[data-sub="1"] { padding-left: ${FED_BOARD.subIndentEm}em; font-size: 0.92em; opacity: 0.9; }
.mp-table tr[data-group="1"] td { border-top: 2px solid ${FED_BOARD.accent}; font-weight: 700; }
.mp-table tr[data-sub="1"] td { font-size: 0.92em; opacity: 0.9; }
.mp-table tr[data-sub="1"] td.mp-name { padding-left: ${FED_BOARD.subIndentEm}em; }
.hud-row[data-group="1"] .hud-rels { display: none; }
.mp-subtitle { margin: 0.7em 0 0.3em; font-size: 0.95em; color: ${C.textDim}; }
.mp-flag { flex: none; display: block; border-radius: 2px; border: 1px solid rgba(255, 255, 255, 0.55); }
.hud-rank { color: ${C.textDim}; text-align: right; font-variant-numeric: tabular-nums; }
.hud-swatch { width: 0.9em; height: 0.9em; border-radius: 0.2em; border: 1px solid rgba(255, 255, 255, 0.7); }
.hud-row[data-flag="1"] { grid-template-columns: 1.6em 0.9em auto minmax(0, 1fr) auto auto; }
.hud-rels { display: inline-flex; gap: 0.15em; }
.hud-rel { font-size: 0.75em; font-weight: 800; line-height: 1.3; padding: 0 0.3em; border-radius: 0.3em; border: 1px solid currentColor; }
.hud-rel[hidden] { display: none !important; }
.hud-diplo { display: inline-flex; align-items: center; gap: 0.4em; flex: none; margin-left: auto; } /* never shrinks below its buttons (Teknik + Diplomati): the win text beside it is the part that is cut */
.hud-diplo .hud-btn { position: relative; min-width: 0; min-height: 0; height: 1.4em; padding: 0 0.6em; line-height: 1; font-size: 0.95em; } /* the row keeps its 1.4em; the touch target (TARGET_MIN_PX) is the invisible ::after */
.hud-diplo .hud-btn::after { content: ''; position: absolute; left: -0.3em; right: -0.3em; top: calc(50% - ${TARGET_MIN_PX / 2}px); height: ${TARGET_MIN_PX}px; }
.hud-beach { color: ${C.barWarning}; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.hud-diplo-signal { color: ${C.barWarning}; font-weight: 800; white-space: nowrap; }
.hud-row2 > .hud-diplo { margin-left: auto; }
.hud-flag { border-radius: 2px; border: 1px solid rgba(255, 255, 255, 0.55); display: block; }
.hud-flag[hidden] { display: none !important; }
.hud-nation { display: flex; align-items: center; gap: 0.5em; font-weight: 700; max-width: 12em; }
.hud-nation[hidden] { display: none !important; }
.hud-nation-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-name { min-width: 4.4em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-share { font-variant-numeric: tabular-nums; white-space: nowrap; } /* Fix-6B: "0,53 %" never wraps */
.hud-empty { color: ${C.textDim}; font-size: 0.9em; padding: 0.2em 0.3em; }

.hud-dock { position: absolute; left: 0.6em; right: 0.6em; bottom: 0.6em; display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 0.6em; pointer-events: none; }
.hud-status { position: absolute; left: 0.6em; top: 0.6em; max-width: calc(100% - 1.2em - 56px); display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 1.2em; row-gap: 0.1em; padding: 0.3em 0.8em 0.35em; pointer-events: auto; }
.hud-grp { display: inline-flex; align-items: baseline; gap: 0.4em; white-space: nowrap; }
.hud-grp-troops { flex-direction: column; align-items: stretch; gap: 0.05em; min-width: 11em; }
.hud-line { display: flex; align-items: baseline; gap: 0.4em; white-space: nowrap; }
.hud-bar-row { display: flex; align-items: center; gap: 0.5em; min-height: 1.15em; }
.hud-bar-row .hud-bar { flex: 1 1 auto; margin: 0; }
.hud-row2 { flex: 1 1 100%; display: flex; align-items: center; gap: 0.8em; min-width: 0; }
.hud-row2 > .hud-grp { flex: none; margin-left: auto; align-items: center; min-height: 1.4em; }
.hud-row2 .hud-num { font-size: 1em; }
.hud-win { flex: 1 1 auto; display: flex; align-items: center; gap: 0.6em; min-height: 1.4em; min-width: 0; }
.hud-win .hud-bar { flex: 1 1 8em; min-width: 3em; margin: 0; }
.hud-win-text, .hud-win-hold { font-variant-numeric: tabular-nums; white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; } /* the figures come first, so a long nation name is the part that is cut */
.hud-win-hold { color: ${C.barWarning}; font-weight: 700; }
.hud-gold { color: ${C.gold}; }
.hud-troops { color: ${C.troops}; }
.hud-bar { position: relative; height: 0.75em; margin: 0.25em 0 0.2em; border-radius: 0.4em; background: ${C.barTrack}; overflow: hidden; border: 1px solid ${C.panelBorder}; }
.hud-bar-fill { position: absolute; inset: 0; transform-origin: left center; background: ${C.bar}; }
.hud-bar[data-warning="1"] .hud-bar-fill { background: ${C.barWarning}; }
.hud-bar-mark { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(255, 255, 255, 0.85); }
.hud-warn { color: ${C.barWarning}; font-weight: 700; font-size: 0.8em; white-space: nowrap; }

.hud-controls { margin-left: auto; display: flex; flex-direction: column; gap: 0.45em; width: 19.5em; max-width: calc(100vw - 1.2em); }
.hud-group { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; }
.hud-btns { display: flex; gap: 0.3em; }
.hud-btn { min-width: ${target}; min-height: ${target}; padding: 0 0.7em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.hud-btn:hover { background: ${C.buttonActive}; }
.hud-btn[aria-pressed="true"] { background: ${C.buttonActive}; border-color: ${C.accent}; box-shadow: inset 0 0 0 1px ${C.accent}; }
.hud-btn:focus-visible, .hud-slider:focus-visible, .start-btn:focus-visible, .setup-input:focus-visible, .setup-tab:focus-visible, .setup-row:focus-visible, .setup-swatch:focus-visible, .setup-range:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.hud-commit-line { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; }
.hud-slider { width: 100%; min-height: ${target}; margin: 0; accent-color: ${C.accent}; cursor: pointer; }

.hud-toast { position: absolute; left: 50%; bottom: 11em; transform: translateX(-50%); width: max-content; max-width: min(30em, calc(100vw - 2em)); text-align: center; padding: 0.45em 1em; pointer-events: none; border-color: ${C.danger}; }

.build-wrap { position: absolute; left: 50%; bottom: 0.6em; transform: translateX(-50%); display: flex; flex-direction: column-reverse; align-items: center; gap: 0.4em; pointer-events: none; }
.build-bar { display: flex; align-items: center; gap: 0.4em; padding: 0.3em; pointer-events: auto; }
.build-bar[hidden], .build-hint[hidden] { display: none !important; }
.build-bar { display: grid; grid-template-columns: repeat(3, max-content); gap: 0.4em; max-width: calc(100vw - 1em); width: max-content; } /* Fix-UI: three columns of full names (key and name on the first line, the price under the name) */
.build-btn { min-width: ${target}; min-height: ${target}; padding: 0.15em 0.7em; display: grid; grid-template-columns: auto auto; column-gap: 0.45em; align-items: baseline; justify-content: start; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.build-name { white-space: nowrap; }
.build-price { grid-column: 2; }
.build-btn:hover { background: ${C.buttonActive}; }
.build-btn[data-active="1"] { background: ${C.buttonActive}; border-color: ${C.accent}; box-shadow: inset 0 0 0 1px ${C.accent}; }
.build-btn[data-state="poor"] { opacity: 0.55; border-color: ${C.panelBorder}; }
.build-key { color: ${C.textDim}; font-size: 0.8em; }
.build-price { color: ${C.gold}; font-variant-numeric: tabular-nums; }
.build-btn[data-state="locked"] { opacity: 0.45; border-style: dashed; }
@media (max-width: 1100px) { .build-btn { padding: 0.1em 0.4em; column-gap: 0.3em; } .build-name { font-size: 0.85em; } .build-bar { gap: 0.3em; } .build-wrap { left: calc(50% - 0.9em); } } /* M18e-1 integration: a little tighter and a little to the left, so the nine buttons keep clear of the controls panel at 960 px (the English names are the widest: 340 px against 332 free) */
@media (min-width: ${BUILD_BAR_TWO_ROWS_MIN_PX}px) and (min-aspect-ratio: 1/1) { .build-bar { grid-template-columns: repeat(5, max-content); } } /* nine buttons in two rows where the bar still fits beside the controls panel; below that three rows */
.build-hint { width: max-content; max-width: min(20em, calc(100vw - 2em)); text-align: center; padding: 0.35em 0.9em; pointer-events: none; font-size: 0.9em; }
.toast-stack { position: absolute; left: 50%; bottom: 17em; transform: translateX(-50%); display: flex; flex-direction: column; gap: 0.35em; align-items: center; z-index: ${Z_HUD + 1}; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: ${fontSize}; }
.toast { width: max-content; max-width: min(30em, calc(100vw - 2em)); text-align: center; padding: 0.45em 1em; border-radius: 0.6em; background: ${C.panel}; color: ${C.text}; border: 1px solid ${C.panelBorder}; box-shadow: 0 0.15em 0.7em rgba(0, 0, 0, 0.5); }
.toast[data-kind="error"] { border-color: ${C.danger}; }
.toast[data-kind="warn"] { border-color: ${C.barWarning}; }
/* M10-4: the selection panel sits bottom left above the status panel and wraps on a narrow window. */
.sel-panel { position: absolute; left: 0.6em; bottom: 0.6em; width: 17.5em; max-width: calc(100vw - 1.2em); padding: 0.45em 0.6em 0.5em; display: flex; flex-direction: column; gap: 0.25em; pointer-events: auto; }
.sel-panel[hidden] { display: none !important; }
.sel-panel { max-height: calc(100% - 0.6em - var(--diplo-stack-em, 0.6em)); overflow-y: auto; } /* M13b: the deploy block makes the Factory panel tall; a short window scrolls it instead of cutting the top off */
.sel-name { font-weight: 800; font-size: 1.05em; }
.sel-level, .sel-note { color: ${C.textDim}; font-size: 0.85em; }
.sel-state { color: ${C.barWarning}; font-size: 0.85em; }
.sel-fx { font-size: 0.9em; }
.sel-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.4em; margin-top: 0.2em; }
.sel-btn[data-armed="1"] { border-color: ${C.danger}; box-shadow: inset 0 0 0 1px ${C.danger}; }
.sel-btn { min-height: ${target}; padding: 0 0.8em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.sel-btn:hover { background: ${C.buttonActive}; }
.sel-btn[data-state="dim"] { opacity: 0.5; border-style: dashed; cursor: not-allowed; }
.sel-heli { display: flex; flex-direction: column; gap: 0.2em; margin-top: 0.3em; }
.sel-heli[hidden] { display: none !important; }
.sel-heli-fleet[data-full="1"] { color: ${C.barWarning}; }
/* M13b: while the deploy mode is on the panel shows only the deploy block (a short window cannot hold both) */
.sel-panel[data-deploying="1"] .sel-fx, .sel-panel[data-deploying="1"] .sel-row, .sel-panel[data-deploying="1"] > .sel-note, .sel-panel[data-deploying="1"] .sel-heli > .sel-btn, .sel-panel[data-deploying="1"] .sel-heli > .sel-state, .sel-panel[data-deploying="1"] .sel-heli > .sel-note { display: none; }
/* M13b: the deploy block and the helicopter list inside the Factory panel */
.sel-ship-block[hidden] { display: none !important; }
.ship-box { display: flex; flex-direction: column; gap: 0.3em; margin-top: 0.3em; }
.ship-box [hidden] { display: none !important; }
.sel-ship[data-active="1"] { box-shadow: inset 0 0 0 1px ${C.accent}; }
.sel-panel[data-shipping="1"] .sel-fx, .sel-panel[data-shipping="1"] .sel-row, .sel-panel[data-shipping="1"] > .sel-note, .sel-panel[data-shipping="1"] .ship-box > .sel-note { display: none; }
.deploy-box { display: flex; flex-direction: column; gap: 0.3em; margin-top: 0.3em; }
.deploy-controls { display: flex; flex-direction: column; gap: 0.25em; }
.deploy-controls[hidden], .heli-list[hidden], .deploy-status[hidden], .deploy-box [hidden] { display: none !important; }
.deploy-slider { width: 100%; min-height: ${target}; accent-color: ${C.accent}; }
.deploy-mode { display: flex; gap: 0.3em; }
.deploy-mode .sel-btn { flex: 1; }
.deploy-mode .sel-btn[aria-pressed="true"] { background: ${C.buttonActive}; box-shadow: inset 0 0 0 1px ${C.accent}; }
.deploy-open[data-active="1"] { box-shadow: inset 0 0 0 1px ${C.accent}; }
.deploy-status { font-weight: 700; }
.deploy-status[data-state="valid"] { color: ${C.troops}; }
.deploy-status[data-state="invalid"] { color: ${C.danger}; }
.heli-list { display: flex; flex-direction: column; gap: 0.2em; }
.heli-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; font-size: 0.9em; }
.heli-recall { min-height: 0; padding: 0.15em 0.6em; font-size: 0.9em; }

/* Narrow screens (a phone held upright, D107): the banner takes the whole top row left of the Dev button, with the countdown beside the
   text; the leaderboard sits below it, so nothing overlaps the banner, the board or the Dev button (48 px + 8 px margins). */
@media (max-width: ${NARROW_MAX_PX}px), (max-aspect-ratio: 1/1) {
  .hud-banner { left: 8px; right: 8px; top: ${TOPBAR.narrowEm + 0.4}em; transform: none; width: auto; max-width: none; display: flex; align-items: center; justify-content: space-between; gap: 0.6em; text-align: left; padding: 0.35em 0.7em; }
  .hud-banner-text { font-size: 1em; }
  .hud-banner-seconds { font-size: 1.6em; flex: none; }
  .hud-badge { left: auto; right: 8px; transform: none; top: ${TOPBAR.narrowBoardEm}em; }
  .hud-board { top: ${TOPBAR.narrowBoardEm}em; left: 8px; right: auto; width: 13em; padding: 0.35em 0.5em 0.4em; max-height: calc(100% - ${TOPBAR.narrowBoardEm + BOARD_RESERVE_BOTTOM_EM}em); }
  .hud-board[data-labels="1"] { width: 15.5em; }
  .hud-row { min-height: 1.5em; }
  .hud-name { min-width: 2.4em; } /* Fix-6B: the name gives way (ellipsis) so that the share and the relation badge stay inside the 13 em board */
  .hud-root:has(.hud-board[data-labels="1"]) .hud-banner { max-width: none; }
  .hud-row2 { flex-wrap: wrap; row-gap: 0.15em; } /* Fix-5B: win meter, fleet gauge and the buttons wrap instead of printing over each other */
  .hud-win { flex: 1 1 100%; }
  .hud-toast { bottom: 17em; }
  /* Fix-6B: the nine buttons are a 3 x 3 grid across the whole width above the controls (a column of 110 px clipped every name at 390 px); the hint, the toasts and the selection panel sit above the grid */
  .build-wrap { left: 8px; right: 8px; bottom: 11.5em; transform: none; align-items: center; }
  .build-bar { width: 100%; max-width: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.3em; }
  .build-btn { min-width: 0; padding: 0.1em 0.4em; column-gap: 0.3em; }
  .build-name { font-size: 0.8em; overflow: hidden; text-overflow: ellipsis; }
  .toast-stack { bottom: calc(11.5em + ${NARROW_BAR_ROWS * TARGET_MIN_PX}px + 1.4em + ${NARROW_HINT_EM}em); }
  .sel-panel { left: 8px; bottom: calc(11em + ${NARROW_BAR_ROWS * TARGET_MIN_PX}px + 2.4em); width: auto; max-width: min(17.5em, calc(100vw - 16px)); max-height: calc(100% - 11em - ${NARROW_BAR_ROWS * TARGET_MIN_PX}px - 9em); }
}

.start-root { position: absolute; inset: 0; z-index: ${Z_START_SCREEN}; display: flex; align-items: safe center; justify-content: center; padding: 1em; background: radial-gradient(ellipse at center, ${C.scrim} 0%, ${C.scrimEdge} 100%); overflow: auto; }
.start-card { width: min(34em, 100%); display: flex; flex-direction: column; align-items: center; gap: 0.9em; text-align: center; padding: 1.2em 1.5em 1.1em; background: ${C.card}; border: 1px solid ${C.panelBorder}; border-radius: 1em; box-shadow: 0 0.4em 2em rgba(0, 0, 0, 0.6); }
.start-title { margin: 0; font-size: 2.4em; line-height: 1.1; font-weight: 800; letter-spacing: 0.01em; }
.start-tagline { margin: 0; color: ${C.textDim}; font-size: 1.05em; }
.start-btn { font: inherit; cursor: pointer; touch-action: manipulation; color: ${C.text}; }
.start-play { min-width: 11em; min-height: 3.2em; padding: 0 2em; border-radius: 2em; border: 2px solid ${C.accent}; background: ${C.buttonActive}; font-size: 1.25em; font-weight: 800; }
.start-play:hover:not(:disabled) { background: #3a6cb8; }
.start-play:disabled { cursor: progress; opacity: 0.85; }
.start-help { width: 100%; margin: 0; padding: 0.6em 0.8em; list-style: none; text-align: left; font-size: 0.85em; color: ${C.text}; background: rgba(255, 255, 255, 0.05); border-radius: 0.6em; }
.start-help-title { text-align: left; width: 100%; color: ${C.textDim}; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: -0.7em; }
.start-help li + li { margin-top: 0.3em; }
.start-small { display: flex; gap: 0.6em; }
.start-small .start-btn { min-width: ${target}; min-height: ${target}; padding: 0 1em; border-radius: 0.6em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; font-size: 0.9em; font-weight: 600; }
.start-small .start-btn:hover { background: ${C.buttonActive}; }
.start-choice { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.3em; }
.start-hint { margin: 0; color: ${C.textDim}; font-size: 0.85em; }
.gpu-tip { pointer-events: none; width: 100%; display: flex; flex-direction: row; align-items: flex-end; gap: ${GPU_TIP.gapEm}em; padding: ${GPU_TIP.padEm}em ${GPU_TIP.padEm + 0.2}em; border-radius: ${GPU_TIP.radiusEm}em; border: 1px solid ${GPU_TIP.border}; background: ${GPU_TIP.background}; color: ${GPU_TIP.text}; font-size: ${GPU_TIP.fontEm}em; text-align: left; }
.gpu-tip-body { display: flex; flex-direction: column; gap: ${GPU_TIP.gapEm}em; flex: 1 1 auto; min-width: 0; }
.gpu-tip p { margin: 0; }
.gpu-tip-actions { display: flex; flex: 0 0 auto; gap: ${GPU_TIP.gapEm}em; }
.gpu-tip-extra { display: flex; flex-direction: column; gap: ${GPU_TIP.gapEm}em; }
.gpu-tip-extra[hidden] { display: none; }
.gpu-tip-more, .gpu-tip-close { pointer-events: auto; flex: 0 0 auto; min-height: ${TARGET_MIN_PX}px; min-width: ${TARGET_MIN_PX}px; padding: 0 1em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; cursor: pointer; }
.start-setup { min-width: 11em; min-height: 3.2em; padding: 0 2em; border-radius: 2em; border: 2px solid ${C.buttonBorder}; background: ${C.button}; font-size: 1.25em; font-weight: 800; }
.start-setup:hover { background: ${C.buttonActive}; }

.setup-root { position: absolute; inset: 0; z-index: ${Z_SETUP}; pointer-events: none; }
.setup-panel { pointer-events: auto; position: absolute; left: 0.6em; top: 0.6em; bottom: 0.6em; width: min(${SETUP_PANEL_EM}em, calc(100vw - 1.2em)); display: flex; flex-direction: column; background: rgba(8, 13, 24, 0.93); border: 1px solid ${C.panelBorder}; border-radius: 1em; box-shadow: 0 0.4em 2em rgba(0, 0, 0, 0.6); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.setup-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5em; padding: 0.5em 0.8em; border-bottom: 1px solid ${C.panelBorder}; }
.setup-title { margin: 0; font-size: 1.3em; font-weight: 800; white-space: nowrap; }
.setup-head-btns { display: flex; flex-wrap: wrap; gap: 0.4em; }
.setup-btn { min-width: ${target}; min-height: ${target}; padding: 0 0.9em; border-radius: 0.6em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; font-size: 0.9em; font-weight: 600; }
.setup-btn:hover { background: ${C.buttonActive}; }
.setup-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0.6em 0.8em 0.4em; }
.setup-tabs { display: flex; gap: 0.35em; margin-bottom: 0.5em; }
.setup-tab { flex: 1; min-height: ${target}; font: inherit; font-weight: 700; color: ${C.text}; background: ${C.button}; border: 1px solid ${C.buttonBorder}; border-radius: 0.6em; cursor: pointer; }
.setup-tab[data-active="1"] { background: ${C.buttonActive}; border-color: ${C.accent}; box-shadow: inset 0 0 0 1px ${C.accent}; }
.setup-section { display: flex; flex-direction: column; gap: 0.35em; margin-bottom: 0.7em; }
.setup-subtitle { color: ${C.textDim}; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.2em; padding-top: 0.5em; border-top: 1px solid ${C.panelBorder}; }
.setup-label { color: ${C.textDim}; font-size: 0.85em; margin-top: 0.15em; }
.setup-hint { color: ${C.textDim}; font-size: 0.8em; }
.setup-input { font: inherit; color: ${C.text}; background: ${C.field}; border: 1px solid ${C.buttonBorder}; border-radius: 0.5em; padding: 0 0.6em; min-height: ${target}; width: 100%; }
.setup-input:disabled { opacity: 0.6; }
.setup-input[aria-invalid="true"] { border-color: ${C.danger}; }
.setup-list { max-height: 15em; overflow-y: auto; border: 1px solid ${C.panelBorder}; border-radius: 0.5em; background: ${C.field}; }
.setup-row { display: grid; grid-template-columns: 1fr auto; column-gap: 0.6em; align-items: baseline; width: 100%; min-height: ${target}; padding: 0.3em 0.6em; text-align: left; font: inherit; color: ${C.text}; background: transparent; border: 0; border-bottom: 1px solid rgba(60, 90, 143, 0.35); cursor: pointer; }
.setup-row:hover { background: rgba(127, 209, 255, 0.12); }
.setup-row[data-ok="0"] { color: ${C.textDim}; }
.setup-row[data-selected="1"] { background: ${C.buttonActive}; box-shadow: inset 3px 0 0 ${C.accent}; color: ${C.text}; }
.setup-row-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.setup-row-meta { font-size: 0.8em; color: ${C.textDim}; font-variant-numeric: tabular-nums; }
.setup-row-why { grid-column: 1 / -1; font-size: 0.78em; color: ${C.danger}; }
.setup-empty { padding: 0.8em; color: ${C.textDim}; }
.setup-swatches { display: flex; flex-wrap: wrap; gap: 0.4em; }
.setup-swatch { width: ${target}; height: ${target}; border-radius: 0.5em; border: 2px solid rgba(255, 255, 255, 0.5); cursor: pointer; padding: 0; }
.setup-swatch[data-active="1"] { border-color: #fff; box-shadow: 0 0 0 3px ${C.accent}; }
.setup-flag-row { display: flex; align-items: center; gap: 0.8em; }
.setup-flag { border: 1px solid rgba(255, 255, 255, 0.7); border-radius: 3px; display: block; }
.setup-place { font-size: 0.9em; }
.setup-place[data-set="1"] { color: ${C.troops}; }
.setup-message { color: ${C.danger}; font-size: 0.9em; font-weight: 600; margin: 0 0 0.5em; }
.setup-marker { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
.setup-marker::before { content: ""; position: absolute; left: -1.1em; top: -1.1em; width: 2.2em; height: 2.2em; border-radius: 50%; border: 3px solid ${C.accent}; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55), 0 0 0.8em ${C.accent}; }
.setup-marker::after { content: ""; position: absolute; left: -0.28em; top: -0.28em; width: 0.56em; height: 0.56em; border-radius: 50%; background: #fff; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6); }
.setup-ai-row { display: flex; align-items: center; gap: 0.6em; }
.setup-range { flex: 1; min-height: ${target}; accent-color: ${C.accent}; cursor: pointer; margin: 0; }
.setup-ai-value { min-width: 2.2em; font-variant-numeric: tabular-nums; font-weight: 700; }
.setup-check { display: flex; align-items: center; gap: 0.6em; min-height: ${target}; cursor: pointer; }
.setup-check input { width: 1.3em; height: 1.3em; accent-color: ${C.accent}; }
.setup-check[data-disabled="1"] { opacity: 0.55; cursor: default; }
.setup-disclaimer { margin: 0; color: ${C.textDim}; font-size: 0.76em; line-height: 1.3; }
.setup-sources { margin: 0.4em 0 0.3em; color: ${C.textDim}; font-size: 0.78em; line-height: 1.35; }
.setup-foot { padding: 0.5em 0.8em 0.7em; border-top: 1px solid ${C.panelBorder}; display: flex; flex-direction: column; gap: 0.5em; }
.setup-status { font-size: 0.88em; min-height: 2.6em; }
.setup-status[data-kind="ok"] { color: ${C.troops}; }
.setup-status[data-kind="bad"] { color: ${C.danger}; }
.setup-status[data-kind="need"] { color: ${C.textDim}; }
.setup-start { width: 100%; min-height: 3em; border-radius: 2em; border: 2px solid ${C.accent}; background: ${C.buttonActive}; font-size: 1.1em; font-weight: 800; }
.setup-start:hover:not(:disabled) { background: #3a6cb8; }
.setup-start:disabled { opacity: 0.5; cursor: not-allowed; border-color: ${C.buttonBorder}; }
@media (max-width: ${NARROW_MAX_PX}px), (max-aspect-ratio: 1/1) {
  .setup-panel { left: 0; right: 0; top: auto; bottom: 0; width: auto; height: ${SETUP_SHEET_VH}vh; border-radius: 1em 1em 0 0; }
  .setup-list { max-height: 11em; }
}
/* Low windows (a laptop at 960 x 540): the start card and the setup panel are tighter so that nothing is cut off. */
@media (max-height: 700px) {
  .start-card { gap: 0.55em; padding: 0.8em 1.2em 0.8em; }
  .start-title { font-size: 1.9em; }
  .start-tagline { font-size: 0.95em; }
  .start-play, .start-setup { min-height: 2.6em; font-size: 1.15em; }
  .start-choice { gap: 0.2em; }
  .start-hint { font-size: 0.8em; }
  .gpu-tip { font-size: 0.72em; }
  .start-help { padding: 0.4em 0.7em; font-size: 0.8em; }
  .start-help li + li { margin-top: 0.15em; }
  .start-help-title { margin-bottom: -0.5em; }
  .setup-list { max-height: 9.5em; }
  .setup-status { min-height: 2.2em; }
  .setup-start { min-height: 2.6em; }
  .setup-foot { padding: 0.4em 0.8em 0.5em; gap: 0.35em; }
}

/* Districts-2a: the city view. A side panel on the right of a wide window (the 3D view stays free in the middle), a bottom sheet on a narrow one. */
.city-view { position: absolute; right: 0.6em; top: 64px; bottom: 0.6em; width: min(${CITY_VIEW.widthEm}em, ${CITY_VIEW.widthMaxVw}vw); overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 0.45em; padding: 0.55em 0.7em 0.6em; z-index: 2; user-select: none; }
.city-view.hud-panel { background: ${CITY_VIEW.colors.panel}; }
.city-view[hidden] { display: none !important; }
.city-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; }
.city-title { font-weight: 800; font-size: 1.1em; }
.city-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4em 0.7em; }
.city-state { color: ${C.barWarning}; font-size: 0.85em; }
.city-totals { display: flex; flex-wrap: wrap; gap: 0.2em 0.9em; font-size: 0.9em; color: ${C.gold}; font-variant-numeric: tabular-nums; }
.city-total { white-space: nowrap; }
.city-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${CITY_VIEW.tileMinEm}em, 1fr)); gap: 0.45em; }
.city-tile { display: flex; flex-direction: column; gap: 0.3em; padding: 0.4em 0.5em 0.5em; border-radius: 0.5em; border: 1px solid ${CITY_VIEW.colors.tileBorder}; background: ${CITY_VIEW.colors.tile}; min-width: 0; }
.city-tile[data-state="empty"] { border-style: dashed; background: ${CITY_VIEW.colors.tileEmpty}; }
.city-tile[hidden], .city-empty[hidden], .city-used[hidden] { display: none !important; }
.city-tile-label { color: ${C.textDim}; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.08em; }
.city-empty, .city-used { display: flex; flex-direction: column; gap: 0.3em; }
.city-empty-hint { color: ${C.textDim}; font-size: 0.8em; }
.city-btn, .city-build { min-height: ${TARGET_MIN_PX}px; padding: 0 0.7em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.city-btn:hover, .city-build:hover { background: ${C.buttonActive}; }
.city-btn:focus-visible, .city-build:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.city-btn[data-state="dim"], .city-build[data-state="dim"] { opacity: 0.5; border-style: dashed; cursor: not-allowed; }
.city-btn[data-armed="1"] { border-color: ${C.danger}; box-shadow: inset 0 0 0 1px ${C.danger}; }
.city-build { display: flex; align-items: center; gap: 0.5em; text-align: left; padding: 0.1em 0.5em; }
.city-build-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
.city-build-time { color: ${C.textDim}; font-size: 0.75em; font-weight: 400; }
.city-used-top { display: flex; align-items: center; gap: 0.5em; }
.city-used-names { display: flex; flex-direction: column; line-height: 1.2; }
.city-used-name { font-weight: 800; }
.city-used-level { color: ${C.textDim}; font-size: 0.8em; }
.city-used-state { color: ${C.barWarning}; font-size: 0.8em; }
.city-progress { height: 0.5em; border-radius: 0.3em; background: ${CITY_VIEW.colors.progressTrack}; overflow: hidden; }
.city-progress-fill { height: 100%; background: ${CITY_VIEW.colors.progress}; }
.city-progress[hidden], .city-used-state[hidden], .city-fx[hidden] { display: none !important; }
.city-fx { font-size: 0.82em; }
.city-fx-next { color: ${C.textDim}; }
.city-row { display: flex; flex-wrap: wrap; gap: 0.35em; margin-top: 0.1em; }
.city-row .city-btn { flex: 1 1 auto; padding: 0 0.5em; }
.city-hint { color: ${C.textDim}; font-size: 0.8em; }
@media (max-width: ${NARROW_MAX_PX}px), (max-aspect-ratio: 1/1) {
  .city-view { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: ${CITY_VIEW.sheetVh}vh; }
}

/* M18-2: win conditions in the setup, then the match panels (pause menu, result screen, elimination panel, spectator bar). */
.setup-win-presets { display: flex; flex-wrap: wrap; gap: 0.35em; }
.setup-win-presets .setup-tab { flex: 1 1 auto; padding: 0 0.5em; font-size: 0.9em; }
.mp-root { position: absolute; inset: 0; z-index: ${MATCH_PANELS.z}; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.3; color: ${C.text}; box-sizing: border-box; }
.mp-root *, .mp-root *::before { box-sizing: border-box; }
.mp-root [hidden] { display: none !important; }
.mp-scrim { position: absolute; inset: 0; pointer-events: auto; background: ${MATCH_PANELS.scrim}; display: flex; align-items: safe center; justify-content: center; padding: 0.6em; overflow: auto; }
.mp-scrim:has(.mp-small) { align-items: flex-start; padding-top: ${MATCH_PANELS.pauseTopEm}em; }
.mp-card { overflow: auto; background: ${C.panel}; border: 1px solid ${C.panelBorder}; border-radius: 1em; box-shadow: 0 0.4em 2em rgba(0, 0, 0, 0.6); padding: 0.9em 1.1em; display: flex; flex-direction: column; gap: 0.6em; max-width: 100%; max-height: ${MATCH_PANELS.maxHeightVh}vh; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.mp-small { width: ${MATCH_PANELS.cardWidthEm}em; }
.mp-wide { width: ${MATCH_PANELS.resultWidthEm}em; }
.mp-title { margin: 0; font-size: 1.5em; font-weight: 800; }
.mp-reason { margin: 0; font-size: 1.05em; color: ${C.accent}; font-weight: 600; }
.mp-text { margin: 0; color: ${C.textDim}; }
.mp-label { color: ${C.textDim}; font-size: 0.85em; }
.mp-col { display: flex; flex-direction: column; gap: 0.4em; }
.mp-row { display: flex; gap: 0.4em; flex-wrap: wrap; }
.mp-actions { justify-content: flex-end; }
.mp-btn { min-width: ${target}; min-height: ${target}; padding: 0 1em; border-radius: 0.6em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.mp-btn:hover { background: ${C.buttonActive}; }
.mp-btn:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.mp-btn[aria-pressed="true"] { background: ${C.buttonActive}; border-color: ${C.accent}; box-shadow: inset 0 0 0 1px ${C.accent}; }
.mp-primary { border-color: ${C.accent}; }
.mp-table-wrap { flex: none; overflow: visible; border: 1px solid ${C.panelBorder}; border-radius: 0.5em; background: ${C.field}; }
.mp-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.mp-table th { color: ${C.textDim}; font-size: 0.78em; font-weight: 600; padding: 0.35em 0.4em; text-align: right; position: sticky; top: 0; background: ${C.field}; }
.mp-table td { white-space: nowrap; padding: 0.3em 0.4em; text-align: right; border-top: 1px solid rgba(60, 90, 143, 0.35); }
.mp-table .mp-left { text-align: left; }
.mp-name { display: flex; align-items: center; gap: 0.45em; min-width: 6em; }
.mp-name-text { max-width: ${MATCH_PANELS.nameMaxEm}em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-swatch { flex: none; width: 0.9em; height: 0.9em; border-radius: 0.2em; border: 1px solid rgba(255, 255, 255, 0.7); }
.mp-table tr[data-you="1"] td { background: ${C.youRow}; font-weight: 700; }
.mp-table tr[data-winner="1"] td { color: ${MATCH_PANELS.winnerBorder}; }
.mp-table tr[data-eliminated="1"] td { color: ${C.textDim}; }
.mp-spectator { position: absolute; left: 50%; top: ${TOPBAR.wideEm + 0.4}em; transform: translateX(-50%); width: max-content; max-width: calc(100% - 1.2em); justify-content: center; pointer-events: auto; display: flex; align-items: center; gap: 0.35em; flex-wrap: wrap; background: ${C.panel}; border: 1px solid ${C.panelBorder}; border-radius: 0.6em; padding: 0.3em 0.5em; }
.mp-badge { font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.barWarning}; padding: 0 0.4em; }
/* M20a-lite: the help overlay (generated from the hotkey registry) */
.help-overlay { position: absolute; inset: 0; z-index: ${HELP_OVERLAY.z}; pointer-events: none; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.3; color: ${C.text}; box-sizing: border-box; padding: 0.6em; }
.help-overlay *, .help-overlay *::before { box-sizing: border-box; }
.help-overlay[hidden] { display: none !important; }
.help-card { pointer-events: auto; width: ${HELP_OVERLAY.widthEm}em; max-width: 100%; max-height: 100%; overflow: auto; background: ${HELP_OVERLAY.cardBg}; border: 1px solid ${C.panelBorder}; border-radius: 0.8em; box-shadow: 0 0.3em 1.4em rgba(0, 0, 0, 0.6); padding: 0.6em 0.9em 0.7em; }
.help-title { font-size: 1.15em; font-weight: 800; margin-bottom: 0.3em; }
.help-row { display: grid; grid-template-columns: ${HELP_OVERLAY.keyColEm}em 1fr; column-gap: 0.7em; align-items: baseline; min-height: 1.2em; line-height: 1.2; } /* M18e-1 integration: one entry more (keys 7 to 9), so the rows are a little lower to keep the card inside 960x540; M13c-2: one more (key B), lower again (was 1.45em); Ctx-1: one more (the right click), 1.2em and line height 1.2 (was 1.3em) */
.help-keys { font: inherit; font-weight: 700; font-variant-numeric: tabular-nums; color: ${C.accent}; white-space: nowrap; }
.help-hint { margin-top: 0.4em; color: ${C.textDim}; font-size: 0.85em; }
@media (max-width: ${NARROW_MAX_PX}px), (max-aspect-ratio: 1/1) {
  .mp-spectator { top: ${MATCH_PANELS.spectatorTopNarrowEm}em; }
  .mp-scrim:has(.mp-small) { padding-top: ${MATCH_PANELS.pauseTopNarrowEm}em; }
  .mp-table th, .mp-table td { padding: 0.3em 0.25em; }
  .mp-table { font-size: 0.9em; }
  .mp-name { min-width: 4em; } .mp-name-text { max-width: 7em; } /* Fix-6B: the last column (Teknik) fits a 540 px window */
}

/* M18c-2: the diplomacy panel and the proposal cards */
.diplo-overlay { position: absolute; inset: 0; z-index: ${DIPLO.z}; pointer-events: none; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.3; color: ${C.text}; box-sizing: border-box; padding: 0.6em; }
.diplo-overlay *, .diplo-cards * { box-sizing: border-box; }
.diplo-overlay[hidden] { display: none !important; }
.diplo-card { pointer-events: auto; width: ${DIPLO.panelWidthEm}em; max-width: 100%; max-height: 100%; overflow: auto; background: ${DIPLO.cardBg}; border: 1px solid ${C.panelBorder}; border-radius: 0.8em; box-shadow: 0 0.3em 1.4em rgba(0, 0, 0, 0.6); padding: 0.6em 0.9em 0.7em; }
.diplo-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6em; margin-bottom: 0.3em; }
.diplo-title { font-size: 1.15em; font-weight: 800; flex: 1 1 auto; }
.diplo-cooldown { color: ${C.barWarning}; font-weight: 700; margin: 0.2em 0 0.3em; }
.diplo-row { display: grid; grid-template-columns: minmax(8em, 1fr) minmax(8em, 1fr) minmax(0, 20em); column-gap: 0.8em; row-gap: 0.2em; align-items: center; padding: 0.4em 0; border-top: 1px solid ${C.panelBorder}; }
.diplo-row[data-eliminated="1"] { opacity: 0.55; }
.diplo-who { display: flex; align-items: center; gap: 0.45em; min-width: 0; }
.diplo-swatch { flex: none; width: 0.9em; height: 0.9em; border-radius: 0.2em; border: 1px solid rgba(255, 255, 255, 0.7); }
.diplo-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.diplo-share { color: ${C.textDim}; font-variant-numeric: tabular-nums; flex: none; }
.diplo-state { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2em 0.5em; min-width: 0; }
.diplo-row[data-relation="truce"] .diplo-rel { color: ${DIPLO.badge.truce}; font-weight: 700; }
.diplo-row[data-relation="alliance"] .diplo-rel { color: ${DIPLO.badge.alliance}; font-weight: 700; }
.diplo-marks { display: inline-flex; gap: 0.3em; }
.diplo-mark { font-size: 0.8em; font-weight: 800; padding: 0 0.35em; border-radius: 0.3em; border: 1px solid currentColor; }
.diplo-mark-embargo { color: ${DIPLO.badge.embargo}; }
.diplo-mark-traitor { color: ${DIPLO.badge.traitor}; }
.diplo-mark[hidden], .diplo-waiting[hidden], .diplo-note[hidden], .diplo-empty[hidden], .diplo-cooldown[hidden] { display: none !important; }
.diplo-waiting { color: ${C.textDim}; font-size: 0.9em; }
.diplo-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.3em; }
.diplo-incoming { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4em 0.6em; padding: 0.2em 0.4em; border: 1px solid ${DIPLO.badge.truce}; border-radius: 0.5em; }
.diplo-incoming-text { flex: 1 1 10em; font-weight: 700; }
.diplo-incoming[hidden] { display: none !important; }
.diplo-note { grid-column: 1 / -1; color: ${C.barWarning}; font-size: 0.9em; }
.diplo-empty { color: ${C.textDim}; padding: 0.5em 0; }
.diplo-hint { margin-top: 0.4em; color: ${C.textDim}; font-size: 0.85em; }
.diplo-btn { min-height: 2.3em; padding: 0.15em 0.6em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.diplo-btn:hover { background: ${C.buttonActive}; }
.diplo-btn[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.diplo-btn[data-armed="1"] { border-color: ${C.danger}; box-shadow: inset 0 0 0 1px ${C.danger}; }
.diplo-btn:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.diplo-cards { position: absolute; left: 0.6em; top: ${TOPBAR.wideEm + 0.4}em; width: ${DIPLO.cardWidthEm}em; max-width: calc(100% - 1.2em); z-index: ${Z_HUD + 1}; display: flex; flex-direction: column; gap: 0.4em; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.3; color: ${C.text}; }
.diplo-cards[hidden] { display: none !important; }
.diplo-pcard { pointer-events: auto; background: ${C.panel}; border: 1px solid ${DIPLO.badge.truce}; border-radius: 0.6em; box-shadow: 0 0.15em 0.7em rgba(0, 0, 0, 0.5); padding: 0.4em 0.6em; display: flex; flex-direction: column; gap: 0.3em; }
.diplo-pcard[data-treaty="2"] { border-color: ${DIPLO.badge.alliance}; }
.diplo-pcard[hidden] { display: none !important; }
.diplo-pcard-top { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5em; }
.diplo-pcard-text { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
.diplo-pcard-left { color: ${C.textDim}; font-variant-numeric: tabular-nums; flex: none; }
.diplo-pcard-btns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.3em; }
/* M18d-2: the research panel (four branch columns of four cells; two columns on a narrow or portrait window) */
.tech-overlay { position: absolute; inset: 0; z-index: ${TECH_UI.z}; pointer-events: none; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.25; color: ${C.text}; box-sizing: border-box; padding: 0.6em; }
.tech-overlay *, .tech-overlay *::before { box-sizing: border-box; }
.tech-overlay[hidden] { display: none !important; }
.tech-card { pointer-events: auto; width: ${TECH_UI.panelWidthEm}em; max-width: 100%; max-height: 100%; overflow: auto; background: ${TECH_UI.cardBg}; border: 1px solid ${C.panelBorder}; border-radius: 0.8em; box-shadow: 0 0.3em 1.4em rgba(0, 0, 0, 0.6); padding: 0.6em 0.8em 0.7em; }
.tech-head { padding-right: ${TECH_UI.devClearPx}px; display: flex; align-items: center; justify-content: space-between; gap: 0.6em; margin-bottom: 0.4em; }
.tech-title { font-size: 1.15em; font-weight: 800; flex: 1 1 auto; }
.tech-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5em; }
.tech-branch { display: flex; flex-direction: column; gap: 0.4em; min-width: 0; }
.tech-branch-head { font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.85em; padding: 0 0.1em; }
.tech-cell { display: flex; flex-direction: column; gap: 0.15em; min-width: 0; padding: 0.35em 0.5em; border: 1px solid ${C.panelBorder}; border-radius: 0.5em; background: rgba(255, 255, 255, 0.03); font-size: 0.84em; }
.tech-cell[data-status="done"] { border-color: ${TECH_UI.status.done}; }
.tech-cell[data-status="active"] { border-color: ${TECH_UI.status.active}; }
.tech-cell[data-status="available"] { border-color: ${TECH_UI.status.available}; }
.tech-cell[data-status="locked"] { opacity: 0.6; }
.tech-name { font-weight: 800; overflow-wrap: anywhere; }
.tech-fx { color: ${C.text}; overflow-wrap: anywhere; }
.tech-meta { color: ${C.textDim}; font-variant-numeric: tabular-nums; }
.tech-status { font-weight: 700; font-variant-numeric: tabular-nums; }
.tech-cell[data-status="done"] .tech-status { color: ${TECH_UI.status.done}; }
.tech-cell[data-status="active"] .tech-status { color: ${TECH_UI.status.active}; }
.tech-cell[data-status="available"] .tech-status { color: ${TECH_UI.status.available}; }
.tech-cell[data-status="locked"] .tech-status { color: ${TECH_UI.status.locked}; }
.tech-cell[data-status="blocked"] .tech-status { color: ${TECH_UI.status.blocked}; }
.tech-why { color: ${C.textDim}; font-size: 0.85em; overflow-wrap: anywhere; }
.tech-bar { height: 0.45em; border-radius: 0.25em; background: rgba(255, 255, 255, 0.15); overflow: hidden; }
.tech-bar-fill { height: 100%; width: 0; background: ${TECH_UI.status.active}; }
.tech-bar[hidden], .tech-why[hidden], .tech-btn[hidden], .tech-note[hidden] { display: none !important; }
.tech-actions { display: flex; gap: 0.3em; flex-wrap: wrap; }
.tech-note { margin-top: 0.4em; color: ${C.barWarning}; font-size: 0.9em; }
.tech-hint { margin-top: 0.4em; color: ${C.textDim}; font-size: 0.85em; }
.tech-btn { min-height: 2.1em; padding: 0.15em 0.6em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.tech-btn:hover { background: ${C.buttonActive}; }
.tech-btn[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.tech-btn[data-armed="1"] { border-color: ${C.danger}; box-shadow: inset 0 0 0 1px ${C.danger}; }
.tech-btn:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.hud-tech-running { flex: 0 1 auto; color: ${TECH_UI.status.active}; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: ${TECH_UI.runningMaxEm}em; min-width: 0; }
@media (max-height: ${TECH_UI.lowHeightPx}px) and (min-aspect-ratio: 1/1) { /* Fix-5B: a short wide window (960x540, 1366x640) shows the whole panel without scrolling */
  .tech-card { padding: 0.4em 0.6em 0.45em; }
  .tech-head { margin-bottom: 0.2em; }
  .tech-grid, .tech-branch { gap: 0.25em; }
  .tech-cell { font-size: 0.74em; padding: 0.2em 0.35em; gap: 0.05em; }
  .tech-btn { min-height: 1.7em; padding: 0.05em 0.5em; }
  .tech-note, .tech-hint { margin-top: 0.2em; }
}
@media (pointer: coarse) { .tech-btn { min-height: ${target}; } }
@media (max-width: ${NARROW_MAX_PX}px), (max-aspect-ratio: 1/1) {
  .tech-btn { min-height: ${target}; }
  .tech-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hud-tech-running { max-width: 9em; }
  .hud-diplo { gap: 0.25em; }
  .hud-diplo .hud-btn { padding: 0 0.4em; }
}
@media (pointer: coarse) { .diplo-btn { min-height: ${target}; } }
@media (max-width: ${NARROW_MAX_PX}px), (max-aspect-ratio: 1/1) {
  .diplo-btn { min-height: ${target}; }
  .sel-panel { max-height: calc(100% - 1.2em); }
  .diplo-row { grid-template-columns: minmax(0, 1fr); }
  .diplo-cards { left: auto; right: 8px; top: ${TOPBAR.narrowBoardEm + 2.6}em; }
}
`;
}

/** Adds the style sheet to `parent` once; returns the element (the owner removes it with the rest). */
export function mountHudStyle(parent: HTMLElement): HTMLStyleElement {
  const style = document.createElement('style');
  style.dataset.hudStyle = '1';
  style.textContent = hudCss();
  parent.appendChild(style);
  return style;
}
