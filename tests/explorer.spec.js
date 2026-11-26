import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createCatalog, satelliteState } from '../src/data.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/ephemeris.json', import.meta.url)));
const instant = new Date('2026-10-19T08:45:00Z');
const catalog = createCatalog(fixture).filter(s => satelliteState(s, +instant));
async function open(page, payload = fixture) {
  await page.clock.setFixedTime(instant);
  await page.route('**/api/ephemeris', route => route.fulfill({ json: payload }));
  await page.goto('/');
  await expect(page.locator('.orbit-scene canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.loading-notice')).toBeHidden({ timeout: 30000 });
}

test('real catalog, UTC playback, source epochs, filters and selected ground track', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await expect(page.locator('.summary-number').first()).toHaveText(`${catalog.length}颗`);
  await expect(page.locator('.selected-heading h2')).toHaveText('北斗 C19');
  await expect(page.locator('.speed-button')).toContainText('1×');
  await expect(page.locator('.header-clock')).toContainText('08:45:00');
  await expect(page.locator('.scene-error,.texture-notice')).toHaveCount(0);
  await page.getByRole('button', { name: '暂停播放', exact: true }).click();
  await expect(page.locator('.playback-status')).toContainText('已暂停');
  await page.screenshot({ path: 'artifacts/real-desktop.png' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存视图', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^ORBIT-.*\.png$/);
  await page.getByRole('checkbox', { name: '隐藏GPS', exact: true }).click();
  await expect(page.locator('.summary-number').first()).toHaveText(`${catalog.filter(s => s.system.id !== 'gps').length}颗`);
  await page.getByRole('button', { name: '显示全部', exact: true }).click();
  await page.getByRole('checkbox', { name: '北斗仅显示三号卫星' }).check();
  await expect(page.locator('.summary-number').first()).toHaveText(`${catalog.filter(s => s.system.id !== 'beidou' || s.isBds3).length}颗`);
  await page.getByRole('checkbox', { name: '北斗仅显示三号卫星' }).uncheck();
  await page.getByRole('button', { name: '查看卫星信息', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('43001');
  await expect(page.getByRole('dialog')).toContainText('56.8026°');
  await expect(page.getByRole('dialog')).toContainText('2026-10-15 22:45:03 UTC');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看数据说明' }).click();
  await expect(page.getByRole('dialog')).toContainText('3 GEO + 3 IGSO + 24 MEO');
  await expect(page.locator('.source-list article')).toHaveCount(5);
  await expect(page.getByRole('dialog')).toContainText('BEIDOU-3 M24');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '搜索卫星', exact: true }).click();
  await page.getByPlaceholder('搜索卫星、星座或轨道类型…').fill('42738');
  await expect(page.locator('.satellite-results>button')).toHaveCount(1);
  await page.locator('.satellite-results>button').click();
  await expect(page.locator('.selected-heading h2')).toHaveText('QZS-2');
  await page.getByRole('button', { name: '2D 地图', exact: true }).click();
  await expect(page.locator('.map-satellite')).toHaveCount(catalog.length);
  await expect(page.locator('.ground-track polyline')).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/real-map.png' });
  await page.getByRole('slider', { name: '推算时间', exact: true }).fill('43200');
  await expect(page.locator('.header-clock')).toContainText('12:00:00');
  await page.getByRole('button', { name: '回到实时', exact: true }).click();
  await expect(page.locator('.header-clock')).toContainText('08:45:00');
  await expect(page.locator('.simulation-tag')).toContainText('实时推算');
  await page.getByRole('button', { name: '3D 地球', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  const panel = await page.locator('.satellite-panel').boundingBox();
  const timeline = await page.locator('.timeline').boundingBox();
  expect(panel.y + panel.height).toBeLessThan(timeline.y);
  await page.screenshot({ path: 'artifacts/real-compact.png' });
  expect(errors).toEqual([]);
});

test('mobile layout and constellation controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.screenshot({ path: 'artifacts/real-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('.mobile-constellations').click();
  await page.getByRole('checkbox', { name: '隐藏准天顶', exact: true }).click();
  await expect(page.locator('.summary-number').first()).toHaveText(`${catalog.filter(s => s.system.id !== 'qzss').length}颗`);
  await page.getByRole('button', { name: '收起星座面板', exact: true }).click();
  await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar-open/);
  await expect(page.getByRole('button', { name: '回到实时', exact: true })).toBeVisible();
});

test('cold start failure never invents satellites and supports retry', async ({ page }) => {
  await page.clock.setFixedTime(instant);
  let failure = true;
  await page.route('**/api/ephemeris', route => route.fulfill({ status: failure ? 503 : 200, json: failure ? { groups: [] } : fixture }));
  await page.goto('/');
  await expect(page.getByText('暂时无法读取真实星历')).toBeVisible();
  await expect(page.locator('.orbit-scene canvas')).toHaveCount(0);
  failure = false;
  await page.getByRole('button', { name: '重新获取星历' }).click();
  await expect(page.locator('.summary-number').first()).toHaveText(`${catalog.length}颗`);
});

test('upstream failure is visible even when cached elements can be propagated', async ({ page }) => {
  const payload = structuredClone(fixture);
  payload.groups[0].cache = 'stale';
  payload.groups[0].error = '数据源连接超时';
  await open(page, payload);
  await expect(page.locator('.simulation-tag')).toHaveText('数据源异常');
  await page.locator('.simulation-tag').click();
  await expect(page.getByRole('dialog')).toContainText('数据源连接超时 · 使用旧缓存');
});

test('all expired data shows zero satellites and unavailable coordinates', async ({ page }) => {
  const payload = structuredClone(fixture);
  for (const group of payload.groups) for (const record of group.records) record.EPOCH = '2026-01-01T00:00:00.000000';
  await open(page, payload);
  await expect(page.locator('.summary-number').first()).toHaveText('0颗');
  await expect(page.locator('.epoch-note')).toHaveText('轨道要素过期或无法推算');
  await expect(page.locator('.subpoint p')).toHaveText('——');
  await page.getByRole('button', { name: '2D 地图', exact: true }).click();
  await expect(page.locator('.map-satellite,.ground-track')).toHaveCount(0);
});


test('BeiDou types support solo and combined views across 3D, 2D and BDS-3 filtering', async ({ page }) => {
  await open(page);
  for (const type of ['GEO', 'IGSO', 'MEO']) {
    await page.getByRole('button', { name: `仅显示北斗 ${type}`, exact: true }).click();
    const count = catalog.filter(s => s.system.id === 'beidou' && s.type === type).length;
    await expect(page.locator('.summary-number').first()).toHaveText(`${count}颗`);
    await expect(page.locator('.sat-tags>span').first()).toHaveText(type);
    await expect(page.getByRole('checkbox', { name: `北斗 ${type}`, exact: true })).toBeChecked();
    await page.getByRole('button', { name: '2D 地图', exact: true }).click();
    await expect(page.locator('.map-satellite')).toHaveCount(count);
    await expect(page.locator('.ground-track')).toBeVisible();
    await page.getByRole('button', { name: '3D 地球', exact: true }).click();
  }
  await page.getByRole('checkbox', { name: '北斗 GEO', exact: true }).click();
  await page.getByRole('checkbox', { name: '北斗仅显示三号卫星' }).check();
  const count = catalog.filter(s => s.isBds3 && ['GEO', 'MEO'].includes(s.type)).length;
  await expect(page.locator('.summary-number').first()).toHaveText(`${count}颗`);
  await page.getByRole('button', { name: '2D 地图', exact: true }).click();
  await expect(page.locator('.map-satellite')).toHaveCount(count);
  await page.getByRole('checkbox', { name: '北斗 GEO', exact: true }).click();
  await page.getByRole('checkbox', { name: '北斗 MEO', exact: true }).click();
  await expect(page.locator('.map-satellite,.ground-track')).toHaveCount(0);
  await expect(page.locator('.summary-number').first()).toHaveText('0颗');
  await page.getByRole('button', { name: '显示全部', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '北斗 IGSO', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: '北斗仅显示三号卫星' }).uncheck();
  await expect(page.locator('.map-satellite')).toHaveCount(catalog.length);
});

test('compact/true scale toggle preserves physical details and QZSS is identified as QZO', async ({ page }) => {
  await open(page);
  const stats = await page.locator('.satellite-stats').textContent();
  await expect(page.locator('.orbit-scene')).toHaveAttribute('data-scale', 'compact');
  await page.getByLabel('设置轨道比例').click();
  await page.getByRole('slider', { name: '轨道比例', exact: true }).fill('55');
  await expect(page.locator('.orbit-scene')).toHaveAttribute('data-orbit-percent', '55');
  await page.getByRole('spinbutton', { name: '轨道比例百分比' }).fill('65');
  await expect(page.locator('.orbit-scene')).toHaveAttribute('data-orbit-percent', '65');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orbit:display-percent'))).toBe('65');
  await expect(page.locator('.satellite-stats')).toHaveText(stats);
  await page.getByRole('button', { name: '真实比例', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orbit:display-percent'))).toBe('100');
  await page.getByLabel('设置轨道比例').click();
  await expect(page.locator('.orbit-scene')).toHaveAttribute('data-scale', 'true');
  await expect(page.locator('.satellite-stats')).toHaveText(stats);
  await page.getByRole('button', { name: '显示设置' }).click();
  await expect(page.getByRole('switch', { name: '紧凑轨道显示' })).not.toBeChecked();
  await page.getByRole('switch', { name: '紧凑轨道显示' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.orbit-scene')).toHaveAttribute('data-scale', 'compact');
  await expect(page.locator('.satellite-stats')).toHaveText(stats);
  await page.getByRole('button', { name: '搜索卫星', exact: true }).click();
  await page.getByPlaceholder('搜索卫星、星座或轨道类型…').fill('QZO');
  await expect(page.locator('.satellite-results>button')).toHaveCount(3);
  await page.locator('.satellite-results>button').first().click();
  await expect(page.locator('.sat-tags')).toContainText('QZO准天顶轨道');
  await page.getByRole('button', { name: '查看卫星信息', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('270.8929°');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '仅显示北斗 IGSO', exact: true }).click();
  await page.screenshot({ path: 'artifacts/beidou-igso.png' });
});

test('GNSS parameter table covers source and propagated fields and exports filtered CSV', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '卫星参数表', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '全球卫星参数总表' });
  await expect(dialog).toContainText(`${createCatalog(fixture).length} 颗卫星`);
  await expect(dialog.locator('thead th')).toHaveCount(30);
  await expect(dialog).toContainText('发射年份');
  await expect(dialog).toContainText('2010（仅年份）');
  await expect(dialog).toContainText('近地点幅角deg');
  await expect(dialog).toContainText('星下点经度deg');
  await dialog.getByLabel('筛选卫星类别').selectOption('qzss');
  await expect(dialog.locator('tbody tr')).toHaveCount(catalog.filter(s => s.system.id === 'qzss').length);
  await dialog.getByLabel('搜索参数表').fill('42738');
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出 CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/ORBIT-Satellites-.*\.csv$/);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '卫星参数表', exact: true }).click();
  await expect(page.locator('.satellite-table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const tableBounds = await page.locator('.table-scroll').boundingBox();
  expect(tableBounds.width).toBeLessThan(390);
});
