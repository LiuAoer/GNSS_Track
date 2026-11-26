import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createCatalog, satelliteState } from '../src/data.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/extended-ephemeris.json', import.meta.url)));
const instant = new Date('2026-11-23T05:00:00Z');
const catalog = createCatalog(fixture);
async function open(page, payload = fixture) {
  await page.clock.setFixedTime(instant);
  await page.route('**/api/ephemeris', route => route.fulfill({ json: payload }));
  await page.goto('/');
  await expect(page.locator('.loading-notice')).toBeHidden({ timeout: 30000 });
  await expect(page.locator('.orbit-scene canvas')).toBeVisible();
}

test('stations and remote sensing layers select actual satellites and show ground tracks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  for (const [name, id] of [['中国空间站', 48274], ['国际空间站', 25544]]) {
    await page.getByRole('button', { name: `查看${name}卫星`, exact: true }).click();
    await expect(page.locator('.sat-tags')).toContainText('LEO');
    await page.getByRole('button', { name: '查看卫星信息', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(String(id));
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '仅显示空间站', exact: true }).click();
  await expect(page.locator('.summary-number').first()).toHaveText('2颗');
  await page.screenshot({ path: 'artifacts/stations-desktop.png' });
  await page.getByRole('button', { name: '2D 地图', exact: true }).click();
  await expect(page.locator('.map-satellite')).toHaveCount(2);
  await expect(page.locator('.ground-track')).toHaveAttribute('aria-label', /1.5 小时/);
  await page.getByRole('button', { name: '仅显示遥感卫星', exact: true }).click();
  const remote = catalog.filter(s => s.system.category === 'remote' && satelliteState(s, +instant));
  await expect(page.locator('.map-satellite')).toHaveCount(remote.length);
  const sarCount = remote.filter(s => s.mission === 'sar').length;
  await page.getByRole('checkbox', { name: '隐藏合成孔径雷达', exact: true }).click();
  await expect(page.locator('.map-satellite')).toHaveCount(remote.length - sarCount);
  await expect(page.getByRole('checkbox', { name: '显示合成孔径雷达', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '卫星参数表', exact: true }).first().click();
  await page.getByLabel('筛选卫星类别').selectOption('resource');
  await expect(page.getByRole('dialog')).toContainText('LANDSAT 8');
  expect(errors).toEqual([]);
});

test('ground query validates coordinates, computes a day in a worker, inspects times and exports 1440 samples', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.getByRole('button', { name: '地面观测查询', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '地面观测与接收规划' });
  await dialog.getByLabel('纬度（°，北正南负）').fill('91');
  await dialog.getByRole('button', { name: '查询可见卫星' }).click();
  await expect(dialog.getByRole('alert')).toContainText('纬度');
  await dialog.getByLabel('纬度（°，北正南负）').fill('39.9093');
  await dialog.getByRole('button', { name: '查询可见卫星' }).click();
  await expect(dialog.locator('.hourly-counts button')).toHaveCount(24, { timeout: 30000 });
  await expect(dialog.locator('.visible-total')).not.toHaveText('—');
  await expect(dialog.locator('.best-windows>button')).toHaveCount(3);
  await expect(dialog.locator('.observer-table tbody tr').first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/observer-desktop.png' });
  await dialog.getByRole('button', { name: '查看全天规划 ↓' }).click();
  await expect(dialog.locator('.observer-day h3')).toBeInViewport();
  await page.screenshot({ path: 'artifacts/observer-daily.png' });
  await dialog.getByRole('slider', { name: '全天查询时刻' }).fill('780');
  await expect(dialog.locator('.observer-time')).toContainText('13:00:00 UTC+8');
  await expect(dialog.locator('.observer-current h3')).toContainText('所选时刻');
  await dialog.getByRole('button', { name: '当前时刻', exact: true }).click();
  await expect(dialog.locator('.observer-current h3')).toContainText('当前可见');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出全天 CSV' }).click();
  const file = await download;
  const csv = readFileSync(await file.path(), 'utf8');
  expect(csv.split('\r\n')).toHaveLength(1441);
  expect(csv).toContain('2026-11-22 16:00:00 UTC');
  expect(csv).toContain('2026-11-23 15:59:00 UTC');
  await dialog.locator('.observer-table .table-satellite-name').first().click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '2D 地图', exact: true }).click();
  await expect(page.getByLabel('地面观测点')).toBeVisible();
  expect(errors).toEqual([]);
});

test('observer works on mobile and station-only query sees ISS from its subpoint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: '地面观测查询', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const state = satelliteState(catalog.find(s => s.noradId === 25544), +instant);
  await dialog.getByLabel('纬度（°，北正南负）').fill(String(state.latitude));
  await dialog.getByLabel('经度（°，东正西负）').fill(String(state.longitude));
  for (const name of ['北斗', 'GPS', '伽利略', '格洛纳斯', '准天顶']) await dialog.getByRole('checkbox', { name, exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: '国际空间站', exact: true }).check();
  await dialog.getByRole('button', { name: '查询可见卫星' }).click();
  await expect(dialog.locator('.hourly-counts button')).toHaveCount(24, { timeout: 30000 });
  await expect(dialog.locator('.visible-total')).toHaveText('1');
  await expect(dialog.locator('.observer-table')).toContainText('ISS (ZARYA)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const overflow = await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'artifacts/observer-mobile.png' });
  await dialog.getByRole('button', { name: '查看全天规划 ↓' }).click();
  await expect(dialog.locator('.observer-day h3')).toBeInViewport();
  await page.screenshot({ path: 'artifacts/observer-mobile-daily.png' });
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
});

test('expired or missing data stays unavailable rather than recommending false zero coverage', async ({ page }) => {
  const payload = structuredClone(fixture);
  payload.groups = payload.groups.filter(g => g.id !== 'gps');
  for (const group of payload.groups) for (const record of group.records) record.EPOCH = '2026-01-01T00:00:00';
  await open(page, payload);
  await page.getByRole('button', { name: '地面观测查询', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '查询可见卫星' }).click();
  await expect(dialog.locator('.hourly-counts button')).toHaveCount(24, { timeout: 30000 });
  await expect(dialog.locator('.visible-total')).toHaveText('—');
  await expect(dialog).toContainText('GPS无数据');
  await expect(dialog.locator('.observer-counts')).toContainText('不可用');
  await expect(dialog).toContainText('全天无可用轨道数据，无法推荐时段。');
  await expect(dialog.locator('.best-windows>button')).toHaveCount(0);
});
