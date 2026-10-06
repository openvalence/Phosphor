// The build the browser suites load, and where their default evidence lands.
// PHOSPHOR_DIST=<dir> points a run at another build (`npm run build:only -- --outDir <dir>`);
// that run's evidence goes to <dir>/evidence so two runs in one checkout never write one file.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALT = process.env.PHOSPHOR_DIST;
export const DIST_HTML = ALT ? join(resolve(ALT), 'index.html') : fileURLToPath(new URL('../dist/index.html', import.meta.url));
export const EVIDENCE = ALT ? join(resolve(ALT), 'evidence') : fileURLToPath(new URL('./evidence', import.meta.url));
