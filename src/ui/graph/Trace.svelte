<script>
  /**
   * Trace.svelte -- a small rolling history of values over the last few
   * seconds: a step line for the values, a tick at the bottom for each one that
   * arrived. Shared by the Scope node, the buttplug output nodes and the toy
   * modules.
   *
   * Constraints:
   * - Draws only when `ver` moves (a new value arrived) and only while on
   *   screen; there is no frame loop, so an idle trace costs nothing.
   * - The draw waits for the frame: its size and color reads, made as a view
   *   mounts, forced a style and layout pass of the whole page per trace.
   * - `read()` answers {pts: [[t, v]], now} on the clock of its points. Data is
   *   in model/trace.js; this file only paints it.
   */
  import { onMount } from 'svelte';
  import { SPAN_MS } from '../../model/trace.js';

  let { read, ver = 0, h = 36 } = $props();
  let cv;
  let visible = true;

  const css = (name, fallback) => (cv && getComputedStyle(cv).getPropertyValue(name).trim()) || fallback;

  function draw() {
    if (!cv || !visible) return;
    const { pts, now } = read();
    const w = cv.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (!pts.length || !w) return;
    const t0 = now - SPAN_MS;
    let first = 0;
    while (first + 1 < pts.length && pts[first + 1][0] <= t0) first++;
    const seen = pts.slice(first);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, v] of seen) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const x = (t) => Math.max(0, Math.min(w, ((t - t0) / SPAN_MS) * w));
    const y = (v) => h - 8 - ((v - lo) / (hi - lo)) * (h - 12);
    c.lineWidth = 1.5;
    c.strokeStyle = css('--reality', '#58f');
    c.beginPath();
    seen.forEach(([t, v], i) => {
      if (i === 0) c.moveTo(x(t), y(v));
      else { c.lineTo(x(t), y(seen[i - 1][1])); c.lineTo(x(t), y(v)); }
    });
    c.lineTo(w, y(seen[seen.length - 1][1]));
    c.stroke();
    c.strokeStyle = css('--ink-dim', '#888');
    c.lineWidth = 1;
    c.beginPath();
    for (const [t] of seen) if (t > t0) { c.moveTo(x(t) + 0.5, h - 5); c.lineTo(x(t) + 0.5, h - 1); }
    c.stroke();
  }

  let raf = 0;
  const queue = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  onMount(() => {
    const io = new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; queue(); });
    io.observe(cv);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  });
  $effect(() => { void ver; queue(); });
</script>

<canvas bind:this={cv} class="trace" style:height={h + 'px'} aria-hidden="true"></canvas>

<style>
  .trace { display: block; width: 100%; }
</style>
