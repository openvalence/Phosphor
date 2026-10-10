/**
 * live-sim.mjs -- a private native valencesim and the built page in front of
 * it, for the live suites. Test-only.
 *
 * Constraints:
 * - Random private ports and a throwaway --state; the sim is killed and its
 *   state removed on every exit path.
 * - The page's /uitoken is proxied to the sim's own mint: a token is good on
 *   the sim that minted it only.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIST_HTML } from './dist.mjs';

export const SIM = fileURLToPath(new URL('../../Nucleus/sim/valencesim/build/valencesim.exe', import.meta.url));

const answers = (port) => new Promise((resolve) => {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/');
  const t = setTimeout(() => { try { ws.close(); } catch (e) { /* */ } resolve(false); }, 1000);
  ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
  ws.onerror = () => { clearTimeout(t); resolve(false); };
});

/** A sim on a random port pair, homed unless `homed` is false: { port, http } once it answers, or null without the exe. Throws if it never answers. */
export async function startSim({ homed = true, extra = [] } = {}) {
  if (!existsSync(SIM)) return null;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const tmp = mkdtempSync(join(tmpdir(), 'live-sim-'));
  const sim = spawn(SIM, ['machine', ...(homed ? ['--homed'] : []), '--headless', '--no-mdns', '--no-discovery', '--no-estop-udp',
    '--duration', '900', '--port', String(port), '--http', String(port + 1), '--state', join(tmp, 'sim'), ...extra],
  { stdio: 'ignore', windowsHide: true });
  process.on('exit', () => { try { sim.kill(); } catch (e) { /* gone */ } rmSync(tmp, { recursive: true, force: true }); });
  for (let i = 0; i < 40; i++) {
    if (await answers(port)) return { port, http: port + 1 };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the sim on ' + port + ' never answered');
}

/** dist/index.html on an ephemeral port, /uitoken proxied to the sim's `http`; returns the page URL dialing `wsPort`. */
export async function serveBundle(wsPort, httpPort) {
  const html = readFileSync(DIST_HTML);
  const srv = createServer((q, s) => {
    if (!q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(html); return; }
    fetch('http://127.0.0.1:' + httpPort + '/uitoken').then(async (r) => {
      s.writeHead(r.status, { 'Content-Type': 'application/json' }); s.end(await r.text());
    }).catch(() => { s.writeHead(502); s.end('{}'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  return 'http://127.0.0.1:' + srv.address().port + '/?hub=127.0.0.1:' + wsPort;
}
