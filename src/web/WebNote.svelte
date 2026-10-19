<script>
  /**
   * WebNote.svelte -- the web builds' line in the top bar (LinkBar's note): what this page is and what it can
   * reach, the Downloads link, and the demo's Reset. Under 700 px only the link and the button stay.
   */
  import { resetDemo } from './web.js';
  import ExtLink from '../ui/ExtLink.svelte';

  const DEMO = import.meta.env.MODE === 'mini';
  const DOWNLOADS = 'https://openvalence.org/downloads/';
  const WHY = 'Browsers block ws:// from an https page and have no LAN discovery, Buttplug server or file access';
</script>

<span class="web-note">
  {#if DEMO}
    <span class="wide">Phosphor on Neutrino, in your browser.</span>
    <ExtLink href={DOWNLOADS} target="_top" text="Downloads" />
    <button type="button" onclick={resetDemo} data-tip="Back to the first load">Reset demo</button>
  {:else}
    <span data-tip={WHY}><span class="wide">Web version:</span> Neutrino only<span class="wide">, no real machines</span>.</span>
    <ExtLink href={DOWNLOADS} text="Get the app" />
  {/if}
</span>

<style>
  .web-note {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-dim);
  }
  .web-note > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .web-note :global(.ext) { color: var(--ink); }
  .web-note button {
    font: inherit;
    color: var(--ink);
    background: none;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 2px var(--sp-2);
    cursor: pointer;
  }
  .web-note button:hover { border-color: var(--line-4); }
  @media (max-width: 699px) { .wide { display: none; } }
  /* Embedded (web.js): the document never scrolls, and on touch the desktop content pane neither, so a swipe
     that is not a control's scrolls the embedding page (style.css's overscroll-behavior: none would trap it). */
  :global(html.embed), :global(html.embed body) { overflow: hidden; overscroll-behavior: auto; }
  @media (pointer: coarse) { :global(html.embed .content) { overflow: hidden; } }
  :global(html.embed[data-paused] body) { display: none; }
</style>
