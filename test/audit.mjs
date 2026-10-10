/**
 * audit.mjs -- the in-page WCAG text audit the theme suites share. Serialized
 * into the page by page.evaluate(lowContrast, arg): self-contained, no imports.
 *
 * Every element with its own text under `sel`, its color blended by its ancestors'
 * opacity over the first opaque background behind it. Inactive controls are exempt
 * (WCAG 1.4.3), and so are a stale value (law 8) and a superseded log row, both dimmed on purpose. Returns the
 * failures in words. `[sel, floor]` holds every match to one floor instead (3 for
 * chrome keys); `[sel, 3, true]` also takes matches with no text of their own
 * (icons, drawn in their color).
 */
export const lowContrast = (arg) => {
  const [sel, floor, glyph] = Array.isArray(arg) ? arg : [arg, 0, false];
  const parse = (c) => { const s = /color\(srgb ([^)]+)\)/.exec(c); const m = s || /rgba?\(([^)]+)\)/.exec(c); if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); const k = s ? 255 : 1;
    return [p[0] * k, p[1] * k, p[2] * k, p.length > 3 ? p[3] : 1]; };
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
  const parse = (c) => { const s = /color\(srgb ([^)]+)\)/.exec(c); const m = s || /rgba?\(([^)]+)\)/.exec(c); if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); const k = s ? 255 : 1;
    return [p[0] * k, p[1] * k, p[2] * k, p.length > 3 ? p[3] : 1]; };
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
