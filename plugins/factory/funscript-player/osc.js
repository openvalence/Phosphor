// osc.js -- the script's oscillator axes to the hub's osc.drive STREAM (SPEC 9.7); the only caller of api.submitSamples
// Contract: CONTRACT.md, module osc (ph-6dr6); design: docs/plugins/FUNSCRIPT.md, Multi-axis.
//
// Constraints:
// - Bound by the channel role only, never a name or id. OSC_ROLE restates registry channel_roles (a plugin
//   imports nothing outside its folder); the role fixes the layout: amplitude then frequency, f32 0..1.
// - Wired by default (operator 2026-10-09): a script with V8 or V9 publishes whenever the hub offers the
//   role. An axis the script lacks rides 0.
// - Writes nothing else of the oscillator, osc.enabled included: a live stream renders by itself and the
//   hub hands back to the card's values when it goes quiet (RFC-110 items 1, 2).
// - The rate is the grant's; the actions are interpolated linearly to it.
// - One lead (RFC-110 item 4): each point is stamped at the instant it describes (the caller's mediaAt is
//   the plain display map, the user's offset its only trim, never the latency or the main axis's
//   compensation) and sent between the grant's latency plus OSC_FLOOR_MS (transport and clock error) and
//   plus OSC_MARGIN_MS ahead, never past OSC_CAP_MS (the 250 ms lead cap less clock error). A point nearer
//   than that is never sent.
// - Without mediaAt (pause, seek, stop, Motion off) nothing is sent and the stream goes quiet. Points
//   already sent run out; a restart continues after them.

import { posAt, OSC_AXES } from './funscript.js';

export const OSC_ROLE = 'osc.drive', OSC_FLOOR_MS = 20, OSC_MARGIN_MS = 70, OSC_CAP_MS = 230, NO_STREAM = 'NO_STREAM';

export const hasOsc = (script) => !!(script && script.axes && OSC_AXES.some((id) => script.axes[id]));

/** {atMs, values: [amplitude, frequency]} every stepMs over [fromMs, untilMs] wall ms, at script time mediaAt(atMs). */
export function oscSamples(axes, fromMs, stepMs, untilMs, mediaAt) {
  const out = [];
  for (let w = fromMs; w <= untilMs; w += stepMs) {
    const m = mediaAt(w);
    if (!Number.isFinite(m)) break;
    out.push({ atMs: w, values: OSC_AXES.map((id) => (axes[id] ? posAt(axes[id], m) : 0)) });
  }
  return out;
}

/** submit(list) is api.submitSamples bound to OSC_ROLE. */
export function createOsc({ submit, now = () => performance.now() }) {
  let next = null, absent = false;
  return {
    /** The script has oscillator axes and the hub offers no osc.drive. */
    get absent() { return absent; },
    /** Once per frame: mediaAt while the main axis plays, else null. */
    tick(script, mediaAt) {
      if (!hasOsc(script)) { absent = false; return; }
      let r = submit([]);
      absent = r.reason === NO_STREAM;
      if (!mediaAt || !r.ok || !(r.rateHz > 0)) return;
      const p = now(), step = 1000 / r.rateHz, lat = r.latencyMs || 0;
      let list = oscSamples(script.axes, Math.max(p + lat + OSC_FLOOR_MS, next ?? -Infinity), step,
        p + Math.max(lat + OSC_FLOOR_MS, Math.min(lat + OSC_MARGIN_MS, OSC_CAP_MS)), mediaAt);
      while (list.length) {
        r = submit(list);
        if (!r.ok || !r.sent) break;
        next = list[r.sent - 1].atMs + step;
        list = list.slice(r.sent);
      }
    },
  };
}
