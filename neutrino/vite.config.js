import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// The Neutrino dev tool's page: its own root and dist, Phosphor's src/ (tokens, themes, tip.js) by relative import.
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: here,
  plugins: [svelte({ configFile: fileURLToPath(new URL('../svelte.config.js', import.meta.url)) })],
  server: { watch: { ignored: ['**/src-tauri/**'] }, fs: { allow: ['..'] } },
  clearScreen: false,
  // The theme sheets ride the bundle as strings; one desktop page, no budget to split for.
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 100 * 1024, chunkSizeWarningLimit: 2048 },
});
