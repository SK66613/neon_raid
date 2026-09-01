import { expect, test } from '@playwright/test';

test('v0.5 boots, plays Stage 1, and enters the Warden-X fight', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();
  await page.waitForFunction(() => window.__NEON_READY === true && window.__NEON_TEST);

  const initial = await page.evaluate(() => window.__NEON_TEST.get());
  expect(initial.stage).toBe(1);

  await page.locator('#reset').click();
  await expect(page.locator('#status')).toContainText('первая группа Corp Sec');
  await expect(page.locator('#status')).not.toContainText('Вторая группа');

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowUp');
  await expect.poll(() => page.evaluate(() => window.__NEON_TEST.get().y)).toBeLessThan(initial.y);

  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__NEON_TEST.get().ammo)).toBeLessThan(initial.ammo);
  expect(await page.evaluate(() => window.__NEON_TEST.get().dead)).toBe(false);

  await page.evaluate(() => window.__NEON_TEST.reload());
  await expect(page.locator('#status')).toContainText('RELOADING');
  await expect(page.locator('#status')).toHaveText('Сектор активен.', { timeout: 2_000 });

  await page.evaluate(() => window.__NEON_TEST.skipToBoss());
  const bossStart = await page.evaluate(() => window.__NEON_TEST.get());
  expect(bossStart.stage).toBe(2);
  expect(bossStart.bossHp).toBe(1200);

  await page.evaluate(() => window.__NEON_TEST.damageBoss(100));
  await expect.poll(() => page.evaluate(() => window.__NEON_TEST.get().bossHp)).toBeLessThan(bossStart.bossHp);
  expect(browserErrors).toEqual([]);
});
