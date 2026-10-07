/* Real rendered theme regressions; all profile data is fictional. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;

async function colors(locator, pseudo) {
  return locator.evaluate((element, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    return { text: style.color, surface: style.backgroundColor, border: style.borderTopColor };
  }, pseudo);
}

async function primaryContrast(page) {
  for (const button of await page.locator('.primary-button:visible').all()) {
    const style = await colors(button);
    assert.equal(style.text, 'rgb(255, 255, 255)', '主要按钮应使用白字');
    assert.ok(['rgb(82, 89, 74)', 'rgb(65, 74, 58)'].includes(style.surface), '主要按钮及焦点态应使用深色底，避免白底白字：' + style.surface);
  }
}

async function evidence(page, name) {
  const scan = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(scan.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], name + ' 浅色主题无障碍检查应通过');
  if (!process.env.E2E_OUTPUT_DIR) return;
  await fs.mkdir(process.env.E2E_OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.E2E_OUTPUT_DIR, `theme-${name}.png`), animations: 'disabled' });
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL === 'chromium' ? undefined : process.env.PW_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('career-planning-theme', 'light'));
    await page.goto(process.env.E2E_URL || 'http://127.0.0.1:8011');
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    const wizard = page.getByRole('dialog', { name: '新手教程与本机保存设置', exact: true });
    await wizard.waitFor();
    await primaryContrast(page);
    await evidence(page, 'onboarding');
    await wizard.getByRole('button', { name: '本次不保存', exact: true }).click();
    await wizard.getByRole('button', { name: /我没有简历/ }).click();
    await primaryContrast(page);
    await wizard.getByRole('button', { name: /手动建立档案/ }).click();
    await wizard.waitFor({ state: 'detached' });

    const source = page.locator('.profile-source-actions button.is-active');
    assert.equal((await colors(source)).surface, 'rgb(226, 230, 218)', '资料来源选中态应清晰可见');
    await primaryContrast(page);
    await page.getByLabel('专业', { exact: true }).fill('软件工程');
    await page.locator('.profile-target-select select').selectOption('java');
    await page.getByLabel(/^新增技能/).fill('Java');
    await page.getByRole('button', { name: /^确认添加技能/ }).click();
    await evidence(page, 'profile');

    await page.getByRole('tab', { name: '匹配报告', exact: true }).click();
    await page.locator('.alternative-grid button.active').waitFor();
    assert.equal((await colors(page.locator('.alternative-grid button.active'))).surface, 'rgb(226, 230, 218)', '候选选中态应与其他卡片区分');
    assert.equal(await page.locator('.match-coverage').evaluate(element => getComputedStyle(element).accentColor), 'rgb(82, 89, 74)', '覆盖条提及部分应使用深色');
    await primaryContrast(page);
    await evidence(page, 'matches');

    await page.getByRole('tab', { name: '成长路径', exact: true }).click();
    await page.locator('.path-overview').waitFor();
    await page.locator('.path-ladder > summary').click();
    await page.locator('.timeline-card:enabled').first().click();
    assert.equal((await colors(page.locator('.timeline-card.active'))).surface, 'rgb(226, 230, 218)', '路线选中态应清晰可见');
    assert.equal((await colors(page.locator('.timeline-node:not(.active)').first())).surface, 'rgb(255, 254, 251)', '时间轴节点不应残留黑底');
    await primaryContrast(page);
    await evidence(page, 'paths');

    await page.getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '本机数据设置', exact: true });
    await settings.waitFor();
    await primaryContrast(page);
    const checkbox = settings.getByRole('checkbox');
    const track = settings.locator('.local-draft-switch > span[aria-hidden]');
    await checkbox.check();
    assert.equal((await colors(track)).surface, 'rgb(82, 89, 74)', '开关打开应使用深色轨道');
    await checkbox.uncheck();
    assert.equal((await colors(track)).surface, 'rgb(222, 221, 212)', '关闭态应与打开态区分');
    await evidence(page, 'settings');
    await page.keyboard.press('Escape');

    await page.route('**/api/llm/config', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'openai', adapter: 'openai-responses', base_url: 'https://api.openai.com/v1', model: '', configured: false, has_api_key: false }) }));
    await page.getByRole('button', { name: /AI 模型配置/ }).click();
    const config = page.getByRole('dialog', { name: 'AI 模型配置', exact: true });
    await config.waitFor();
    assert.equal((await colors(config.locator('.ai-provider-grid button.active'))).surface, 'rgb(226, 230, 218)', '供应商选中态应清晰可见');
    await primaryContrast(page);
    await evidence(page, 'config');
    await page.setViewportSize({ width: 390, height: 844 });
    await evidence(page, 'config-mobile');
    await page.keyboard.press('Escape');
    await primaryContrast(page);
    await evidence(page, 'paths-mobile');

    await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    assert.equal((await colors(page.locator('.exploration-shell'))).surface, 'rgb(0, 0, 0)', '深色主题应可正常恢复');
    await page.getByRole('button', { name: '切换到白色护眼模式', exact: true }).click();
    await page.reload();
    assert.equal(await page.locator('.exploration-shell').getAttribute('data-theme'), 'light', '刷新后应保持浅色主题');
    console.log('白色护眼主题：四页、引导、设置、模型配置、手机和主题恢复检查通过');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
