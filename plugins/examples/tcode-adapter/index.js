// tcode-adapter -- example tier-2 adapter plugin: RFC-044 rung 1, TCode
// passthrough as a CLIENT-SIDE adapter (docs/PLUGINS.md).
// Constraints:
// - The hub never sees TCode. Lines arrive from a loopback TCP listener the
//   shell opens (permission net.listen:<port>), are parsed here, and leave as
//   motion input through api.submitMotion, i.e. the model's intent path.
// - TCode timing is arrival-relative by definition ("reach X over I ms,
//   starting now"), so arrival time is the correct clock here, unlike a
//   streamed telemetry timeline. A burst collapses to the latest target at
//   the model's coalescing rate.
// - Only the L0 (stroke) axis. Other axes, S (speed) suffixes and device
//   commands (D*, $*) are ignored, never guessed at.
// - Port: 8000, the TCode network convention (MultiFunPlayer's default UDP
//   endpoint tcode.local:8000, matching the TCode ESP32 firmware). The
//   Valence spec pins no port; see RFC-061.

const DEFAULT_PORT = 8000;
const L0 = /^L0(\d{1,9})(?:([IS])(\d{1,9}))?$/i;

/**
 * Parse one TCode line into L0 samples.
 * Magnitude digits are a fraction: L05 = 0.5, L0500 = 0.5, L09999 = 0.9999.
 * @param {string} line
 * @returns {Array<{pos: number, durationMs: number|null}>}
 */
export function parseL0(line) {
  const out = [];
  for (const tok of String(line).trim().split(/\s+/)) {
    const m = L0.exec(tok);
    if (!m) continue;
    const pos = Number('0.' + m[1]);
    const durationMs = m[2] && m[2].toUpperCase() === 'I' ? Number(m[3]) : null;
    out.push({ pos, durationMs });
  }
  return out;
}

function portFrom(manifest) {
  for (const p of manifest.permissions || []) {
    const m = /^net\.listen:(\d+)$/.exec(p);
    if (m) return Number(m[1]);
  }
  return DEFAULT_PORT;
}

export function activate(api) {
  const port = portFrom(api.manifest);
  const stats = { lines: 0, samples: 0, refused: 0, lastReason: '' };
  let close = null;
  let closed = false;

  api.net.listenTcp(port, (line) => {
    stats.lines++;
    for (const s of parseL0(line)) {
      stats.samples++;
      const r = api.submitMotion(s.pos, s.durationMs);
      if (!r.ok) {
        stats.refused++;
        if (r.reason !== stats.lastReason) api.log('motion refused: ' + r.reason, 'warn');
        stats.lastReason = r.reason;
      } else {
        stats.lastReason = '';
      }
    }
  }).then((c) => {
    close = c;
    if (closed) c();
    else api.log('listening on 127.0.0.1:' + port);
  }).catch((e) => api.log('listen failed: ' + e.message, 'error'));

  api.registerSettings((el) => {
    const p = document.createElement('p');
    p.style.cssText = 'font-family: var(--mono); font-size: 12px; margin: 0;';
    const draw = () => {
      p.textContent = 'tcp 127.0.0.1:' + port + '  lines ' + stats.lines + '  L0 ' + stats.samples
        + '  refused ' + stats.refused + (stats.lastReason ? '  (' + stats.lastReason + ')' : '');
    };
    draw();
    el.append(p);
    const t = setInterval(draw, 1000);
    return () => { clearInterval(t); el.replaceChildren(); };
  });

  return () => {
    closed = true;
    if (close) close();
  };
}
