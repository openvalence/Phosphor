// stroke-gauge -- example tier-2 widget plugin (docs/PLUGINS.md).
// Constraints:
// - One self-contained ES module: the shell imports it from a blob: URL, so
//   it has no relative imports. No framework.
// - Binds by ROLE only; draws nothing the model did not report.

const SVG = 'http://www.w3.org/2000/svg';
const STALE_MS = 1000;

export function activate(api) {
  api.registerHero({
    id: 'gauge',
    title: 'Stroke gauge',
    // Read-only: bind the window and travel fields without taking their
    // controls away from the generic tree.
    absorb: false,
    spec: {
      require: { pos: 'telemetry.position' },
      optional: {
        lo: 'window.min', hi: 'window.max',
        measured: 'geometry.measured_travel', maxTravel: 'geometry.max_travel',
      },
    },
    mount(el, fields) {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', '0 0 40 200');
      svg.setAttribute('width', '40');
      svg.setAttribute('height', '200');
      svg.setAttribute('role', 'img');
      const rail = document.createElementNS(SVG, 'rect');
      rail.setAttribute('x', '18'); rail.setAttribute('width', '4');
      rail.setAttribute('y', '0'); rail.setAttribute('height', '200');
      rail.setAttribute('fill', 'var(--line-2)');
      const band = document.createElementNS(SVG, 'rect');
      band.setAttribute('x', '12'); band.setAttribute('width', '16');
      band.setAttribute('fill', 'var(--intent)'); band.setAttribute('opacity', '0.35');
      const tick = document.createElementNS(SVG, 'rect');
      tick.setAttribute('x', '6'); tick.setAttribute('width', '28'); tick.setAttribute('height', '3');
      tick.setAttribute('fill', 'var(--reality)');
      svg.append(rail, band, tick);
      const label = document.createElement('div');
      label.style.cssText = 'font-family: var(--mono); font-size: 12px;';
      el.append(svg, label);

      // Full scale, the rail's order (RFC-041): measured travel, configured
      // max travel, then the window fields' own bound. None known: draw no
      // tick rather than invent a scale.
      const fullScale = () => {
        for (const f of [fields.measured, fields.maxTravel]) {
          const v = f ? api.value(f) : undefined;
          if (Number.isFinite(v) && v > 0) return v;
        }
        return fields.hi && Number.isFinite(fields.hi.max) && fields.hi.max > 0 ? fields.hi.max : null;
      };

      return {
        update() {
          const span = fullScale();
          const y = (v) => 200 - (v / span) * 200;
          const p = span ? api.value(fields.pos) : undefined;
          const lo = fields.lo ? api.value(fields.lo) : undefined;
          const hi = fields.hi ? api.value(fields.hi) : undefined;
          const known = Number.isFinite(p);
          tick.style.display = known ? '' : 'none';
          if (known) tick.setAttribute('y', String(Math.min(197, Math.max(0, y(p) - 1.5))));
          const haveWin = span && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
          band.style.display = haveWin ? '' : 'none';
          if (haveWin) {
            band.setAttribute('y', String(y(hi)));
            band.setAttribute('height', String(y(lo) - y(hi)));
          }
          const stale = api.age(fields.pos) > STALE_MS;
          svg.style.opacity = stale ? '0.4' : '1';
          const raw = api.value(fields.pos);
          label.textContent = Number.isFinite(raw)
            ? raw.toFixed(1) + (fields.pos.unit ? ' ' + fields.pos.unit : '') + (stale ? ' (stale)' : '')
            : '--';
        },
        unmount() { el.replaceChildren(); },
      };
    },
  });
}
