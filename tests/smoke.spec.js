import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('public co-op composition enables reconnect capability', () => {
  const gameSource = readFileSync(new URL('../src/game/Game.js', import.meta.url), 'utf8');
  expect(gameSource).toMatch(/createNetworkGameSession\(\{[^}]*reconnectCapable: true,/s);
  expect(gameSource).toContain('NETWORK DISCONNECTED — ${reason}${trigger}${counts}');
  expect(gameSource).toContain('A${diagnostic.attemptsCreated}/O${diagnostic.attemptsOpened}/W${diagnostic.welcomeReceived}/S${diagnostic.syncFramesReceived}');
  expect(gameSource).toContain('window.__NEON_NETWORK_DEBUG=()=>session.getNetworkDiagnostics()');
});

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
