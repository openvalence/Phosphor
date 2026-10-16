<script>
  /**
   * Rail.svelte -- the rail to scale: travel, the stroke window, the carriage, the target, and the plan strip
   * (the next 128 ms from the render instant, time running down). Every frame draws the 1 ms samples at the
   * playhead's render instant (ring.js createPlayhead), so motion is as smooth as the display's refresh.
   * Motion blur is a shutter: the carriage's coverage of each pixel column over the last `shutter` degrees of
   * the frame interval, from the samples in that span, shown through a square-root tone curve.
   */
  import { onMount } from 'svelte';
  import { before, idx, sampleAt, token } from './ring.js';
  import { onTheme } from '../src/model/theme.js';

  let { ring, play, snap } = $props();
  let canvas;
  const SHUTTERS = [0, 180, 360];
  const KEY = 'neutrino.blur';
  let shutter = $state(0);
  try { const v = Number(localStorage.getItem(KEY)); if (SHUTTERS.includes(v)) shutter = v; } catch { /* storage off: blur off */ }
  function setShutter(v) {
    shutter = v;
    try { localStorage.setItem(KEY, String(v)); } catch { /* not remembered */ }
    play.wake();
  }

  const CAR_W = 14, CAR_H = 20;

  function niceStep(span) {
    for (const s of [5, 10, 20, 25, 50, 100, 200, 250, 500]) if (span / s <= 12) return s;
    return 1000;
  }

  onMount(() => {
    const ctx = canvas.getContext('2d');
    let c = {}, gen = 0, drawn = '';
    const rgb = (k) => token(k).split(',').map(Number);
    const read = () => {
      c = { line: token('--line-3'), mut: token('--tx-mut'), hi: token('--tx-hi'), reality: token('--reality'),
        intent: token('--intent'), hl: token('--highlight'), warn: token('--warn'), bad: token('--bad'), font: token('--mono'),
        realityRgb: rgb('--reality-rgb'), badRgb: rgb('--bad-rgb') };
      gen++;
      play.wake();
    };
    read();
    const off = onTheme(() => requestAnimationFrame(read));
    const stop = play.onFrame((t, frameMs) => {
      const expUs = (shutter / 360) * frameMs * 1000;
      // Frames while the samples in view still change: the shutter span behind, the strip's 128 ms ahead.
      const moving = ring.moved >= t - expUs - 1000;
      const m = snap && snap.m;
      const key = m ? [gen, shutter, canvas.clientWidth, canvas.clientHeight, devicePixelRatio, m.rail, m.wmin, m.wmax, m.target,
        m.estop, m.homing, m.homed, m.paused, m.pos, snap.strip.p.length].join() : 'none' + gen;
      if (!moving && key === drawn) return false;
      drawn = key;
      draw(ctx, c, t, expUs);
      return moving;
    });
    return () => { stop(); off(); };
  });

  // The swept coverage, per device-pixel column: Float64 difference array, then one RGBA row stretched to the carriage.
  let cov = new Float64Array(0), row = null, rowCanvas = null;
  const pt = {};
  function smear(ctx, t, expUs, xDev, yTop, hDev, rgbc) {
    const W = ctx.canvas.width;
    if (cov.length !== W + 2) {
      cov = new Float64Array(W + 2);
      rowCanvas = document.createElement('canvas');
      rowCanvas.width = W; rowCanvas.height = 1;
      row = rowCanvas.getContext('2d').createImageData(W, 1);
    }
    cov.fill(0);
    const half = (CAR_W * devicePixelRatio) / 2;
    let lo = W, hi = 0;
    const add = (xc, w) => {
      const a = Math.max(0, Math.min(W, Math.round(xc - half))), b = Math.max(0, Math.min(W, Math.round(xc + half)));
      cov[a] += w; cov[b] -= w;
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    };
    let ta = t - expUs, xa = xDev(sampleAt(ring, ta, pt).p);
    let i = before(ring, ta) + 1;
    for (;;) {
      const k = i < ring.n ? idx(ring, i) : -1;
      const last = k < 0 || ring.t[k] >= t;
      const tb = last ? t : ring.t[k], xb = last ? xDev(sampleAt(ring, t, pt).p) : xDev(ring.p[k]);
      const steps = Math.max(1, Math.ceil(Math.abs(xb - xa))), w = (tb - ta) / expUs / steps;
      for (let s = 0; s < steps; s++) add(xa + ((xb - xa) * (s + 0.5)) / steps, w);
      if (last) break;
      ta = tb; xa = xb; i++;
    }
    if (hi <= lo) return;
    const d = row.data;
    let acc = 0;
    for (let x = lo; x < hi; x++) {
      acc += cov[x];
      const o = x * 4;
      d[o] = rgbc[0]; d[o + 1] = rgbc[1]; d[o + 2] = rgbc[2];
      d[o + 3] = 255 * Math.sqrt(Math.min(1, Math.max(0, acc)));
    }
    rowCanvas.getContext('2d').putImageData(row, 0, 0, lo, 0, hi - lo, 1);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rowCanvas, lo, 0, hi - lo, 1, lo, yTop, hi - lo, hDev);
    ctx.restore();
  }

  const at = {};
  function draw(ctx, c, t, expUs) {
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ' + (c.font || 'monospace');
    if (!snap) {
      ctx.fillStyle = c.mut;
      ctx.fillText('Waiting for the dev channel', 12, 24);
      return;
    }
    const m = snap.m;
    const rail = m.rail > 0 ? m.rail : 100;
    const lo = -0.05 * rail, hi = rail * 1.05, pad = 16;
    const x = (mm) => pad + ((mm - lo) / (hi - lo)) * (W - 2 * pad);
    const yRail = 46;
    const live = ring.n > 0 && Number.isFinite(t);

    // Travel and ticks.
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x(0), yRail); ctx.lineTo(x(rail), yRail); ctx.stroke();
    ctx.fillStyle = c.mut;
    ctx.lineWidth = 1;
    const step = niceStep(rail);
    for (let s = 0; s <= rail + 1e-6; s += step) {
      ctx.beginPath(); ctx.moveTo(x(s), yRail + 6); ctx.lineTo(x(s), yRail + 11); ctx.stroke();
      ctx.fillText(String(s), x(s) - 8, yRail + 23);
    }
    // Rail ends: the hard limits.
    ctx.fillStyle = c.bad;
    for (const e of [0, rail]) ctx.fillRect(x(e) - 1.5, yRail - 16, 3, 32);

    // The stroke window.
    if (m.wmax > m.wmin) {
      ctx.fillStyle = c.reality;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x(m.wmin), yRail - 14, x(m.wmax) - x(m.wmin), 28);
      ctx.globalAlpha = 1;
    }

    // The plan strip from the render instant: the samples already received, then the published plan (1 ms apart from t0).
    const sp = snap.strip.p, t0 = snap.strip.t0;
    const yS = yRail + 34, hS = Math.max(20, H - yS - 10), N = 128;
    if (live && sp.length > 1) {
      const newest = ring.t[idx(ring, ring.n - 1)];
      ctx.strokeStyle = c.intent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < N; k++) {
        const tk = t + k * 1000;
        let mm;
        if (tk <= newest) mm = sampleAt(ring, tk, at).p;
        else {
          const u = Math.max(0, (tk - t0) / 1000);
          if (u > sp.length - 1) break;
          const j = Math.floor(u);
          mm = j + 1 < sp.length ? sp[j] + (sp[j + 1] - sp[j]) * (u - j) : sp[j];
        }
        (k ? ctx.lineTo : ctx.moveTo).call(ctx, x(mm), yS + (k / (N - 1)) * hS);
      }
      ctx.stroke();
      ctx.fillStyle = c.mut;
      ctx.fillText('+' + N + ' ms', 4, yS + hS);
    }

    // Target, then the carriage at the render instant.
    ctx.fillStyle = c.intent;
    const tx = x(m.target);
    ctx.beginPath(); ctx.moveTo(tx, yRail - 18); ctx.lineTo(tx - 5, yRail - 26); ctx.lineTo(tx + 5, yRail - 26); ctx.fill();
    const pos = live ? sampleAt(ring, t, at).p : m.pos;
    if (live && expUs > 0) {
      smear(ctx, t, expUs, (mm) => x(mm) * dpr, Math.round((yRail - CAR_H / 2) * dpr), Math.round(CAR_H * dpr), m.estop ? c.badRgb : c.realityRgb);
      ctx.strokeStyle = m.estop ? c.bad : c.reality;
      ctx.strokeRect(x(pos) - CAR_W / 2 + 0.5, yRail - CAR_H / 2 + 0.5, CAR_W - 1, CAR_H - 1);
    } else {
      ctx.fillStyle = m.estop ? c.bad : c.reality;
      ctx.fillRect(x(pos) - CAR_W / 2, yRail - CAR_H / 2, CAR_W, CAR_H);
    }
    ctx.fillStyle = c.hi;
    ctx.fillText(pos.toFixed(1) + ' mm', Math.min(W - 70, Math.max(4, x(pos) - 24)), yRail - 30);

    // State words at the corner.
    const words = [m.estop ? 'E-STOP' : null, m.homing ? 'Homing' : m.homed ? null : 'Unhomed', m.paused ? 'Paused' : null].filter(Boolean);
    ctx.fillStyle = m.estop ? c.bad : c.warn;
    ctx.fillText(words.join('  '), 4, 12);
  }
