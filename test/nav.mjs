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

/**
 * The catalog's tabs once a category tab is in, [{id, label}] in sidebar
 * order, or [] at `timeout`. Under 960 px they live in the phone menu's
 * drawer, mounted only while open: it is opened to look and closed again.
 */
export async function catalogTabs(page, timeout = 25000) {
  const sections = page.getByRole('navigation', { name: 'Sections' });
  const menu = page.getByRole('button', { name: 'Menu' });
  const cat = sections.getByRole('tab').and(page.locator('[data-tab-id^="cat"]'));
  const end = Date.now() + timeout;
  while (!(await cat.count()) && Date.now() < end) {
    if (await menu.isVisible().catch(() => false) && await menu.getAttribute('aria-expanded') !== 'true') await menu.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  const tabs = await sections.getByRole('tab').evaluateAll((ts) => ts.map((t) => ({ id: t.dataset.tabId, label: t.textContent.trim() })));
  if (await menu.isVisible().catch(() => false) && await menu.getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape');
  return tabs.some((t) => t.id && t.id.startsWith('cat')) ? tabs : [];
}
