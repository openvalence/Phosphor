<script>
  /**
   * Rail.svelte -- the rail to scale: travel, the stroke window, the carriage, the target, and the plan strip
   * (the next 128 ms of planned position, time running down). The carriage is drawn 40 ms behind the newest
   * 1 ms sample, so a 30 Hz snapshot cadence reads as continuous motion.
   */
  import { onMount } from 'svelte';
  import { before, idx, token } from './ring.js';
  import { onTheme } from '../src/model/theme.js';

  let { ring, snap } = $props();
  let canvas;
  const DELAY_US = 40000;

  function niceStep(span) {
    for (const s of [5, 10, 20, 25, 50, 100, 200, 250, 500]) if (span / s <= 12) return s;
    return 1000;
  }

  onMount(() => {
    const ctx = canvas.getContext('2d');
    let c = {};
    const read = () => {
      c = { line: token('--line-3'), mut: token('--tx-mut'), hi: token('--tx-hi'), reality: token('--reality'),
        intent: token('--intent'), hl: token('--highlight'), warn: token('--warn'), bad: token('--bad'), font: token('--mono') };
    };
    read();
    const off = onTheme(() => requestAnimationFrame(read));
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      draw(ctx, c);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); off(); };
  });

  function draw(ctx, c) {
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

    // Travel and ticks.
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x(0), yRail); ctx.lineTo(x(rail), yRail); ctx.stroke();
    ctx.fillStyle = c.mut;
    ctx.lineWidth = 1;
    const step = niceStep(rail);
    for (let t = 0; t <= rail + 1e-6; t += step) {
      ctx.beginPath(); ctx.moveTo(x(t), yRail + 6); ctx.lineTo(x(t), yRail + 11); ctx.stroke();
      ctx.fillText(String(t), x(t) - 8, yRail + 23);
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

    // The plan strip: x the planned position, y the time ahead.
    const p = snap.strip.p;
    const yS = yRail + 34, hS = Math.max(20, H - yS - 10);
    if (p.length > 1) {
      ctx.strokeStyle = c.intent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      p.forEach((mm, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x(mm), yS + (i / (p.length - 1)) * hS));
      ctx.stroke();
      ctx.fillStyle = c.mut;
      ctx.fillText('+' + p.length + ' ms', 4, yS + hS);
    }

    // Target, then the carriage at the display instant.
    ctx.fillStyle = c.intent;
    const tx = x(m.target);
    ctx.beginPath(); ctx.moveTo(tx, yRail - 18); ctx.lineTo(tx - 5, yRail - 26); ctx.lineTo(tx + 5, yRail - 26); ctx.fill();
    let pos = m.pos;
    if (ring.n) {
      const i = before(ring, ring.t[idx(ring, ring.n - 1)] - DELAY_US);
      if (i >= 0) pos = ring.p[idx(ring, i)];
    }
    ctx.fillStyle = m.estop ? c.bad : c.reality;
    ctx.fillRect(x(pos) - 7, yRail - 10, 14, 20);
    ctx.fillStyle = c.hi;
    ctx.fillText(pos.toFixed(1) + ' mm', Math.min(W - 70, Math.max(4, x(pos) - 24)), yRail - 30);

    // State words at the corner.
    const words = [m.estop ? 'E-STOP' : null, m.homing ? 'Homing' : m.homed ? null : 'Unhomed', m.paused ? 'Paused' : null].filter(Boolean);
    ctx.fillStyle = m.estop ? c.bad : c.warn;
    ctx.fillText(words.join('  '), 4, 12);
  }
</script>

<canvas bind:this={canvas} class="rail" aria-label="Rail"></canvas>

<style>
  .rail { display: block; width: 100%; height: 190px; background: var(--bg-sunken); border: 1px solid var(--line-1); border-radius: var(--radius); }
</style>
