/* Automated accessibility checks for stable, user-visible browser states. */
const { AxeBuilder } = require('@axe-core/playwright');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const base = process.env.E2E_URL || 'http://127.0.0.1:8011';
const desktopViewport = { width: 1440, height: 1000 };
const mobileViewport = { width: 390, height: 844 };
const blockingImpacts = new Set(['critical', 'serious']);
const resolvedRuleIds = {
  '首次引导': new Set(['landmark-no-duplicate-banner', 'landmark-unique']),
  '主页面': new Set(['page-has-heading-one']),
  '匹配报告': new Set([
    'heading-order',
    'landmark-main-is-top-level',
    'landmark-no-duplicate-main',
    'landmark-unique',
    'page-has-heading-one'
  ])
};

function formatViolations(violations) {
  return violations.map(violation => {
    const targets = violation.nodes
      .map(node => node.target.join(' '))
      .join('; ');
    return `${violation.id} (${violation.impact}): ${violation.help} — ${targets}`;
  }).join('\n');
}

async function scan(page, state, viewports = [desktopViewport, mobileViewport]) {
  const originalViewport = page.viewportSize();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {}))));
    const label = `${state} ${viewport.width}px`;
    const result = await new AxeBuilder({ page }).analyze();
    const blocking = result.violations.filter(violation => blockingImpacts.has(violation.impact));
    assert.deepEqual(blocking, [], label + ' 存在严重无障碍问题：\n' + formatViolations(blocking));
    const resolvedRegressions = result.violations.filter(violation => resolvedRuleIds[state]?.has(violation.id));
    assert.deepEqual(resolvedRegressions, [], label + ' 重新出现已修复的语义问题：\n' + formatViolations(resolvedRegressions));
    const nonBlocking = result.violations.filter(violation => !blockingImpacts.has(violation.impact));
    if (nonBlocking.length) {
      console.log(`NOTICE A11Y ${label}：\n${formatViolations(nonBlocking)}`);
    }
    console.log(`PASS A11Y ${label}（${result.violations.length} 项违规，均非 serious 或 critical）`);
  }
  await page.setViewportSize(originalViewport);
}

async function closeOnboarding(page) {
  const wizard = page.getByRole('dialog', { name: '新手教程与本机保存设置', exact: true });
  await wizard.waitFor();
  await scan(page, '首次引导');
  const autosave = wizard.getByRole('button', { name: '自动保存', exact: true });
  if (await autosave.isEnabled()) {
    await autosave.click();
  } else {
    await wizard.getByRole('button', { name: '本次不保存', exact: true }).click();
  }
  await wizard.getByRole('button', { name: /我先看看岗位/ }).click();
  await wizard.getByRole('button', { name: /先浏览岗位/ }).click();
  await wizard.waitFor({ state: 'detached' });
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL === 'chromium' ? undefined : process.env.PW_CHANNEL || 'msedge',
    headless: true
  });

  try {
    const context = await browser.newContext({ viewport: desktopViewport });
    const page = await context.newPage();
    await page.goto(base);
    await page.locator('.exploration-header').waitFor();
    await closeOnboarding(page);

    await page.locator('#page-jobs .jobs-stitch-card').first().waitFor();
    await scan(page, '主页面');

    await page.getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '本机数据设置', exact: true });
    await settings.waitFor();
    await scan(page, '本机数据设置');
    await settings.getByRole('button', { name: '关闭本机数据设置', exact: true }).click();
    await settings.waitFor({ state: 'detached' });

    await page.getByRole('button', { name: /AI 模型配置/ }).click();
    const config = page.getByRole('dialog', { name: 'AI 模型配置', exact: true });
    await config.waitFor();
    await config.getByRole('status').waitFor();
    await scan(page, 'AI 模型配置');
    await config.getByRole('button', { name: '关闭 AI 模型配置', exact: true }).click();
    await config.waitFor({ state: 'detached' });

    await page.getByRole('button', { name: '查看 Java 开发工程师 详情', exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'Java 开发工程师', exact: true });
    await detail.waitFor();
    await scan(page, '岗位详情');
    await detail.getByRole('button', { name: '关闭岗位详情', exact: true }).click();
    await detail.waitFor({ state: 'detached' });

    await page.getByRole('tab', { name: '简历与个人报告', exact: true }).click();
    await page.getByRole('tab', { name: '手动录入资料', exact: true }).click();
    await page.getByLabel('专业', { exact: true }).fill('软件工程');
    await page.locator('.profile-target-select select').selectOption('java');
    const skill = page.getByLabel('新增技能标签', { exact: true });
    await skill.fill('Java');
    await skill.press('Enter');
    await page.locator('.profile-stitch .empty-state').scrollIntoViewIfNeeded();
    await scan(page, '资料页', [mobileViewport]);

    await page.getByRole('tab', { name: '匹配报告', exact: true }).click();
    const alternatives = page.locator('.alternative-grid > button');
    await alternatives.first().waitFor();
    await alternatives.filter({
      has: page.getByRole('heading', { name: 'Java 开发工程师', exact: true })
    }).click();
    await page.getByRole('button', { name: '生成岗位建议', exact: true }).click();
    await page.locator('.report').waitFor();
    await scan(page, '匹配报告');
    await page.getByRole('tab', { name: '成长路径', exact: true }).click();
    await page.locator('.path-overview').waitFor();
    await scan(page, '成长路径', [mobileViewport]);
    await page.locator('.path-route-options button').first().click();
    await page.locator('.path-current-plan .path-selected-detail').waitFor();
    await scan(page, '已选成长路线');
    for (const summary of await page.locator('.path-disclosure > summary').all()) {
      await summary.click();
    }
    await scan(page, '展开成长阶段与活动');

    await page.getByRole('tab', { name: '简历与个人报告', exact: true }).click();
    await page.getByLabel('专业', { exact: true }).fill('计算机科学与技术');
    await page.getByRole('tab', { name: '匹配报告', exact: true }).click();
    const refreshStale = page.getByRole('button', { name: '更新过期结果', exact: true });
    await refreshStale.waitFor();
    await scan(page, '过期匹配与刷新');
    await refreshStale.click();
    await page.getByText('匹配结果最新', { exact: true }).waitFor();

    await page.route('**/api/recommendations', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'CURRENT_ERROR', message: '模拟服务繁忙，请稍后重试。', retryable: true, request_id: 'a11y-only' }
      })
    }), { times: 1 });
    await page.getByRole('button', { name: '刷新匹配结果', exact: true }).click();
    const retry = page.getByRole('button', { name: '重新计算推荐', exact: true });
    await retry.waitFor();
    await retry.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await scan(page, '推荐错误与重试');
    await retry.click();
    await page.getByText('匹配结果最新', { exact: true }).waitFor();

    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
