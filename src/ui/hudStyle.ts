// The style sheet of the match HUD and the start screen, built from the tokens in uiConfig.ts. One <style> element per root; the
// classes are prefixed `hud-` / `start-`. No transitions or animations (CSS time is not the fx clock; tests/fxClock.test.ts
// forbids them): every visible change is a state change driven from JS.
import { GPU_TIP, NARROW_MAX_PX, HUD_FONT_BIAS_PX, HUD_FONT_MAX_PX, HUD_FONT_MIN_PX, HUD_FONT_VW, SETUP_PANEL_EM, SETUP_SHEET_VH, TARGET_MIN_PX, UI_COLORS as C, Z_HUD, Z_SETUP, Z_START_SCREEN } from './uiConfig';

export function hudCss(): string {
  const fontSize = `clamp(${HUD_FONT_MIN_PX}px, calc(${HUD_FONT_VW}vw + ${HUD_FONT_BIAS_PX}px), ${HUD_FONT_MAX_PX}px)`;
  const target = `${TARGET_MIN_PX}px`;
  return `
.hud-root, .start-root, .setup-root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.3; color: ${C.text}; box-sizing: border-box; -webkit-font-smoothing: antialiased; }
.hud-root *, .start-root *, .setup-root * { box-sizing: border-box; }
.hud-root [hidden], .start-root [hidden], .setup-root [hidden], .start-root[hidden], .setup-root[hidden] { display: none !important; }
.hud-root { position: absolute; inset: 0; z-index: ${Z_HUD}; pointer-events: none; user-select: none; -webkit-user-select: none; }
.hud-panel { pointer-events: auto; background: ${C.panel}; border: 1px solid ${C.panelBorder}; border-radius: 0.6em; box-shadow: 0 0.15em 0.7em rgba(0, 0, 0, 0.5); padding: 0.5em 0.8em; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.hud-label { color: ${C.textDim}; font-size: 0.85em; letter-spacing: 0.02em; }
.hud-num { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 1.25em; }
.hud-dim { color: ${C.textDim}; font-variant-numeric: tabular-nums; }

.hud-banner { position: absolute; left: 50%; top: 0.7em; transform: translateX(-50%); width: max-content; max-width: min(34em, calc(100vw - 33em)); text-align: center; padding: 0.55em 1.1em; }
.hud-banner[data-tone="prompt"] { border-color: ${C.accent}; }
.hud-banner[data-tone="missed"] { border-color: ${C.danger}; }
.hud-banner-text { font-weight: 600; font-size: 1.1em; }
.hud-banner-seconds { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 2em; line-height: 1.1; color: ${C.accent}; }
.hud-badge { position: absolute; left: 50%; top: 5.6em; transform: translateX(-50%); padding: 0.2em 0.9em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.barWarning}; pointer-events: none; }

.hud-board { position: absolute; right: 0.6em; top: 64px; width: 14.5em; padding: 0.45em 0.6em 0.5em; }
.hud-board[data-labels="1"] { width: 17.5em; }
.hud-board-title { color: ${C.textDim}; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.2em; }
.hud-row { display: grid; grid-template-columns: 1.6em 0.9em 1fr auto; align-items: center; column-gap: 0.4em; min-height: 1.7em; padding: 0 0.3em; border-radius: 0.3em; }
.hud-row[data-you="1"] { background: ${C.youRow}; font-weight: 700; }
.hud-rank { color: ${C.textDim}; text-align: right; font-variant-numeric: tabular-nums; }
.hud-swatch { width: 0.9em; height: 0.9em; border-radius: 0.2em; border: 1px solid rgba(255, 255, 255, 0.7); }
.hud-row[data-flag="1"] { grid-template-columns: 1.6em 0.9em auto 1fr auto; }
.hud-flag { border-radius: 2px; border: 1px solid rgba(255, 255, 255, 0.55); display: block; }
.hud-flag[hidden] { display: none !important; }
.hud-nation { grid-column: 1 / -1; display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.15em; font-weight: 700; }
.hud-nation[hidden] { display: none !important; }
.hud-nation-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-share { font-variant-numeric: tabular-nums; }
.hud-empty { color: ${C.textDim}; font-size: 0.9em; padding: 0.2em 0.3em; }

.hud-dock { position: absolute; left: 0.6em; right: 0.6em; bottom: 0.6em; display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 0.6em; pointer-events: none; }
.hud-status { width: 17.5em; display: grid; grid-template-columns: auto 1fr; column-gap: 0.7em; row-gap: 0.15em; align-items: baseline; }
.hud-status .hud-right { justify-self: end; text-align: right; }
.hud-gold { color: ${C.gold}; }
.hud-troops { color: ${C.troops}; }
.hud-bar { grid-column: 1 / -1; position: relative; height: 0.75em; margin: 0.25em 0 0.2em; border-radius: 0.4em; background: ${C.barTrack}; overflow: hidden; border: 1px solid ${C.panelBorder}; }
.hud-bar-fill { position: absolute; inset: 0; transform-origin: left center; background: ${C.bar}; }
.hud-bar[data-warning="1"] .hud-bar-fill { background: ${C.barWarning}; }
.hud-bar-mark { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(255, 255, 255, 0.85); }
.hud-warn { color: ${C.barWarning}; font-weight: 700; font-size: 0.85em; }
.hud-meta { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.15em; }

.hud-controls { display: flex; flex-direction: column; gap: 0.45em; width: 19.5em; max-width: calc(100vw - 1.2em); }
.hud-group { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; }
.hud-btns { display: flex; gap: 0.3em; }
.hud-btn { min-width: ${target}; min-height: ${target}; padding: 0 0.7em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.hud-btn:hover { background: ${C.buttonActive}; }
.hud-btn[aria-pressed="true"] { background: ${C.buttonActive}; border-color: ${C.accent}; box-shadow: inset 0 0 0 1px ${C.accent}; }
.hud-btn:focus-visible, .hud-slider:focus-visible, .start-btn:focus-visible, .setup-input:focus-visible, .setup-tab:focus-visible, .setup-row:focus-visible, .setup-swatch:focus-visible, .setup-range:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.hud-commit-line { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; }
.hud-slider { width: 100%; min-height: ${target}; margin: 0; accent-color: ${C.accent}; cursor: pointer; }

.hud-toast { position: absolute; left: 50%; bottom: 11em; transform: translateX(-50%); width: max-content; max-width: min(30em, calc(100vw - 2em)); text-align: center; padding: 0.45em 1em; pointer-events: none; border-color: ${C.danger}; }

.build-bar { position: absolute; left: 50%; bottom: 0.6em; transform: translateX(-50%); display: flex; align-items: center; gap: 0.4em; padding: 0.3em; pointer-events: auto; }
.build-bar[hidden], .build-hint[hidden] { display: none !important; }
.build-bar { flex-wrap: wrap; justify-content: center; max-width: min(46em, calc(100vw - 1em)); } /* M10-2: six buttons wrap on a narrow window */
.build-btn { min-width: ${target}; min-height: ${target}; padding: 0 0.8em; display: flex; align-items: baseline; gap: 0.5em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.build-btn:hover { background: ${C.buttonActive}; }
.build-btn[data-active="1"] { background: ${C.buttonActive}; border-color: ${C.accent}; box-shadow: inset 0 0 0 1px ${C.accent}; }
.build-btn[data-state="poor"] { opacity: 0.55; border-color: ${C.panelBorder}; }
.build-key { color: ${C.textDim}; font-size: 0.8em; }
.build-price { color: ${C.gold}; font-variant-numeric: tabular-nums; }
/* M10-3: six buttons do not fit one row at 960 px or on a phone: the bar wraps and shrinks its labels. */
.build-bar { flex-wrap: wrap; justify-content: center; max-width: min(23em, calc(100vw - 1em)); }
.build-btn[data-state="locked"] { opacity: 0.45; border-style: dashed; }
@media (max-width: 1100px) { .build-btn { padding: 0 0.5em; gap: 0.35em; } .build-name { font-size: 0.85em; } }
.build-bar ~ .build-hint { bottom: 10.8em; }
.build-hint { position: absolute; left: 50%; bottom: 4.6em; transform: translateX(-50%); width: max-content; max-width: min(20em, calc(100vw - 2em)); text-align: center; padding: 0.35em 0.9em; pointer-events: none; font-size: 0.9em; }
.toast-stack { position: absolute; left: 50%; bottom: 17em; transform: translateX(-50%); display: flex; flex-direction: column; gap: 0.35em; align-items: center; z-index: ${Z_HUD + 1}; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: ${fontSize}; }
.toast { width: max-content; max-width: min(30em, calc(100vw - 2em)); text-align: center; padding: 0.45em 1em; border-radius: 0.6em; background: ${C.panel}; color: ${C.text}; border: 1px solid ${C.panelBorder}; box-shadow: 0 0.15em 0.7em rgba(0, 0, 0, 0.5); }
.toast[data-kind="error"] { border-color: ${C.danger}; }
.toast[data-kind="warn"] { border-color: ${C.barWarning}; }
/* M10-4: the selection panel sits bottom left above the status panel and wraps on a narrow window. */
.sel-panel { position: absolute; left: 0.6em; bottom: 9.6em; width: 17.5em; max-width: calc(100vw - 1.2em); padding: 0.45em 0.6em 0.5em; display: flex; flex-direction: column; gap: 0.25em; pointer-events: auto; }
.sel-panel[hidden] { display: none !important; }
.sel-name { font-weight: 800; font-size: 1.05em; }
.sel-level, .sel-note { color: ${C.textDim}; font-size: 0.85em; }
.sel-state { color: ${C.barWarning}; font-size: 0.85em; }
.sel-fx { font-size: 0.9em; }
.sel-row { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.2em; }
.sel-btn { min-height: ${target}; padding: 0 0.8em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.sel-btn:hover { background: ${C.buttonActive}; }
.sel-btn[data-state="dim"] { opacity: 0.5; border-style: dashed; cursor: not-allowed; }

/* Narrow screens (a phone held upright, D107): the banner takes the whole top row left of the Dev button, with the countdown beside the
   text; the leaderboard sits below it, so nothing overlaps the banner, the board or the Dev button (48 px + 8 px margins). */
@media (max-width: ${NARROW_MAX_PX}px), (max-aspect-ratio: 1/1) {
  .hud-banner { left: 8px; right: 64px; top: 8px; transform: none; width: auto; max-width: none; display: flex; align-items: center; justify-content: space-between; gap: 0.6em; text-align: left; padding: 0.35em 0.7em; }
  .hud-banner-text { font-size: 1em; }
  .hud-banner-seconds { font-size: 1.6em; flex: none; }
  .hud-badge { left: 8px; transform: none; top: 5.4em; }
  .hud-board { top: 6.4em; right: 8px; width: 13em; padding: 0.35em 0.5em 0.4em; }
  .hud-board[data-labels="1"] { width: 15.5em; }
  .hud-row { min-height: 1.5em; }
  .hud-toast { bottom: 17em; }
  .build-bar { bottom: 11.5em; left: auto; right: 8px; transform: none; max-width: calc(100vw - 20em); justify-content: flex-end; } /* M10-2: right of the gold panel, wraps upward */
  .build-bar ~ .build-hint { left: auto; right: 8px; transform: none; bottom: 23em; }
  .toast-stack { bottom: 30em; }
  .sel-panel { left: 8px; bottom: 21em; width: auto; max-width: min(17.5em, calc(100vw - 16px)); }
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
.gpu-tip-close { pointer-events: auto; flex: 0 0 auto; min-height: ${TARGET_MIN_PX}px; min-width: ${TARGET_MIN_PX}px; padding: 0 1em; border-radius: 0.5em; border: 1px solid ${C.buttonBorder}; background: ${C.button}; color: ${C.text}; font: inherit; cursor: pointer; }
.start-setup { min-width: 11em; min-height: 3.2em; padding: 0 2em; border-radius: 2em; border: 2px solid ${C.buttonBorder}; background: ${C.button}; font-size: 1.25em; font-weight: 800; }
.start-setup:hover { background: ${C.buttonActive}; }

.setup-root { position: absolute; inset: 0; z-index: ${Z_SETUP}; pointer-events: none; }
.setup-panel { pointer-events: auto; position: absolute; left: 0.6em; top: 0.6em; bottom: 0.6em; width: min(${SETUP_PANEL_EM}em, calc(100vw - 1.2em)); display: flex; flex-direction: column; background: rgba(8, 13, 24, 0.93); border: 1px solid ${C.panelBorder}; border-radius: 1em; box-shadow: 0 0.4em 2em rgba(0, 0, 0, 0.6); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.setup-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; padding: 0.5em 0.8em; border-bottom: 1px solid ${C.panelBorder}; }
.setup-title { margin: 0; font-size: 1.3em; font-weight: 800; }
.setup-head-btns { display: flex; gap: 0.4em; }
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
