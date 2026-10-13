import { defineConfig } from 'vite';

// Portable build (docs/DECISIONS.md, M00b): relative base so the same files work from any folder
// (Claude Artifact version folder, a static server under /x/y/, or the site root).
// Pages: the game (index.html), the preview probe (probe.html), the data map (debug/data.html, M01) and the simulation hashes (debug/sim.html, M03).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
    rolldownOptions: {
      input: { main: 'index.html', probe: 'probe.html', debugData: 'debug/data.html', debugSim: 'debug/sim.html' },
    },
  },
  // Module workers stay ES modules (they import shared chunks from assets/).
  worker: { format: 'es' },
});
