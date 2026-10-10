/**
 * place.js -- where the wallpaper layer's image sits, as arithmetic (docs/THEMES.md, the wallpaper
 * layer). Pure: no DOM, so the node check (place.check.mjs) runs it.
 *
 * Constraints:
 * - Input is what src-tauri/src/wallpaper.rs answers: physical-pixel rectangles of the monitor and
 *   of the window's client area, the monitor's scale, the fit mode; plus the image's pixel size.
 * - Output is CSS pixels relative to the window's client area. The layer is the MONITOR's box
 *   moved by (monitor - window), painted with the desktop's own fit, so it lines up with the
 *   desktop behind a window anywhere on the screen.
 * - span (one image across several monitors) takes fill on this monitor: the Rust side knows only
 *   one monitor's rectangle.
 */

const SIZE = { fill: 'cover', span: 'cover', fit: 'contain', stretch: '100% 100%' };

/** @returns {{x:number,y:number,w:number,h:number,size:string,repeat:string,pos:string}} */
export function place(info, img) {
  const k = 1 / (info.scale || 1);
  const [mx, my, mw, mh] = info.monitor;
  const [wx, wy] = info.window;
  const natural = info.fit === 'center' || info.fit === 'tile';
  return {
    x: (mx - wx) * k, y: (my - wy) * k, w: mw * k, h: mh * k,
    size: natural ? img.w * k + 'px ' + img.h * k + 'px' : (SIZE[info.fit] || 'cover'),
    repeat: info.fit === 'tile' ? 'repeat' : 'no-repeat',
    pos: info.fit === 'tile' ? '0 0' : 'center',
  };
}
