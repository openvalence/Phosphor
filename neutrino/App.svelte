<script>
  /**
   * App.svelte -- the Neutrino dev tool's one window: the machine's dev tool channel (the native twin's
   * --devtool-port, 127.0.0.1) drawn as a rail, readouts, a scope, its clients, the physical panel, the network
   * panel and the log. Everything shown arrives on that channel; every input leaves on it as one text line
   * (Nucleus sim/valencesim/README.md, The dev tool channel).
   */
  import { onMount } from 'svelte';
  import Rail from './Rail.svelte';
  import Scope from './Scope.svelte';
  import { createRing, push, idx, before } from './ring.js';
  import { THEMES, applyTheme, currentTheme } from '../src/model/theme.js';

  const TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const ring = createRing(65536);
  let info = $state(null);
  let hello = $state(null);
  let snap = $state.raw(null);
  let linkUp = $state(false);
  let simNote = $state('');
  let log = $state.raw([]);
  let logFilter = $state('');
  let logLevel = $state('all');
  let themeId = $state(currentTheme().id);
  let ws = null;

  // Network knobs: the slider values sent, seeded from the machine once.
  let net = $state({ lat: 0, jit: 0, loss: 0 });
  let netSeeded = false;
  let dropS = $state(5);
  let own = $state({});   // slot -> { lat, jit, loss } being edited

  const send = (line) => { if (ws && ws.readyState === 1) ws.send(line); };

  function onMessage(e) {
    const m = JSON.parse(e.data);
    if (m.t === 'hello') { hello = m; return; }
    if (m.t !== 'snap') return;
    const s = m.s;
    for (let i = 0; i + 2 < s.length; i += 3) push(ring, s[i], s[i + 1], s[i + 2]);
    if (m.log.length) log = [...log, ...m.log].slice(-500);
    if (!netSeeded) { net = { ...m.net }; netSeeded = true; }
    const slots = new Set();
    for (const c of m.clients) {
      if (c.slot === 255) continue;
      slots.add(c.slot);
      if (!own[c.slot]) own[c.slot] = { ...c.f };
    }
    for (const k of Object.keys(own)) if (!slots.has(Number(k))) delete own[k];
    snap = m;
  }

  function dial() {
    if (!info) return;
    ws = new WebSocket('ws://127.0.0.1:' + info.devtool);
    ws.onopen = () => { linkUp = true; };
    ws.onmessage = onMessage;
    ws.onclose = () => { linkUp = false; ws = null; setTimeout(dial, 500); };
  }

  onMount(async () => {
    const q = new URLSearchParams(location.search);
    if (TAURI) {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      info = await invoke('info');
      listen('sim-rebooted', () => {
        simNote = 'Rebooted';
        setTimeout(() => { if (simNote === 'Rebooted') simNote = ''; }, 15000);
      });
      listen('sim-exited', (e) => { simNote = 'Emulator stopped: ' + e.payload; });
    } else {
      info = { devtool: Number(q.get('devtool')) || 0, ws: Number(q.get('ws')) || 82, http: 80, host: location.hostname || '127.0.0.1' };
    }
    dial();
  });

  async function launchAnother() {
    if (!TAURI) return;
    const { invoke } = await import('@tauri-apps/api/core');
    invoke('launch_another');
  }

  // ---- derived readouts --------------------------------------------------------

  const url = $derived(info ? 'ws://' + info.host + ':' + info.ws : '');
  const clients = $derived(snap ? snap.clients : []);
  const live = $derived(clients.filter((c) => c.slot !== 255).length);
  const accel = $derived.by(() => {
    if (!snap || ring.n < 25) return 0;
    const a = idx(ring, ring.n - 1), b = idx(ring, before(ring, ring.t[a] - 20000));
    const dt = (ring.t[a] - ring.t[b]) / 1e6;
    return dt > 0 ? (ring.v[a] - ring.v[b]) / dt / 1000 : 0;
  });
  const state = $derived.by(() => {
    if (!snap) return '';
    const m = snap.m;
    if (snap.safety.estop) return 'E-STOP';
    if (m.homing) return 'Homing';
    if (!m.homed) return 'Unhomed';
    if (snap.safety.pause) return 'Paused';
    return { stream: 'Streaming', pattern: 'Pattern', move: 'Moving', home: 'Homing', return: 'Returning', idle: 'Idle' }[m.source] || m.source;
  });
  const LOOK = { quiet: '', window: 'Window open', request: 'Configure ask', refused: 'Refused', demoted: 'Demoted' };
  const shownLog = $derived(log.filter((l) => (logLevel === 'all' || (logLevel === 'warn' ? 'WE'.includes(l[0]) : l[0] === 'E'))
    && (!logFilter || l[1].toLowerCase().includes(logFilter.toLowerCase()))));

  // ---- inputs ------------------------------------------------------------------

  const press = (b) => send(b + ' down');
  const release = (b) => send(b + ' up');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function pairScript(kind) {
    if (kind === 'tap') { press('pair'); await wait(120); release('pair'); }
    if (kind === 'double') { press('pair'); await wait(100); release('pair'); await wait(150); press('pair'); await wait(100); release('pair'); }
    if (kind === 'hold') { press('pair'); await wait(5300); release('pair'); }
  }
  const estopDown = $derived(snap ? snap.phys.estop : false);
  const sendNet = () => send('faults all ' + Math.round(net.lat) + ' ' + Math.round(net.jit) + ' ' + Number(net.loss).toFixed(1));
  const sendOwn = (slot) => { const f = own[slot]; send('faults ' + slot + ' ' + (f.lat | 0) + ' ' + (f.jit | 0) + ' ' + (+f.loss || 0)); };
  const copyUrl = () => navigator.clipboard && navigator.clipboard.writeText(url);
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '--');
</script>

