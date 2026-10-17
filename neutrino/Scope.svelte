<script>
  /**
   * Scope.svelte -- position and velocity over the last N seconds from the 1 ms samples, min and max per pixel
   * column so no sample is skipped; each lane scales to what the window holds (position at least 10 mm tall).
   * The window ends at the playhead's render instant (ring.js), and columns sit on a fixed time grid, so the
   * trace scrolls by the frame without shimmer. Pause freezes the window; the wheel or the span buttons zoom.
   */
  import { onMount } from 'svelte';
  import { before, idx, token } from './ring.js';
  import { onTheme } from '../src/model/theme.js';

  let { ring, play } = $props();
  const SPANS = [0.5, 1, 2, 5, 10, 30, 60];
  let span = $state(5);
  let paused = $state(false);
  let frozenT = 0, lastT = NaN;
  let canvas;

  function togglePause() {
    paused = !paused;
    if (paused) frozenT = lastT;
    play.wake();
  }
  function setSpan(s) {
    span = s;
    play.wake();
  }
  function wheel(e) {
    e.preventDefault();
    const i = SPANS.indexOf(span) + (e.deltaY > 0 ? 1 : -1);
    setSpan(SPANS[Math.max(0, Math.min(SPANS.length - 1, i))]);
  }

  onMount(() => {
    const ctx = canvas.getContext('2d');
    let c = {};
    let gen = 0, drawn = '', drawnAt = 0;
    const read = () => {
      c = { line: token('--line-1'), mut: token('--tx-ghost'), pos: token('--reality'), vel: token('--intent'), font: token('--mono') };
      gen++;
      play.wake();
    };
    read();
    const off = onTheme(() => requestAnimationFrame(read));
    const stop = play.onFrame((t) => {
      if (Number.isFinite(t)) lastT = t;
      // Frames while a change is in the window; at rest, a redraw a second catches a restarted ring.
      const moving = !paused && ring.moved >= t - span * 1e6;
      const key = [gen, span, paused, canvas.clientWidth, canvas.clientHeight, devicePixelRatio].join();
      const now = performance.now();
      if (!moving && key === drawn && now - drawnAt < 1000) return false;
      drawn = key;
      drawnAt = now;
      draw(ctx, c, paused ? frozenT : t);
      return moving;
    });
    return () => { stop(); off(); };
  });

  function lane(ctx, top, h, tStart, tEnd, i0, W, field, vlo, vhi, color) {
    const colUs = (tEnd - tStart) / W;
    const y = (v) => top + h - ((v - vlo) / (vhi - vlo)) * h;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    let col = NaN, mn = 0, mx = 0, first = true;
    const flush = () => {
      if (Number.isNaN(col)) return;
      const px = col * colUs <= tStart ? 0 : (col * colUs - tStart) / colUs;
      if (first) { ctx.moveTo(px, y(mn)); first = false; } else ctx.lineTo(px, y(mn));
      if (mx !== mn) ctx.lineTo(px, y(mx));
    };
    for (let i = Math.max(0, i0); i < ring.n; i++) {
      const k = idx(ring, i), t = ring.t[k];
      if (t > tEnd) break;
      const v = ring[field][k], cx = Math.floor(t / colUs);
      if (cx !== col) { flush(); col = cx; mn = mx = v; }
      else { if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    flush();
    ctx.stroke();
  }

  function draw(ctx, c, tEnd) {
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!ring.n || !Number.isFinite(tEnd)) return;
    const tStart = tEnd - span * 1e6;
    const i0 = before(ring, tStart);
    let vmax = 10, plo = Infinity, phi = -Infinity;
    for (let i = Math.max(0, i0); i < ring.n; i++) {
      const k = idx(ring, i);
      if (ring.t[k] > tEnd) break;
      vmax = Math.max(vmax, Math.abs(ring.v[k]));
      plo = Math.min(plo, ring.p[k]);
      phi = Math.max(phi, ring.p[k]);
    }
    const mid = (plo + phi) / 2, halfSpan = Math.max(5, (phi - plo) / 2) * 1.1;
    plo = mid - halfSpan;
    phi = mid + halfSpan;
    const half = (H - 18) / 2;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.font = '10px ' + (c.font || 'monospace');
    ctx.fillStyle = c.mut;
    for (let k = 0; k <= 5; k++) {
      const gx = Math.round((k / 5) * W) + 0.5;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H - 14); ctx.stroke();
      ctx.fillText('-' + (span * (1 - k / 5)).toFixed(span < 2 ? 1 : 0) + ' s', Math.min(W - 34, gx + 2), H - 3);
    }
    ctx.beginPath(); ctx.moveTo(0, half + 0.5); ctx.lineTo(W, half + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, half + half / 2 + 0.5); ctx.lineTo(W, half + half / 2 + 0.5); ctx.stroke();
    lane(ctx, 2, half - 4, tStart, tEnd, i0, W, 'p', plo, phi, c.pos);
    lane(ctx, half + 2, half - 4, tStart, tEnd, i0, W, 'v', -vmax, vmax, c.vel);
    ctx.fillStyle = c.pos;
    ctx.fillText('mm ' + plo.toFixed(0) + '..' + phi.toFixed(0), 4, 12);
    ctx.fillStyle = c.vel;
    ctx.fillText('mm/s ±' + Math.round(vmax), 4, half + 14);
  }
</script>

<div class="scope">
  <div class="bar">
    <span class="t">Scope</span>
    <div class="spans" role="group" aria-label="Span">
      {#each SPANS as s (s)}
        <button class="og-btn sm" class:on={span === s} onclick={() => setSpan(s)}>{s} s</button>
      {/each}
    </div>
    <button class="og-btn sm" class:on={paused} onclick={togglePause} data-tip={paused ? "Resume the scope (Space)" : "Freeze the scope (Space)"}>{paused ? 'Resume' : 'Pause'}</button>
  </div>
  <canvas bind:this={canvas} onwheel={wheel} aria-label="Position and velocity"></canvas>
</div>
<svelte:window onkeydown={(e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); togglePause(); } }} />

<style>
  .scope { display: flex; flex-direction: column; gap: var(--sp-2); }
  .bar { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
  .t { font-size: .78rem; color: var(--tx-mut); text-transform: uppercase; letter-spacing: .06em; margin-right: auto; }
  .spans { display: flex; gap: 2px; }
  .spans .og-btn { min-height: 28px; padding: 0 var(--sp-2); }
  .og-btn.on { border-color: var(--highlight); color: var(--highlight); }
  canvas { display: block; width: 100%; height: 260px; background: var(--bg-sunken); border: 1px solid var(--line-1); border-radius: var(--radius); }
</style>
