// osc.js -- the script's oscillator axes to the hub's osc.drive STREAM (SPEC 9.7); the only caller of api.submitSamples
// Contract: CONTRACT.md, module osc (ph-6dr6); design: docs/plugins/FUNSCRIPT.md, Multi-axis.
//
// Constraints:
// - Bound by the channel role only, never a name or id. OSC_ROLE restates registry channel_roles (a plugin
//   imports nothing outside its folder); the role fixes the layout: amplitude then frequency, f32 0..1.
// - Wired by default (operator 2026-10-09): a script with V8 or V9 publishes whenever the hub offers the
//   role. An axis the script lacks rides 0, what a quiet stream reads (SPEC 9.7).
// - Nothing else of the oscillator is driven from a script: no enable, shape, bounds or drive (SPEC 9.7).
// - The rate is the grant's (SegResult-shaped rateHz); the actions are interpolated linearly to it.
// - A sample describes the instant the main axis plays the same media time: mediaAt(wall ms) is the caller's
//   map, offset and compensation included; the host subtracts the grant's schedule_latency_us.
// - Sent OSC_LEAD_MS ahead, half the samples lead cap (SPEC 5.4), refilled once under half of it.
// - Without mediaAt (pause, seek, stop, Motion off) nothing is sent and the hub's quiet release ends the
//   oscillation (stream_quiet_release_ms). Samples already sent run out; a restart continues after them.

import { posAt, OSC_AXES } from './funscript.js';

export const OSC_ROLE = 'osc.drive', OSC_LEAD_MS = 100, NO_STREAM = 'NO_STREAM';

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
      const p = now();
      if (mediaAt && next != null && next > p + OSC_LEAD_MS / 2) return;
      let r = submit([]);
      absent = r.reason === NO_STREAM;
      if (!mediaAt || !r.ok || !(r.rateHz > 0)) return;
      const step = 1000 / r.rateHz;
      let list = oscSamples(script.axes, Math.max(p, next ?? p), step, p + OSC_LEAD_MS, mediaAt);
      while (list.length) {
        r = submit(list);
        if (!r.ok || !r.sent) break;
        next = list[r.sent - 1].atMs + step;
        list = list.slice(r.sent);
      }
    },
  };
}