</script>

<div class="rail-wrap">
  <div class="rail-bar">
    <span class="t">Rail</span>
    <div class="spans" role="group" aria-label="Motion blur">
      <span class="lbl">Blur</span>
      {#each SHUTTERS as s (s)}
        <button class="og-btn sm" class:on={shutter === s} onclick={() => setShutter(s)}
          data-tip={s === 180 ? 'Shutter open half of each frame' : s === 360 ? 'Shutter open the whole frame' : undefined}>{s ? s + '°' : 'Off'}</button>
      {/each}
    </div>
  </div>
  <canvas bind:this={canvas} class="rail" aria-label="Rail"></canvas>
</div>

<style>
  .rail-wrap { display: flex; flex-direction: column; gap: var(--sp-2); }
  .rail-bar { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
  .t { font-size: .78rem; color: var(--tx-mut); text-transform: uppercase; letter-spacing: .06em; margin-right: auto; }
  .spans { display: flex; gap: 2px; align-items: center; }
  .lbl { font-size: .74rem; color: var(--tx-mut); margin-right: var(--sp-1); }
  .spans .og-btn { min-height: 28px; padding: 0 var(--sp-2); }
  .og-btn.on { border-color: var(--highlight); color: var(--highlight); }
  .rail { display: block; width: 100%; height: 190px; background: var(--bg-sunken); border: 1px solid var(--line-1); border-radius: var(--radius); }
</style>