<div class="app">
  <header class="top">
    <span class="nu" data-tip="Virtual: Nucleus firmware emulated on this computer" aria-label="Virtual">ν</span>
    <div class="name">
      <b>{hello ? hello.name : 'Neutrino'}</b>
      <span class="sub">{hello ? hello.product + ' ' + hello.version : linkUp ? '' : 'Starting'}</span>
    </div>
    <button class="og-btn sm url" onclick={copyUrl} data-tip="Copy the WebSocket address">{url || '--'}</button>
    <span class="chip" data-tip="Connected clients">{live} {live === 1 ? 'client' : 'clients'}</span>
    {#if simNote}<span class="chip warn">{simNote}</span>{/if}
    {#if !linkUp}<span class="chip warn">Dev channel down</span>{/if}
    <span class="grow"></span>
    <select bind:value={themeId} onchange={() => applyTheme(themeId)} aria-label="Theme">
      {#each THEMES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
    </select>
    {#if TAURI}<button class="og-btn sm" onclick={launchAnother} data-tip="Start another Neutrino on the next free ports">Launch another</button>{/if}
    <button class="estop" class:down={estopDown} onclick={() => send(estopDown ? 'estop up' : 'estop down')}
      data-tip={estopDown ? 'Release the button; the latch holds until a client clears it' : 'Press the e-stop: the hub latches it and halts the axis'}>
      {estopDown ? 'RELEASE' : 'E-STOP'}
    </button>
  </header>

  <main class="grid">
    <section class="col main">
      <Rail {ring} {snap} />
      <div class="readouts">
        <div class="ro"><span>Position</span><b>{snap ? fmt(snap.m.pos, 2) : '--'}</b><i>mm</i></div>
        <div class="ro"><span>Speed</span><b>{snap ? fmt(snap.m.vel, 1) : '--'}</b><i>mm/s</i></div>
        <div class="ro"><span>Accel</span><b>{snap ? fmt(accel, 2) : '--'}</b><i>m/s²</i></div>
        <div class="ro"><span>State</span><b class:bad={state === 'E-STOP'} class:warn={state === 'Unhomed' || state === 'Paused'}>{state || '--'}</b>
          <i>{snap && snap.m.owner ? 'owner ' + snap.m.owner.toString(16) : ''}</i></div>
        <div class="ro"><span>Window</span><b>{snap ? fmt(snap.m.wmin, 0) + '..' + fmt(snap.m.wmax, 0) : '--'}</b><i>of {snap ? fmt(snap.m.rail, 0) : '--'} mm</i></div>
        <div class="ro"><span>Limits</span><b>{snap ? fmt(snap.m.vmax, 0) : '--'}</b><i>mm/s, {snap ? fmt(snap.m.amax / 1000, 1) : '--'} m/s²</i></div>
      </div>
      <Scope {ring} />

      <div class="panel">
        <h2>Clients</h2>
        {#if !clients.length}
          <p class="empty">No clients</p>
        {:else}
          <table>
            <thead><tr><th>Slot</th><th>Client</th><th>Tier</th><th>State</th><th>RTT</th><th>Queue</th><th>Drops</th><th>Retx</th><th data-tip="Latency ms, jitter ms, loss %">Faults</th><th></th></tr></thead>
            <tbody>
              {#each clients as c (c.slot + ':' + c.sid)}
                <tr class:parked={c.slot === 255}>
                  <td>{c.slot === 255 ? 'parked' : c.slot}</td>
                  <td class="who" data-tip={c.peer}>{c.name || c.kind || c.peer || '--'}</td>
                  <td>{c.session ? c.tier : '--'}</td>
                  <td>{c.session ? c.state : 'connecting'}</td>
                  <td class:warn={c.rtt > 150}>{c.rtt >= 0 ? c.rtt + ' ms' : '--'}</td>
                  <td>{c.queued}</td>
                  <td class:bad={c.drops + c.refused + c.failed > 0}>{c.drops + c.refused + c.failed}</td>
                  <td>{c.retx}</td>
                  <td class="knobs">
                    {#if own[c.slot]}
                      {@const k = own[c.slot]}
                      <input class="og-num" type="number" min="0" max="5000" bind:value={k.lat} onchange={() => sendOwn(c.slot)} aria-label="Latency ms" />
                      <input class="og-num" type="number" min="0" max="5000" bind:value={k.jit} onchange={() => sendOwn(c.slot)} aria-label="Jitter ms" />
                      <input class="og-num" type="number" min="0" max="100" step="0.5" bind:value={k.loss} onchange={() => sendOwn(c.slot)} aria-label="Loss %" />
                    {/if}
                  </td>
                  <td>{#if c.slot !== 255}<button class="og-btn sm danger" onclick={() => send('kick ' + c.slot)} data-tip="Close this connection">Disconnect</button>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </section>

    <section class="col side">
      <div class="panel">
        <h2>Physical</h2>
        <div class="phys">
          <button class="round pair" class:down={snap && snap.phys.pair} data-look={snap ? snap.pair.look : 'quiet'}
            onpointerdown={() => press('pair')} onpointerup={() => release('pair')} onpointerleave={() => snap && snap.phys.pair && release('pair')}
            data-tip="Momentary: closed while held">PAIR</button>
          <div class="stack">
            <div class="row">
              <button class="og-btn sm" onclick={() => pairScript('tap')} data-tip="Open the presence window (offline: approve the ask)">Tap</button>
              <button class="og-btn sm" onclick={() => pairScript('double')} data-tip="Approve the configure ask">Double</button>
              <button class="og-btn sm" onclick={() => pairScript('hold')} data-tip="Demote every client to watch">Hold 5 s</button>
            </div>
            <span class="sub">{snap ? LOOK[snap.pair.look] || '' : ''}{snap && snap.pair.asks ? ' · ' + snap.pair.asks + ' ask' : ''}{snap && snap.pair.presence ? ' · presence' : ''}</span>
          </div>
        </div>
        <div class="phys">
          <button class="round home" class:down={snap && snap.phys.home}
            onpointerdown={() => press('home')} onpointerup={() => release('home')} onpointerleave={() => snap && snap.phys.home && release('home')}
            data-tip="Press to home, hold 3 s to reboot">HOME</button>
          <div class="stack">
            <div class="row">
              <button class="og-btn sm danger" onclick={() => send('drive-alarm')} data-tip="Assert DRV_ALM once: the hub latches e-stop, cause fault">Drive alarm</button>
              <button class="og-btn sm" onclick={() => send('switch-fault')} data-tip="MSW_FLT_N low 2 s, latches e-stop; needs --motor-switch">Switch fault</button>
            </div>
            <span class="sub">{snap ? (snap.m.homed ? 'Homed' : 'Unhomed') + (snap.m.homes ? ' · ' + snap.m.homes + ' cycles' : '') : ''}</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>Network</h2>
        <label class="knob"><span data-tip="One-way delay added to every client">Latency</span><input type="range" min="0" max="500" bind:value={net.lat} onchange={sendNet} /><b>{net.lat} ms</b></label>
        <label class="knob"><span data-tip="Random extra one-way delay, 0 to this value">Jitter</span><input type="range" min="0" max="200" bind:value={net.jit} onchange={sendNet} /><b>{net.jit} ms</b></label>
        <label class="knob"><span data-tip="Frames retransmitted: 200 ms late, holding those behind">Loss</span><input type="range" min="0" max="30" step="0.5" bind:value={net.loss} onchange={sendNet} /><b>{net.loss} %</b></label>
        <div class="row">
          <input class="og-num secs" type="number" min="1" max="600" bind:value={dropS} aria-label="Outage seconds" />
          {#if snap && snap.wifi.dropLeft > 0}
            <button class="og-btn sm" onclick={() => send('wifi-drop 0')}>Restore Wi-Fi</button>
            <span class="chip warn">Wi-Fi down {(snap.wifi.dropLeft / 1000).toFixed(1)} s</span>
          {:else}
            <button class="og-btn sm" onclick={() => send('wifi-drop ' + dropS)} data-tip="Wi-Fi outage: frames held both ways, no UDP discovery">Drop Wi-Fi</button>
          {/if}
        </div>
      </div>

      <div class="panel log">
        <h2>Log</h2>
        <div class="row">
          <input class="og-num" placeholder="Filter" bind:value={logFilter} aria-label="Filter" />
          <select bind:value={logLevel} aria-label="Level">
            <option value="all">All</option><option value="warn">Warn+</option><option value="err">Errors</option>
          </select>
        </div>
        <ol>
          {#each shownLog.toReversed() as l, i (i)}<li class={'lv-' + l[0]}>{l[1]}</li>{/each}
        </ol>
      </div>
    </section>
  </main>
</div>

<style>
  :global(body) { margin: 0; background: var(--bg); color: var(--tx); font-family: var(--font); }
  .app { display: flex; flex-direction: column; min-height: 100vh; }
  .top { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-4); background: var(--bg-raised); border-bottom: 1px solid var(--line-1); flex-wrap: wrap; }
  .nu { display: inline-grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--neutrino); color: var(--neutrino); border-radius: 50%; font-size: 1.1rem; }
  .name { display: flex; flex-direction: column; line-height: 1.1; }
  .name b { color: var(--tx-hi); }
  .sub { font-size: .72rem; color: var(--tx-mut); }
  .url { font-family: var(--mono); }
  .chip { font-size: .74rem; padding: 2px var(--sp-2); border: 1px solid var(--line-2); border-radius: var(--radius); color: var(--tx-mut); white-space: nowrap; }
  .chip.warn, .warn { color: var(--warn); border-color: var(--warn); }
  .bad { color: var(--bad); }
  .grow { flex: 1; }
  .top select { width: auto; }
  .estop { min-width: 110px; min-height: 44px; border-radius: 22px; border: 2px solid var(--estop); background: var(--estop); color: #fff; font-weight: 700; letter-spacing: .08em; cursor: pointer; font-family: var(--font); }
  .estop.down { background: transparent; color: var(--estop); box-shadow: 0 0 14px rgba(var(--bad-rgb), .5); }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: var(--sp-4); padding: var(--sp-4); align-items: start; }
  @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  .col { display: flex; flex-direction: column; gap: var(--sp-4); min-width: 0; }
  .readouts { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--sp-2); }
  .ro { display: flex; flex-direction: column; padding: var(--sp-2) var(--sp-3); background: var(--bg-card); border: 1px solid var(--line-1); border-radius: var(--radius); }
  .ro span { font-size: .7rem; color: var(--tx-mut); text-transform: uppercase; letter-spacing: .06em; }
  .ro b { font-family: var(--mono); font-size: 1.15rem; color: var(--tx-hi); font-weight: var(--num-wght); }
  .ro i { font-style: normal; font-size: .7rem; color: var(--tx-ghost); }
  .panel { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); background: var(--bg-card); border: 1px solid var(--line-1); border-radius: var(--radius); }
  h2 { margin: 0; font-size: .78rem; color: var(--tx-mut); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
  .empty { margin: 0; color: var(--tx-ghost); font-size: .8rem; }
  table { width: 100%; border-collapse: collapse; font-size: .78rem; }
  th { text-align: left; color: var(--tx-mut); font-weight: 500; padding: 2px 4px; border-bottom: 1px solid var(--line-1); }
  td { padding: 3px 4px; font-family: var(--mono); white-space: nowrap; }
  td.who { font-family: var(--font); max-width: 14rem; overflow: hidden; text-overflow: ellipsis; }
  tr.parked { opacity: .6; }
  .knobs { display: flex; gap: 2px; }
  .knobs .og-num { width: 4.6rem; padding: 2px 4px; min-height: 26px; font-size: .74rem; }
  .row { display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap; }
  .phys { display: flex; gap: var(--sp-3); align-items: center; }
  .stack { display: flex; flex-direction: column; gap: var(--sp-1); }
  .round { width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--line-3); background: var(--bg-raised); color: var(--tx-hi); font-family: var(--font); font-weight: 700; cursor: pointer; flex: none; user-select: none; touch-action: none; }
  .round.down { transform: translateY(1px); border-color: var(--highlight); color: var(--highlight); }
  .pair[data-look='window'] { box-shadow: 0 0 0 3px rgba(var(--highlight-rgb), .35); animation: blink 1s steps(2) infinite; }
  .pair[data-look='request'] { box-shadow: 0 0 0 3px rgba(var(--highlight-rgb), .6); animation: blink .3s steps(2) infinite; }
  .pair[data-look='demoted'], .pair[data-look='refused'] { box-shadow: 0 0 0 3px rgba(var(--bad-rgb), .5); }
  @keyframes blink { 50% { box-shadow: none; } }
  .knob { display: grid; grid-template-columns: 4.5rem 1fr 4.5rem; align-items: center; gap: var(--sp-2); font-size: .78rem; }
  .knob span { color: var(--tx-mut); }
  .knob b { font-family: var(--mono); font-weight: 400; text-align: right; }
  .secs { width: 5rem; }
  .panel :is(.og-num, select) { min-height: 30px; padding: 2px var(--sp-2); font-size: .78rem; }
  .log select { width: auto; }
  .log .og-num { flex: 1; }
  .log ol { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow: auto; font-family: var(--mono); font-size: .7rem; display: flex; flex-direction: column-reverse; }
  .log li { padding: 1px 0; white-space: pre-wrap; word-break: break-word; color: var(--tx-val); }
  .log li.lv-W { color: var(--warn); }
  .log li.lv-E { color: var(--bad); }
</style>
