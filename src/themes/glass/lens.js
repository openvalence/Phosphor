/**
 * lens.js -- real edge refraction for small glass surfaces: an SVG displacement filter the CSS
 * names as `backdrop-filter: url(#ph-lens)` (theme.css, html[data-lens]). The technique is the
 * published one (a displacement map in a feImage, feDisplacementMap on the backdrop; no code
 * taken from a library): the map is drawn here from a refraction profile, no asset.
 *
 * Constraints:
 * - Chromium only (WebView2, Android WebView, Chrome). WebKit ignores url() in
 *   backdrop-filter: html[data-lens] is then never set and theme.css keeps its plain blur.
 * - Small bounded surfaces only (buttons, chips, pills, the caption lenses): the filter
 *   re-runs when what is behind changes, so it never goes on a card, a panel or a page layer.
 * - The map is stretched to the element's box and the filter works in shares of it (primitiveUnits
 *   objectBoundingBox): the bezel and the bend are a share of the width and of the height.
 * - The shell installs it (wallpaper.js); the served page keeps the plain blur.
 */
const W = 256;
const H = 96;
const BX = 0.16;
const BY = 0.38;

/** Bend strength 0 to 1 at a distance e (0 at the edge, 1 at the bezel's inner line): a convex lens, steep at the rim. */
const bend = (e) => (e >= 1 ? 0 : (1 - e) ** 2.4);

function mapUrl() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const dy = bend((1 - v) / BY) - bend(v / BY);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const dx = bend((1 - u) / BX) - bend(u / BX);
      const i = (y * W + x) * 4;
      img.data[i] = 128 + 127 * dx;
      img.data[i + 1] = 128 + 127 * dy;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function installLens() {
  const brands = navigator.userAgentData?.brands || [];
  if (!brands.some((b) => /Chromium/.test(b.brand)) || document.getElementById('ph-lens-defs')) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'ph-lens-defs';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
  svg.innerHTML = '<filter id="ph-lens" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">'
    + '<feImage href="' + mapUrl() + '" preserveAspectRatio="none" result="map"/>'
    + '<feDisplacementMap in="SourceGraphic" in2="map" scale="22" xChannelSelector="R" yChannelSelector="G"/></filter>';
  document.body.append(svg);
  document.documentElement.dataset.lens = '';
}
