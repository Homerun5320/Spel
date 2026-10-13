// The registered `?` modes of the app (see devpanel.ts). Every later milestone that adds a `?` mode (scene, scenario, view,
// debug pages, seed) registers it here, so the Dev panel always lists everything the address bar could do.
import { registerDevMode } from './devpanel';

export function registerAppModes(): void {
  registerDevMode({ id: 'perf', label: 'Prestanda (perf)', params: { perf: '1' }, toggle: true });
  registerDevMode({ id: 'test', label: 'Testläge (fast bild)', params: { test: '1' }, toggle: true });
  registerDevMode({ id: 'scene-spike', label: 'Scen: M00-spiken', params: { scene: 'spike' } });
  registerDevMode({ id: 'scene-globe', label: 'Scen: jorden', params: { scene: 'globe' } });
  registerDevMode({ id: 'quality-low', label: 'Kvalitet: låg', params: { quality: 'low' } });
  registerDevMode({ id: 'quality-medium', label: 'Kvalitet: medel', params: { quality: 'medium' } });
  registerDevMode({ id: 'quality-high', label: 'Kvalitet: hög', params: { quality: 'high' } });
  registerDevMode({ id: 'seed-7', label: 'Seed 7', params: { seed: '7' } });
  registerDevMode({ id: 'debug-data', label: 'Datakartan (debug/data.html)', href: './debug/data.html' });
  registerDevMode({ id: 'debug-data-height', label: 'Datakartan: höjd', href: './debug/data.html#map-height' });
  registerDevMode({ id: 'debug-data-country', label: 'Datakartan: länder', href: './debug/data.html#map-country' });
}
