/**
 * index.js -- the funscript player's entry: one hero and the Stash connect
 * card. Contract: CONTRACT.md, module plugin (ph-smvd.6); design:
 * docs/plugins/FUNSCRIPT.md.
 *
 * Constraints:
 * - The spec requires input.target and input.duration: on a hub without a
 *   segments STREAM the hero declines and nothing renders (D1, law 7).
 * - absorb false: the claimed fields stay in the generic tree.
 * - deactivate disposes the player, which sends its one hold.
 * - planEl and planDur feed the automatic latency compensation only; without
 *   them it stays at 0.
 */
import { createPlayer, mountPlay } from './ui.js';
import { mountConnect } from './library.js';
import { registerPlayerPage } from './page.js';
import { mountScale } from './scale.js';
import { readPrefs, writePref } from './prefs.js';

export const HERO = Object.freeze({
  id: 'player',
  title: 'Funscript player',
  absorb: false,
  cells: { h: [16, 12], v: [8, 16] },
  spec: {
    require: { target: 'input.target', dur: 'input.duration' },
    optional: { pos: 'telemetry.position', lo: 'window.min', hi: 'window.max',
      vmax: 'limit.input.speed', patRun: 'pattern.running', advRun: 'advgen.running',
      planEl: 'plan.elapsed', planDur: 'plan.duration' },
  },
});

export function activate(api) {
  const player = createPlayer(api);
  api.registerHero({ ...HERO, mount: (el, fields) => player.mount(el, fields) });
  const ui = api.ui;
  const settings = (el) => {
    const b = mountScale(el, { ui, value: readPrefs(api).interp, onChange: (v) => { writePref(api, 'interp', v); player.setInterp(v); },
      gain: () => player.scale });
    const c = mountPlay(el, { ui, value: readPrefs(api).play, onChange: (p) => player.setPlay(p), volume: player.volume, autoplay: player.autoplay });
    const a = mountConnect(el, { ui, api });
    return () => { a(); b(); c(); };
  };
  api.registerSettings(settings);
  registerPlayerPage(api, player, HERO.spec, settings);
  return () => player.dispose();
}
