/**
 * audit.mjs -- the in-page WCAG text audit the theme suites share. Serialized
 * into the page by page.evaluate(lowContrast, arg): self-contained, no imports.
 *
 * Every element with its own text under `sel`, its color blended by its ancestors'
 * opacity over the first opaque background behind it. Inactive controls are exempt
 * (WCAG 1.4.3), and so are a stale value (law 8) and a superseded log row, both dimmed on purpose. Returns the
 * failures in words. `[sel, floor]` holds every match to one floor instead (3 for
 * chrome keys); `[sel, 3, true]` also takes matches with no text of their own
 * (icons, drawn in their color). Colors parse from rgb(), color(srgb), oklab() and oklch().
 */
export const lowContrast = (arg) => {
  const [sel, floor, glyph] = Array.isArray(arg) ? arg : [arg, 0, false];
  // rgb(), color(srgb), and oklab() and oklch() (a color-mix() in those spaces computes to them), as sRGB 0..255.
  const parse = (c) => { const m = /(rgba?|color|oklab|oklch)\(([^)]+)\)/.exec(c); if (!m || (m[1] === 'color' && !/^srgb\s/.test(m[2]))) return null;
    const p = m[2].replace(/^srgb\s+/, '').split(/[\s,/]+/).filter(Boolean);
    const n = (v, pct) => (v === 'none' ? 0 : v.endsWith('%') ? parseFloat(v) / 100 * pct : parseFloat(v));
    const a = p.length > 3 ? n(p[3], 1) : 1;
    if (m[1] !== 'oklab' && m[1] !== 'oklch') { const k = m[1] === 'color' ? 255 : 1; return [n(p[0], 1) * k, n(p[1], 1) * k, n(p[2], 1) * k, a]; }
    const L = n(p[0], 1), C = m[1] === 'oklch' ? n(p[1], .4) : 0, h = m[1] === 'oklch' ? n(p[2], 1) * Math.PI / 180 : 0;
    const A = m[1] === 'oklab' ? n(p[1], .4) : C * Math.cos(h), B = m[1] === 'oklab' ? n(p[2], .4) : C * Math.sin(h);
    const l = (L + .3963377774 * A + .2158037573 * B) ** 3, q = (L - .1055613458 * A - .0638541728 * B) ** 3, s = (L - .0894841775 * A - 1.291485548 * B) ** 3;
    const g = (v) => 255 * Math.min(1, Math.max(0, v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055));
    return [g(4.0767416621 * l - 3.3077115913 * q + .2309699292 * s), g(-1.2684380046 * l + 2.6097574011 * q - .3413193965 * s),
      g(-.0041960863 * l - .7034186147 * q + 1.707614701 * s), a]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor);
    if (c && c[3] > 0.5) return c; } return parse(getComputedStyle(document.documentElement).backgroundColor) || [0, 0, 0, 1]; };
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!glyph && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('[disabled], .is-disabled, [aria-disabled="true"], .typeable.disabled, .sr-only, .stale, .superseded')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || !el.getClientRects().length) continue;
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    if (o < 0.05) continue;
    const fg = parse(cs.color), bg = bgOf(el), a = fg[3] * o;
    const l1 = lum([0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const need = floor || (px >= 24 || (Number(cs.fontWeight) >= 700 && px >= 18.66) ? 3 : 4.5);
    if (ratio < need) out.push((el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2));
  }
  return out;
};

/**
 * The same audit over a see-through window: `[sel, backdrop]` with backdrop as [r, g, b]
 * (what the OS material shows). Every ancestor's background is composited over it, from the
 * root down, so a 82% tint over black and over #3A3A3A each get their own ratio. Serialized
 * into the page like lowContrast: self-contained.
 */
export const lowContrastOver = ([sel, backdrop]) => {
  // rgb(), color(srgb), and oklab() and oklch() (a color-mix() in those spaces computes to them), as sRGB 0..255.
  const parse = (c) => { const m = /(rgba?|color|oklab|oklch)\(([^)]+)\)/.exec(c); if (!m || (m[1] === 'color' && !/^srgb\s/.test(m[2]))) return null;
    const p = m[2].replace(/^srgb\s+/, '').split(/[\s,/]+/).filter(Boolean);
    const n = (v, pct) => (v === 'none' ? 0 : v.endsWith('%') ? parseFloat(v) / 100 * pct : parseFloat(v));
    const a = p.length > 3 ? n(p[3], 1) : 1;
    if (m[1] !== 'oklab' && m[1] !== 'oklch') { const k = m[1] === 'color' ? 255 : 1; return [n(p[0], 1) * k, n(p[1], 1) * k, n(p[2], 1) * k, a]; }
    const L = n(p[0], 1), C = m[1] === 'oklch' ? n(p[1], .4) : 0, h = m[1] === 'oklch' ? n(p[2], 1) * Math.PI / 180 : 0;
    const A = m[1] === 'oklab' ? n(p[1], .4) : C * Math.cos(h), B = m[1] === 'oklab' ? n(p[2], .4) : C * Math.sin(h);
    const l = (L + .3963377774 * A + .2158037573 * B) ** 3, q = (L - .1055613458 * A - .0638541728 * B) ** 3, s = (L - .0894841775 * A - 1.291485548 * B) ** 3;
    const g = (v) => 255 * Math.min(1, Math.max(0, v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055));
    return [g(4.0767416621 * l - 3.3077115913 * q + .2309699292 * s), g(-1.2684380046 * l + 2.6097574011 * q - .3413193965 * s),
      g(-.0041960863 * l - .7034186147 * q + 1.707614701 * s), a]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bgOf = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.unshift(e);
    let out = backdrop.slice();
    for (const e of chain) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) out = out.map((v, i) => c[i] * c[3] + v * (1 - c[3]));
    }
    return out;
  };
  const found = [];
  for (const el of document.querySelectorAll(sel)) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('[disabled], .is-disabled, [aria-disabled="true"], .typeable.disabled, .sr-only, .stale, .superseded, #ph-tip')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || !el.getClientRects().length) continue;
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    if (o < 0.05) continue;
    const fg = parse(cs.color), bg = bgOf(el), a = fg[3] * o;
    const l1 = lum([0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const need = px >= 24 || (Number(cs.fontWeight) >= 700 && px >= 18.66) ? 3 : 4.5;
    if (ratio < need) found.push((el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2));
  }
  return found;
};
