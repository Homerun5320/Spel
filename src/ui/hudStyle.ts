// The style sheet of the match HUD and the start screen, built from the tokens in uiConfig.ts. One <style> element per root; the
// classes are prefixed `hud-` / `start-`. No transitions or animations (CSS time is not the fx clock; tests/fxClock.test.ts
// forbids them): every visible change is a state change driven from JS.
import { HUD_FONT_BIAS_PX, HUD_FONT_MAX_PX, HUD_FONT_MIN_PX, HUD_FONT_VW, TARGET_MIN_PX, UI_COLORS as C, Z_HUD, Z_START_SCREEN } from './uiConfig';

export function hudCss(): string {
  const fontSize = `clamp(${HUD_FONT_MIN_PX}px, calc(${HUD_FONT_VW}vw + ${HUD_FONT_BIAS_PX}px), ${HUD_FONT_MAX_PX}px)`;
  const target = `${TARGET_MIN_PX}px`;
  return `
.hud-root, .start-root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.3; color: ${C.text}; box-sizing: border-box; -webkit-font-smoothing: antialiased; }
.hud-root *, .start-root * { box-sizing: border-box; }
.hud-root [hidden], .start-root [hidden] { display: none !important; }
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
.hud-board-title { color: ${C.textDim}; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.2em; }
.hud-row { display: grid; grid-template-columns: 1.6em 0.9em 1fr auto; align-items: center; column-gap: 0.4em; min-height: 1.7em; padding: 0 0.3em; border-radius: 0.3em; }
.hud-row[data-you="1"] { background: ${C.youRow}; font-weight: 700; }
.hud-rank { color: ${C.textDim}; text-align: right; font-variant-numeric: tabular-nums; }
.hud-swatch { width: 0.9em; height: 0.9em; border-radius: 0.2em; border: 1px solid rgba(255, 255, 255, 0.7); }
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
.hud-btn:focus-visible, .hud-slider:focus-visible, .start-btn:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.hud-commit-line { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5em; }
.hud-slider { width: 100%; min-height: ${target}; margin: 0; accent-color: ${C.accent}; cursor: pointer; }

.hud-toast { position: absolute; left: 50%; bottom: 11em; transform: translateX(-50%); width: max-content; max-width: min(30em, calc(100vw - 2em)); text-align: center; padding: 0.45em 1em; pointer-events: none; border-color: ${C.danger}; }

.start-root { position: absolute; inset: 0; z-index: ${Z_START_SCREEN}; display: flex; align-items: center; justify-content: center; padding: 1em; background: radial-gradient(ellipse at center, ${C.scrim} 0%, ${C.scrimEdge} 100%); overflow: auto; }
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
