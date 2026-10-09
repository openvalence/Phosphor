/**
 * nav.mjs -- page navigation for the browser suites: the desktop rail and
 * the bucket 3 tab strip take a click; the phone menu (DESIGN §10.12) opens
 * its drawer first. Test-only.
 */
export async function goTab(page, id) {
  const sel = '[data-tab-id="' + id + '"]';
  if (await page.locator('.menu-btn').isVisible().catch(() => false)) {
    if (await page.locator('.menu-btn').getAttribute('aria-expanded') !== 'true') await page.click('.menu-btn');
    await page.waitForSelector('.phone-menu ' + sel, { timeout: 15000 });
    await page.click('.phone-menu ' + sel);
    return;
  }
  await page.click(sel);
}

/** Every tab id in sidebar order, the drawer opened and closed for it on the phone. */
export async function tabIds(page, prefix = '') {
  const menu = await page.locator('.menu-btn').isVisible().catch(() => false);
  if (menu) await page.click('.menu-btn');
  const ids = await page.$$eval('[role=tab][data-tab-id]', (ts, p) => ts.map((t) => t.dataset.tabId).filter((x) => x.startsWith(p)), prefix);
  if (menu) await page.keyboard.press('Escape');
  return ids;
}
