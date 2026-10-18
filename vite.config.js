import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vite builds the single-file HTML bundle (JS/CSS/fonts inlined).
 *
 * The shipped artifact is ONE file, dist/index.html — separately-emitted
 * asset files never reach a device flash pipeline. So the self-hosted WOFF2
 * fonts MUST be inlined as base64 data URIs. assetsInlineLimit is raised
 * above the largest subsetted font (~21KB for MartianMono.woff2) so Vite
 * emits them inline rather than as separate files. 100KB gives comfortable
 * headroom.
 *
 * `npm run build` emits BOTH dist/index.html and dist/index.html.gz. The gz
 * is what a gzip-serving hub consumes; producing it here means a plain
 * `npm run build` is enough for anything that wants the shipped artifact,
 * with no device-side build step in the loop.
 *
 * SVELTE 5: the plugin is pinned to the v4 line because it is the last one
 * that peers against Vite 5, and vite-plugin-singlefile is tuned to Vite 5's
 * asset emission. Svelte compiles to direct DOM operations, so the
 * framework's runtime cost on a flash-served page stays small.
 */

// UI bundle build identifier — the footer "ui" chip (§1.6h). Short git hash
// when available (matches how the firmware's own fw_version tracks commits);
// falls back to a UTC build timestamp in a repo-less checkout so the chip is
// never a hand-maintained literal.
function uiBuildId() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch (e) {
    return 'b' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  }
}

/**
 * Emit dist/index.html.gz beside the bundle. `writeBundle` rather than
 * `closeBundle` so the HTML is on disk already; singlefile inlines everything
 * into that one file, so there is nothing else to compress.
 */
function emitGzip() {
  return {
    name: 'emit-index-gzip',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir || resolve(__dirname, 'dist');
      const html = resolve(dir, 'index.html');
      const gz = html + '.gz';
      writeFileSync(gz, gzipSync(readFileSync(html), { level: 9 }));
      const raw = statSync(html).size, small = statSync(gz).size;
      console.log(`index.html.gz  ${small} B (${Math.round((small * 100) / raw)}% of ${raw} B)`);
    },
  };
}

/**
 * The demo build's factory (src/plugins/factory-demo.js) in place of the full one, for plugins.svelte.js's
 * import only: no other plugin's code reaches the demo bundle.
 */
function demoFactory() {
  const demo = fileURLToPath(new URL('./src/plugins/factory-demo.js', import.meta.url));
  return {
    name: 'demo-factory',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './factory.js' && importer && importer.replace(/\\/g, '/').endsWith('/src/plugins/plugins.svelte.js')) return demo;
    },
  };
}

/**
 * The web builds fetch Neutrino as a .wasm file beside the page (a third smaller over the wire than the base64
 * string the bundles inline): src/model/neutrino/bytes.js becomes a WASM promise of its bytes there.
 */
function wasmAsset() {
  const bytes = fileURLToPath(new URL('./src/model/neutrino/bytes.js', import.meta.url)).replace(/\\/g, '/');
  return {
    name: 'neutrino-wasm-asset',
    load(id) {
      if (id.replace(/\\/g, '/') !== bytes) return null;
      const b64 = /'([A-Za-z0-9+/=]+)'/.exec(readFileSync(id, 'utf8'))[1];
      const ref = this.emitFile({ type: 'asset', name: 'neutrino.wasm', source: Buffer.from(b64, 'base64') });
      return `export const WASM = fetch(import.meta.ROLLUP_FILE_URL_${ref}).then((r) => { if (!r.ok) throw new Error('neutrino.wasm ' + r.status); return r.arrayBuffer(); });`;
    },
  };
}

// The web builds (`--mode web`, `--mode demo`; src/web/web.js): ordinary code-split pages with relative URLs, in
// dist-web/ and dist-demo/, for any static host under any path. Every other build is the single-file bundle.
export default defineConfig(({ mode }) => {
  const web = mode === 'web' || mode === 'demo';
  return {
    base: web ? './' : '/',
    plugins: web ? [svelte(), wasmAsset(), ...(mode === 'demo' ? [demoFactory()] : [])] : [svelte(), viteSingleFile(), emitGzip()],
    // The built-in machine's worker is ES (neutrino.js is an ES module) and inlined (?worker&inline): one file.
    worker: { format: 'es' },
    define: {
      __UI_BUILD__: JSON.stringify(uiBuildId()),
    },
    build: web ? { outDir: 'dist-' + mode, minify: 'esbuild' } : {
      cssCodeSplit: false,
      minify: 'esbuild',
      assetsInlineLimit: 100 * 1024, // 100KB — fonts (~21KB max) inline as data URIs
    },
    server: {
      // src-tauri/target is cargo's build dir — watching it EBUSY-crashes vite
      // on Windows when cargo holds a build-script exe open.
      watch: { ignored: ['**/src-tauri/**'] },
      // The Valence JS client lives in the SIBLING checkout, outside this repo.
      // Rollup follows the relative import fine, but the dev server refuses to
      // serve anything outside its workspace root (403, not an import error), so
      // the sibling has to be allowed explicitly or `npm run dev` never boots.
      fs: { allow: ['..'] },
    },
    // TAURI_ENV_* exists only when the Tauri CLI drives the build — main.js's
    // shell branch keys on it, so the embedded bundle dead-code-eliminates the
    // entire shell path (delivery accord: divergence is build config, not code).
    envPrefix: ['VITE_', 'TAURI_ENV_'],
  };
});