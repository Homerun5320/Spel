// The registered `?` modes of the app (see devpanel.ts). Every later milestone that adds a `?` mode (scene, scenario, view,
// debug pages, seed) registers it here, so the Dev panel always lists everything the address bar could do.
import { DEV_PANEL_REQUEST_EVENT } from '../ui/events';
import { goToBookmark } from './bookmarks';
import { registerDevMode } from './devpanel';

export function registerAppModes(): void {
  registerDevMode({ id: 'perf', label: 'Prestanda (perf)', params: { perf: '1' }, toggle: true });
  registerDevMode({ id: 'test', label: 'Testläge (fast bild)', params: { test: '1' }, toggle: true });
  registerDevMode({ id: 'scene-spike', label: 'Scen: M00-spiken', params: { scene: 'spike' } });
  registerDevMode({ id: 'scene-globe', label: 'Scen: jorden', params: { scene: 'globe' } });
  // M08: the scripted flight orbit -> continent -> valley -> 300 m over the Himalaya, with the report to copy (it turns the perf overlay on itself).
  registerDevMode({ id: 'scene-perf', label: 'Prestandascen', params: { scene: 'perf' } });
  registerDevMode({ id: 'quality-low', label: 'Kvalitet: låg', params: { quality: 'low' } });
  registerDevMode({ id: 'quality-medium', label: 'Kvalitet: medel', params: { quality: 'medium' } });
  registerDevMode({ id: 'quality-high', label: 'Kvalitet: hög', params: { quality: 'high' } });
  // AutoTier-2: the adaptive resolution (on by default in the live game; `adapt-1` also forces it on in the performance scene).
  registerDevMode({ id: 'adapt-on', label: 'Adaptiv upplösning på (tvingar på, även i prestandascenen)', params: { adapt: '1' } });
  registerDevMode({ id: 'adapt-off', label: 'Adaptiv upplösning av (full upplösning hela tiden)', params: { adapt: '0' } });
  registerDevMode({ id: 'terrain-fixed', label: 'Terräng: gamla fasta nätet (M02)', params: { terrain: 'fixed' } });
  registerDevMode({ id: 'terrain-chunks', label: 'Terräng: chunk-träd (standard)', params: { terrain: 'chunks' } });
  registerDevMode({ id: 'chunks', label: 'Visa chunkens färger och kanter', params: { chunks: '1' }, toggle: true });
  registerDevMode({ id: 'detail-off', label: 'Terrängdetalj av (bara rasterhöjden)', params: { detail: '0' } });
  registerDevMode({ id: 'detail-on', label: 'Terrängdetalj på (standard)', params: { detail: '1' } });
  registerDevMode({ id: 'mottle-off', label: 'Närbildens färgfläckar av (kostnadsjämförelse)', params: { mottle: '0' } });
  registerDevMode({ id: 'mottle-on', label: 'Närbildens färgfläckar på (standard)', params: { mottle: '1' } });
  registerDevMode({ id: 'chunktier-high', label: 'Testläge: chunk-täthet som hög kvalitet', params: { chunktier: 'high' } });
  registerDevMode({ id: 'view-alps-valley', label: 'Vy: Alpdal, 2 km över marken', params: { view: 'alps-valley' } });
  registerDevMode({ id: 'view-himalaya-valley', label: 'Vy: Himalayadal, 2 km över marken', params: { view: 'himalaya-valley' } });
  // M08: the bookmarks fly the RTS camera to a place (a custom action: no reload, the panel closes itself afterwards).
  const bookmark = (id: 'alps' | 'himalaya' | 'andes' | 'capital', label: string): void =>
    registerDevMode({
      id: `bookmark-${id}`,
      label,
      run: () => {
        goToBookmark(id);
        window.dispatchEvent(new Event(DEV_PANEL_REQUEST_EVENT));
      },
    });
  bookmark('alps', 'Bokmärke: Alperna (RTS-kamera)');
  bookmark('himalaya', 'Bokmärke: Himalaya (RTS-kamera)');
  bookmark('andes', 'Bokmärke: Anderna (RTS-kamera)');
  bookmark('capital', 'Bokmärke: din huvudstad (F)');
  registerDevMode({ id: 'seed-7', label: 'Seed 7', params: { seed: '7' } });
  registerDevMode({ id: 'seed', label: 'Seed', field: { param: 'seed', placeholder: '1', pattern: /^-?\d{1,10}$/ } });
  registerDevMode({ id: 'lang-en', label: 'Språk: English', params: { lang: 'en' } });
  registerDevMode({ id: 'lang-sv', label: 'Språk: svenska', params: { lang: 'sv' } });
  registerDevMode({ id: 'hud', label: 'HUD i testläge', params: { hud: '1' }, toggle: true });
  registerDevMode({ id: 'ai-off', label: 'AI och stammar av (tom match)', params: { ai: '0' } });
  registerDevMode({ id: 'ai-on', label: 'AI och stammar på (standard)', params: { ai: '1' } });
  registerDevMode({ id: 'debug-data', label: 'Datakartan (debug/data.html)', href: './debug/data.html' });
  registerDevMode({ id: 'debug-data-height', label: 'Datakartan: höjd', href: './debug/data.html#map-height' });
  registerDevMode({ id: 'debug-data-country', label: 'Datakartan: länder', href: './debug/data.html#map-country' });
  registerDevMode({ id: 'debug-sim', label: 'Simuleringens hashar (debug/sim.html)', href: './debug/sim.html' });
  registerDevMode({ id: 'debug-viewshed', label: 'Radarskugga och flygrutter (debug/viewshed.html)', href: './debug/viewshed.html' });
  registerDevMode({ id: 'probe', label: 'Förhandsvisningstest (probe.html)', href: './probe.html' });
}
