import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/extended-ephemeris.json', import.meta.url)));
const shape = fileURLToPath(new URL('./fixtures/aoi-beijing.zip', import.meta.url));
async function open(page) {
  await page.clock.setFixedTime(new Date('2026-11-23T05:00:00Z'));
  await page.route('**/api/ephemeris', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await expect(page.locator('.orbit-scene canvas')).toBeVisible();
  await page.getByRole('button', { name: '遥感影像产品', exact: true }).click();
  await page.locator('.modal-backdrop').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  return page.getByRole('dialog', { name: '遥感影像产品' });
}
const result = (id = 'S2-test', cursor = null) => ({ source: 'sentinel', sourceTitle: 'Sentinel-2 L2A', scanned: 1, excluded: 0, cursor, results: [{ id, source: 'sentinel', collectionTitle: 'Sentinel-2 L2A', acquisitionDate: '2026-06-01T00:00:00Z', cloudCover: 12, gsd: 10, assets: [{ key: 'visual', title: '真彩色 RGB', gsd: 10, downloadUrl: '/api/products/download/11111111-1111-4111-8111-111111111111' }, { key: 'swir', title: 'SWIR', gsd: 20, downloadUrl: '/api/products/download/22222222-2222-4222-8222-222222222222' }] }] });

test('SHP ZIP query needs no account, supports paging and chooses actual band downloads', async ({ page }) => {
  const bodies = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/products/search', route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    return route.fulfill({ json: body.cursor ? result('S2-next') : result('S2-test', 'page-two') });
  });
  const dialog = await open(page);
  await expect(page.locator('.workspace-heading h1')).toHaveCount(0);
  await expect(dialog).not.toContainText('UP42');
  await expect(dialog.getByRole('button', { name: '查找影像', exact: true })).toBeDisabled();
  await dialog.getByLabel('上传 ZIP Shapefile 或 GeoJSON').setInputFiles(shape);
  await expect(dialog).toContainText('aoi-beijing.zip');
  await dialog.getByRole('button', { name: '查找影像', exact: true }).click();
  await expect(dialog.locator('.product-result-row')).toHaveCount(1);
  expect(bodies[0].geometry.type).toBe('MultiPolygon');
  expect(bodies[0].geometry.coordinates[0][0][0][0]).toBeCloseTo(116.3);
  expect(bodies[0].maxGsd).toBeUndefined();
  await dialog.getByLabel('S2-test下载波段').selectOption('swir');
  await expect(dialog.locator('.product-specs')).toContainText('20 m');
  await expect(dialog.getByRole('link', { name: '下载 S2-test', exact: true })).toHaveAttribute('href', /22222222/);
  await dialog.getByRole('button', { name: '加载更多影像' }).click();
  await expect(dialog.locator('.product-result-row')).toHaveCount(2);
  expect(bodies[1]).toEqual({ cursor: 'page-two' });
  await page.screenshot({ path: 'artifacts/public-imagery-desktop.png', animations: 'disabled' });
  await dialog.getByLabel('影像来源').selectOption('naip');
  await expect(dialog.locator('.product-result-row')).toHaveCount(0);
  await expect(dialog.getByLabel('最大云量')).toBeDisabled();
  await expect(dialog.getByLabel('影像开始日期')).toHaveValue('2010-01-01');
  expect(errors).toEqual([]);
});

test('mobile public imagery form has no horizontal overflow and renders empty and failed searches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = false;
  await page.route('**/api/products/search', route => route.fulfill(fail ? { status: 502, json: { error: '公开影像源连接超时' } } : { json: { source: 'sentinel', sourceTitle: 'Sentinel-2 L2A', results: [], scanned: 0, excluded: 0, cursor: null } }));
  const dialog = await open(page);
  await dialog.getByLabel('上传 ZIP Shapefile 或 GeoJSON').setInputFiles(shape);
  await dialog.getByRole('button', { name: '查找影像', exact: true }).click();
  await expect(dialog).toContainText('当前条件下没有可下载影像');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/public-imagery-mobile.png', animations: 'disabled' });
  fail = true;
  await dialog.getByRole('button', { name: '查找影像', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('超时');
});
