/* Focused regressions for workflow state, dialogs, and mobile reading and controls. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { checkWorkflowGuide } = require('./workflow_guide.cjs');

const base = process.env.E2E_URL || 'http://127.0.0.1:8011';

async function saveUiEvidence(page, name) {
  if (!process.env.E2E_OUTPUT_DIR) return;
  const out = path.resolve(process.env.E2E_OUTPUT_DIR);
  await fs.mkdir(out, { recursive: true });
  await page.locator('.toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(out, `ui-${name}.jpg`), fullPage: false, animations: 'disabled', quality: 92 });
}

async function assertTouchTargets(locator, label) {
  let visible = 0;
  for (const control of await locator.all()) {
    if (!await control.isVisible()) continue;
    visible += 1;
    const rect = await control.boundingBox();
    assert.ok(rect.width >= 44 && rect.height >= 44, `${label}触控区域至少为 44px：${JSON.stringify(rect)}`);
  }
  assert.ok(visible > 0, `${label}必须存在可见控件`);
}

async function assertTextScale(locator, minimum, label) {
  const sizes = await locator.evaluateAll(elements => elements
    .filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && element.textContent.trim())
    .map(element => ({ text: element.textContent.trim().slice(0, 60), size: parseFloat(getComputedStyle(element).fontSize) })));
  assert.ok(sizes.length > 0, `${label}必须存在可见文案`);
  assert.deepEqual(sizes.filter(item => item.size < minimum), [], `${label}字号至少为 ${minimum}px`);
}

async function assertNarrowLayout(page, label) {
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.exploration-pages .panel.active');
    const nav = document.querySelector('.exploration-nav').getBoundingClientRect();
    const header = document.querySelector('.exploration-header').getBoundingClientRect();
    return {
      viewport: window.innerWidth, height: window.innerHeight, documentWidth: document.documentElement.scrollWidth,
      panelWidth: panel.clientWidth, contentWidth: panel.scrollWidth,
      nav: { left: nav.left, right: nav.right, top: nav.top, bottom: nav.bottom }, headerBottom: header.bottom
    };
  });
  assert.ok(layout.documentWidth <= layout.viewport + 1 && layout.contentWidth <= layout.panelWidth + 1, `${label}不得横向溢出：${JSON.stringify(layout)}`);
  assert.ok(layout.nav.left >= 0 && layout.nav.right <= layout.viewport, '手机主导航必须完整可见');
  assert.ok(layout.nav.top > layout.height / 2 && layout.height - layout.nav.bottom >= 0 && layout.height - layout.nav.bottom <= 32, '主导航必须位于视口底部');
  assert.ok(layout.nav.top > layout.headerBottom, '底部导航不能遮挡顶栏操作');
}

async function assertDialogLayout(dialog, label) {
  const layout = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewport: innerWidth, height: innerHeight, width: element.clientWidth, contentWidth: element.scrollWidth };
  });
  assert.ok(layout.left >= 0 && layout.right <= layout.viewport && layout.top >= 0 && layout.bottom <= layout.height + 1, `${label}必须在视口内：${JSON.stringify(layout)}`);
  assert.ok(layout.contentWidth <= layout.width + 1, `${label}不得横向溢出`);
}

async function assertActionsAboveNavigation(page, locator, label) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const unobstructed = await locator.evaluate(element => element.getBoundingClientRect().bottom <= document.querySelector('.exploration-nav').getBoundingClientRect().top);
  assert.ok(unobstructed, `滚动到底后${label}不能被底部导航遮挡`);
}

async function assertSelectedPlan(page, plan, activity) {
  assert.equal(await plan.locator('.path-next-task p').innerText(), activity, '顶部活动应对应实际选中路线');
  assert.equal(await plan.evaluate(section => section === document.activeElement), true, '选择后应聚焦顶部计划');
  const position = await plan.locator('header').evaluate(header => ({
    top: header.getBoundingClientRect().top,
    bottom: header.getBoundingClientRect().bottom,
    headerBottom: Math.max(document.querySelector('.exploration-header').getBoundingClientRect().bottom, document.querySelector('.workflow-guide').getBoundingClientRect().bottom)
  }));
  assert.ok(position.top >= position.headerBottom && position.bottom < 700, '选择后计划标题必须出现在顶栏下方：' + JSON.stringify(position));
}

async function assertPageTitleBelowGuide(page, selector, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const position = await page.locator(selector).evaluate(title => ({
    top: title.getBoundingClientRect().top,
    guideBottom: document.querySelector('.workflow-guide').getBoundingClientRect().bottom
  }));
  assert.ok(position.top >= position.guideBottom, label + '返回页顶后标题不能被流程导航遮挡：' + JSON.stringify(position));
}

(async () => {
  const root = path.resolve(__dirname, '../..');
  const indexHtml = await fs.readFile(path.join(root, 'frontend', 'index.html'), 'utf8');
  assert.doesNotMatch(indexHtml, /fonts\.(googleapis|gstatic)\.com/, 'the app entry must not load remote fonts');

  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL === 'chromium' ? undefined : process.env.PW_CHANNEL || 'msedge',
    headless: true
  });
  try {
    await checkWorkflowGuide(browser, base);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let configPosts = 0;
    await page.route('**/api/llm/config', route => {
      if (route.request().method() === 'POST') configPosts += 1;
      const config = route.request().method() === 'GET'
        ? { provider: 'openai', adapter: 'openai-responses', base_url: 'https://api.openai.com/v1', model: 'existing-model', configured: true, has_api_key: true }
        : { provider: 'openai', adapter: 'openai-responses', base_url: 'https://api.openai.com/v1', model: 'mock-model', configured: true, has_api_key: true };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
    });
    await page.goto(base);
    const fontResources = await page.evaluate(() => (
      performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(url => /fonts\.(googleapis|gstatic)\.com/.test(url))
    ));
    assert.deepEqual(fontResources, [], 'the app must not request remote font resources');

    const reducedContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce'
    });
    try {
      const reducedPage = await reducedContext.newPage();
      await reducedPage.goto(base);
      const reducedAnimation = await reducedPage.locator('.exploration-pages .panel.active').evaluate(element => getComputedStyle(element).animationName);
      assert.equal(reducedAnimation, 'none', 'reduced-motion users must not receive the page entry animation');
    } finally {
      await reducedContext.close();
    }

    assert.equal(await page.locator('.singularity-intro').count(), 0, 'the removed cosmic intro must not render');
    await page.locator('.exploration-header').waitFor();

    const wizard = page.getByRole('dialog', { name: '新手教程与本机保存设置', exact: true });
    await wizard.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await assertDialogLayout(wizard, '手机首次引导');
    await assertTouchTargets(wizard.getByRole('button'), '首次引导操作');
    await assertTextScale(wizard.locator('.onboarding-storage-choice p, .onboarding-start-card > span:not(.onboarding-start-eyebrow)'), 14, '手机引导正文');
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await wizard.locator('.onboarding-start-card').count(), 3);
    assert.equal(await page.locator('.workflow-guide').count(), 0, 'number navigator must stay behind the first-session wizard');
    const autosaveButton = wizard.getByRole('button', { name: '自动保存', exact: true });
    if (await autosaveButton.isEnabled()) {
      await autosaveButton.click();
    } else {
      await wizard.getByRole('button', { name: '本次不保存', exact: true }).click();
    }
    await wizard.getByRole('button', { name: /我没有简历/ }).click();
    assert.equal(await wizard.locator('.onboarding-flow-list > li').count(), 4);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertDialogLayout(wizard, '手机引导步骤');
    await assertTouchTargets(wizard.getByRole('button'), '引导步骤操作');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await wizard.getByRole('button', { name: /手动建立档案/ }).click();
    await wizard.waitFor({ state: 'detached' });

    assert.equal(await page.locator('.local-draft-bar').count(), 0, 'local draft settings must not be a home-page status bar');
    const draftSettingsButton = page.getByRole('button', { name: '设置', exact: true });
    await draftSettingsButton.click();
    const draftDialog = page.getByRole('dialog', { name: '本机数据设置', exact: true });
    await draftDialog.waitFor();
    assert.equal(await draftDialog.evaluate(dialog => dialog.contains(document.activeElement)), true, 'opening settings should move focus into the modal');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await draftDialog.getByRole('button', { name: '完成', exact: true }).evaluate(button => button === document.activeElement), true, 'Shift+Tab from the first control should wrap to the final control');
    await page.keyboard.press('Tab');
    assert.equal(await draftDialog.getByRole('button', { name: '关闭本机数据设置', exact: true }).evaluate(button => button === document.activeElement), true, 'Tab from the final control should wrap to the first control');
    await draftDialog.getByRole('checkbox', { name: '自动保存到本机浏览器', exact: true }).press('Space');
    assert.match(await draftDialog.getByRole('status').allTextContents().then(items => items.join(' ')), /自动保存已关闭|自动保存已开启/);
    await page.keyboard.press('Escape');
    await draftDialog.waitFor({ state: 'detached' });
    assert.equal(await draftSettingsButton.evaluate(button => button === document.activeElement), true, 'closing settings should restore focus to its trigger');
    assert.equal(await page.locator('.local-draft-bar').count(), 0, 'closing settings must leave no persistent draft bar');

    const guide = page.locator('.workflow-guide');
    await guide.waitFor();
    assert.deepEqual(await guide.locator('.workflow-step-number').allTextContents(), ['1', '2', '3', '4']);
    assert.equal(await guide.getByRole('button').count(), 5, '流程导航应包含四个步骤和下一步');
    const initialSteps = [
      ['导入或填写资料', '待填写'],
      ['个人分析报告', '待填写资料'],
      ['岗位匹配', '待填写资料'],
      ['行动建议', '等待最新匹配']
    ];
    for (const [index, [label, state]] of initialSteps.entries()) {
      const step = guide.getByRole('button', { name: `${index + 1}. ${label}：${state}`, exact: true });
      assert.equal(await step.getByText(label, { exact: true }).isVisible(), true, '步骤名称必须直接可见：' + label);
      assert.equal(await step.getByText(state, { exact: true }).isVisible(), true, '步骤状态必须直接可见：' + state);
    }
    assert.equal(await guide.getByText('导入简历或填写资料', { exact: true }).isVisible(), true, '下一步必须显示具体动作');
    assert.equal(await guide.locator('[aria-current="step"]').getAttribute('aria-label'), '1. 导入或填写资料：待填写');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction(() => !document.querySelector('.workflow-guide').classList.contains('is-compact'));
    const flowLayout = await guide.evaluate(element => ({
      position: getComputedStyle(element).position,
      bottom: element.getBoundingClientRect().bottom,
      contentTop: document.querySelector('.exploration-pages').getBoundingClientRect().top
    }));
    assert.equal(flowLayout.position, 'sticky', '流程导航应吸顶并在页顶保留布局空间');
    assert.ok(flowLayout.bottom <= flowLayout.contentTop + 1, '流程导航不能覆盖主内容');
    assert.match(await guide.locator('.workflow-guide-next').getAttribute('aria-label'), /下一步：/);

    await page.setViewportSize({ width: 390, height: 844 });
    const narrowSteps = await guide.locator('.workflow-guide-step').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, height: rect.height };
    }));
    assert.ok(Math.abs(narrowSteps[0].top - narrowSteps[1].top) <= 1, '窄屏首行应有两个步骤');
    assert.ok(narrowSteps[2].top > narrowSteps[0].top, '窄屏后两个步骤应换到第二行');
    assert.ok(narrowSteps.every(step => step.left >= 0 && step.right <= 390 && step.height >= 44), '窄屏流程按钮应完整可见且便于触控');
    await assertNarrowLayout(page, '手机资料页');
    await assertTouchTargets(page.getByRole('tablist', { name: '职业探索主导航', exact: true }).getByRole('tab'), '手机主导航');
    await assertTouchTargets(page.locator('.exploration-header-actions').getByRole('button'), '顶栏按钮');
    await draftSettingsButton.click();
    await draftDialog.waitFor();
    await assertDialogLayout(draftDialog, '手机本机设置');
    await assertTouchTargets(draftDialog.getByRole('button'), '手机本机设置');
    await assertTouchTargets(draftDialog.getByRole('checkbox', { name: '自动保存到本机浏览器', exact: true }).locator('..'), '本机保存开关');
    await assertTextScale(draftDialog.locator('.local-draft-settings-lead, .local-draft-setting-card p'), 14, '手机设置正文');
    await assertTextScale(draftDialog.locator('.local-draft-privacy li, .local-draft-settings-state'), 12, '手机隐私说明');
    await page.keyboard.press('Escape');
    await draftDialog.waitFor({ state: 'detached' });
    assert.equal(await draftSettingsButton.evaluate(button => button === document.activeElement), true, '手机关闭设置应恢复触发按钮焦点');
    const dock = page.locator('.profile-action-dock');
    await assertTextScale(page.locator('.profile-step-copy, .profile-stitch-hero > p, .profile-result-step .empty-state p'), 14, '手机资料正文');
    await assertTextScale(dock.locator('small'), 12, '手机资料操作说明');
    assert.equal(await dock.evaluate(element => getComputedStyle(element).position), 'static', '手机资料操作条应回到内容流');
    await assertTouchTargets(dock.getByRole('button'), '资料主要操作');
    await assertActionsAboveNavigation(page, dock, '资料操作条');
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole('button', { name: '新手教程', exact: true }).click();
    await page.getByRole('dialog', { name: '新手教程与本机保存设置', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '新手教程与本机保存设置', exact: true }).waitFor({ state: 'detached' });

    await page.getByRole('tab', { name: '简历与个人报告', exact: true }).click();
    await page.getByRole('tab', { name: '手动录入资料', exact: true }).click();
    console.log('资料页诊断:', JSON.stringify({
      url: page.url(),
      targetSelectorCount: await page.locator('.profile-target-select').count(),
      profileText: (await page.locator('#page-profile').innerText()).slice(0, 500)
    }));
    const targetJob = page.locator('.profile-target-select select');
    await targetJob.selectOption('java');
    const optionStyle = await targetJob.locator('option').nth(1).evaluate(option => {
      const style = getComputedStyle(option);
      return { color: style.color, backgroundColor: style.backgroundColor, colorScheme: style.colorScheme };
    });
    console.log('目标岗位选项样式:', JSON.stringify(optionStyle));
    assert.equal(optionStyle.color, 'rgb(244, 244, 244)', '目标岗位选项文字应有足够对比度');
    assert.equal(optionStyle.backgroundColor, 'rgb(24, 24, 24)', '目标岗位下拉菜单应使用深色背景');

    await page.getByLabel('专业', { exact: true }).fill('软件工程');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertTouchTargets(targetJob, '手机目标岗位选择');
    await assertTouchTargets(page.getByRole('tablist', { name: '资料录入方式', exact: true }).getByRole('tab'), '资料来源切换');
    const skill = page.getByLabel('新增技能标签', { exact: true });
    await skill.fill('Java');
    await page.getByRole('button', { name: '确认添加技能标签', exact: true }).click();
    await assertTouchTargets(page.getByRole('button', { name: /^(修改|删除) Java$/ }), '标签编辑操作');
    await page.getByRole('button', { name: '修改 Java', exact: true }).click();
    await assertTouchTargets(page.locator('.tag-row-edit').getByRole('button'), '标签修改确认');
    await assertNarrowLayout(page, '手机标签编辑');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await guide.getByRole('button', { name: '1. 导入或填写资料：已填写', exact: true }).getByText('已填写', { exact: true }).isVisible(), true);
    await page.getByRole('tab', { name: '匹配报告', exact: true }).click();
    await page.locator('.alternative-grid > button').first().waitFor();
    const currentMatchStep = guide.getByRole('button', { name: '3. 岗位匹配：最新', exact: true });
    await currentMatchStep.waitFor();
    assert.equal(await currentMatchStep.getByText('最新', { exact: true }).isVisible(), true);
    assert.equal(await currentMatchStep.getAttribute('aria-current'), 'step');
    const contents = page.getByRole('navigation', { name: '匹配报告目录', exact: true });
    await page.getByRole('link', { name: '查看匹配依据', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#matches', '覆盖条依据入口应保留匹配页面');
    assert.equal(await page.locator('#report-matrix').evaluate(section => section === document.activeElement), true, '覆盖条入口应聚焦岗位要求');
    const coverage = page.getByRole('progressbar', { name: '必需项资料提及比例', exact: true });
    assert.equal(await coverage.getAttribute('value'), '1', '只填写 Java 时应精确提及一项必需要求');
    assert.equal(await coverage.getAttribute('max'), '6', '覆盖条分母应与 Java 岗位六项必需要求一致');
    await assertPageTitleBelowGuide(page, '.matches-overview h2', '桌面匹配概览');
    await saveUiEvidence(page, 'matches-desktop');
    for (const [label, sectionId] of [['能力摘要', 'report-dimensions'], ['岗位要求', 'report-matrix'], ['岗位建议', 'report-advice']]) {
      await contents.getByRole('link', { name: label, exact: true }).click();
      assert.equal(await page.getByRole('tab', { name: '匹配报告', exact: true }).getAttribute('aria-selected'), 'true', '目录跳转必须保留匹配页面');
      assert.equal(new URL(page.url()).hash, '#matches', '页内目录不能改变应用的页面路由');
      assert.equal(await page.locator('#' + sectionId).evaluate(section => section === document.activeElement), true, '目录跳转应将键盘焦点移至目标内容');
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await assertNarrowLayout(page, '手机匹配报告');
    await assertPageTitleBelowGuide(page, '.matches-overview h2', '手机匹配概览');
    await saveUiEvidence(page, 'matches-mobile');
    await assertTouchTargets(page.locator('.matches-hero-actions, .alternative-grid, .matrix-list').getByRole('button'), '匹配操作');
    await assertTouchTargets(contents.getByRole('link'), '匹配报告目录');
    await assertTextScale(page.locator('.match-overview-stats p, .capability-summary-grid p, .matrix-row strong, .alternative-grid p, .advice-placeholder p'), 14, '手机匹配正文');
    await assertTextScale(page.locator('.report-section > header span, .matrix-row small, .alternative-grid span'), 12, '手机匹配说明');
    const capabilityWidths = await page.locator('.capability-summary-grid article').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
    assert.ok(capabilityWidths.length > 0 && capabilityWidths.every(width => width >= 280), '手机能力摘要应保留完整阅读宽度');
    const filterSummary = page.locator('.match-filter-panel summary');
    await assertTouchTargets(filterSummary, '筛选展开操作');
    await filterSummary.click();
    await assertTouchTargets(page.locator('.matches-stitch-filter').locator('input, select, button'), '手机筛选控件');
    await assertNarrowLayout(page, '手机展开筛选');
    await filterSummary.click();
    await page.getByRole('button', { name: '生成岗位建议', exact: true }).click();
    const report = page.locator('.matches-stitch .report');
    await report.waitFor();
    await assertTouchTargets(report.getByRole('button'), '手机报告导出操作');
    await assertTextScale(report.locator('.item, .item-block h3'), 14, '手机建议正文');
    await assertNarrowLayout(page, '手机生成建议');

    await page.getByRole('tab', { name: '成长路径', exact: true }).click();
    await page.locator('.path-overview').waitFor();
    const plan = page.getByRole('region', { name: '当前成长计划', exact: true });
    assert.equal(await plan.getByRole('heading', { name: '选择一条成长路线', exact: true }).isVisible(), true, '未选择时不应自动指定路线');
    for (const disclosure of await page.locator('.path-disclosure').all()) {
      assert.equal(await disclosure.getAttribute('open'), null, '其他阶段与活动默认折叠');
    }
    await assertTouchTargets(page.locator('.path-disclosure > summary'), '路径展开操作');
    await page.locator('.path-ladder > summary').press('Enter');
    assert.notEqual(await page.locator('.path-ladder').getAttribute('open'), null, '路径应支持键盘展开');
    await assertTouchTargets(page.getByRole('combobox', { name: /^聚焦岗位/ }), '手机路径岗位选择');
    await assertTouchTargets(page.locator('.path-flow').getByRole('button'), '手机路径操作');
    await assertTextScale(page.locator('.path-overview b, .timeline-copy p, .timeline-card p, .path-branch-grid p, .sprint-list strong, .path-action-hub p'), 14, '手机路径正文');
    await assertTextScale(page.locator('.path-overview small, .timeline-card small, .path-branch-grid small, .sprint-list small'), 12, '手机路径说明');
    const firstRoute = page.locator('.timeline-card:enabled').first();
    const firstActivity = await firstRoute.locator('small').innerText();
    await firstRoute.click();
    await assertSelectedPlan(page, plan, firstActivity);
    await plan.getByRole('button', { name: '保存当前路径', exact: true }).click();
    await plan.getByRole('button', { name: '更新已保存路径', exact: true }).waitFor();
    await plan.getByRole('button', { name: '清除已保存路径', exact: true }).click();
    assert.equal(await plan.getByRole('heading', { name: '选择一条成长路线', exact: true }).isVisible(), true, '清除后应回到未选路线');
    assert.equal(await plan.locator('.path-selected-detail').count(), 0, '清除后不能继续展示旧路线');
    await firstRoute.click();
    await assertSelectedPlan(page, plan, firstActivity);
    await page.locator('.path-branches > summary').click();
    await page.locator('.path-sprints > summary').click();
    const branch = page.locator('.path-branch-grid button').first();
    const branchActivity = await branch.locator('p').innerText();
    await branch.click();
    await assertSelectedPlan(page, plan, branchActivity);
    const sprint = page.locator('.sprint-list button').last();
    const sprintActivity = await sprint.locator('strong').innerText();
    await sprint.click();
    await assertSelectedPlan(page, plan, sprintActivity);
    await assertTextScale(page.locator('.path-selected-detail p'), 14, '手机选中路径详情');
    await assertNarrowLayout(page, '手机成长路径');
    await assertActionsAboveNavigation(page, page.locator('.path-action-hub'), '路径保存操作');
    await page.getByRole('combobox', { name: /^聚焦岗位/ }).selectOption('testing');
    assert.equal(await plan.locator('.path-selected-detail').count(), 0, '更换聚焦岗位应清除旧路线');
    assert.equal(await plan.getByRole('heading', { name: '选择一条成长路线', exact: true }).isVisible(), true, '更换岗位不应默认选择路线');
    await page.getByRole('combobox', { name: /^聚焦岗位/ }).selectOption('java');
    for (const width of [320, 901, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const headerLayout = await page.locator('.exploration-header').evaluate(header => ({
        viewport: document.documentElement.clientWidth,
        controls: [...header.querySelectorAll('.exploration-wordmark, button')].map(element => {
          const rect = element.getBoundingClientRect();
          return { text: element.textContent.trim(), left: rect.left, right: rect.right, height: rect.height };
        })
      }));
      assert.deepEqual(headerLayout.controls.filter(control => control.left < 0 || control.right > headerLayout.viewport + 1 || control.height > 44), [], width + 'px 顶栏与导航应完整可见且文案不挤成多行');
      if (width === 320) await assertNarrowLayout(page, '320px 成长路径');
      else {
        await firstRoute.click();
        await assertSelectedPlan(page, plan, firstActivity);
      }
      await assertPageTitleBelowGuide(page, '.paths-hero h2', width + 'px 成长路径');
    }
    await page.setViewportSize({ width: 390, height: 844 });

    await page.getByRole('tab', { name: '职业探索', exact: true }).click();
    await page.getByRole('button', { name: '切换到白色护眼模式', exact: true }).click();
    await assertNarrowLayout(page, '手机岗位目录');
    await assertTouchTargets(page.getByRole('textbox', { name: '搜索岗位', exact: true }), '手机岗位搜索');
    await assertTouchTargets(page.locator('.jobs-stitch-card'), '手机岗位卡片');
    await assertTextScale(page.locator('.jobs-card-main > p, .jobs-stitch-note'), 14, '手机岗位正文');
    await assertTextScale(page.locator('.jobs-stitch-pills span, .jobs-card-link'), 12, '手机岗位说明');
    await page.evaluate(() => window.scrollTo(0, 0));
    const mobileCards = await page.locator('.jobs-stitch-card').evaluateAll(elements => elements.slice(0, 2).map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width }; }));
    assert.ok(Math.abs(mobileCards[0].left - mobileCards[1].left) < 1 && mobileCards[1].top > mobileCards[0].top, '手机岗位卡片必须单列');
    assert.ok(mobileCards[0].top < 700, '390px 首屏应能看到第一张岗位卡片，实际顶部：' + mobileCards[0].top);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopCards = await page.locator('.jobs-stitch-card').evaluateAll(elements => elements.slice(0, 2).map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width }; }));
    assert.ok(Math.abs(desktopCards[0].top - desktopCards[1].top) < 1 && desktopCards[1].left > desktopCards[0].left, '桌面岗位卡片必须双列');
    assert.ok(desktopCards[0].top < 600, '桌面首屏应展示岗位卡片');
    assert.match(await page.locator('.exploration-wordmark').innerText(), /大学生职业规划/);
    await page.setViewportSize({ width: 390, height: 844 });
    const jobTrigger = page.getByRole('button', { name: '查看 Java 开发工程师 详情', exact: true });
    await jobTrigger.click();
    const jobDialog = page.getByRole('dialog', { name: 'Java 开发工程师', exact: true });
    await jobDialog.locator('.detail-summary').waitFor();
    const lightDialogColors = await jobDialog.evaluate(dialog => ({
      surface: getComputedStyle(dialog).backgroundColor,
      text: getComputedStyle(dialog).color,
      backdrop: getComputedStyle(dialog.parentElement).backgroundColor,
      requirementSurface: getComputedStyle(dialog.querySelector('.req-item')).backgroundColor,
      requirementText: getComputedStyle(dialog.querySelector('.req-item summary')).color
    }));
    assert.deepEqual(lightDialogColors, {
      surface: 'rgb(255, 254, 251)',
      text: 'rgb(41, 43, 37)',
      backdrop: 'rgba(48, 47, 40, 0.38)',
      requirementSurface: 'rgb(239, 238, 231)',
      requirementText: 'rgb(41, 43, 37)'
    }, '白色护眼模式下岗位详情应使用浅色表面、柔和遮罩和深色文字');
    assert.equal(await jobDialog.evaluate(dialog => dialog.contains(document.activeElement)), true, '手机打开岗位详情应聚焦弹窗');
    const jobClose = jobDialog.getByRole('button', { name: '关闭岗位详情', exact: true });
    await jobClose.focus();
    await page.keyboard.press('Shift+Tab');
    const jobTargetAction = jobDialog.getByRole('button', { name: /设为目标岗位/ });
    assert.equal(await jobTargetAction.evaluate(button => button === document.activeElement), true, '岗位详情 Shift+Tab 应循环到最后一个操作');
    await page.keyboard.press('Tab');
    assert.equal(await jobClose.evaluate(button => button === document.activeElement), true, '岗位详情 Tab 应循环到关闭按钮');
    await assertDialogLayout(jobDialog, '手机岗位详情');
    await assertTouchTargets(jobDialog.getByRole('button'), '岗位详情操作');
    await assertTouchTargets(jobDialog.locator('.req-item summary'), '岗位要求展开');
    await assertTextScale(jobDialog.locator('.detail-summary, .item-block h4'), 14, '手机岗位详情正文');
    await assertTextScale(jobDialog.locator('.detail-meta, .job-detail-aside h4 span'), 12, '手机岗位详情说明');
    await assertTextScale(jobDialog.locator('.job-detail .mono'), 12, '手机岗位等级与样本说明');
    await jobDialog.locator('.req-item summary').first().click();
    await assertTextScale(jobDialog.locator('.req-basis, .req-quote, .req-quote cite'), 12, '手机岗位依据');
    await assertDialogLayout(jobDialog, '手机展开岗位依据');
    await page.keyboard.press('Escape');
    await jobDialog.waitFor({ state: 'detached' });
    assert.equal(await jobTrigger.evaluate(button => button === document.activeElement), true, '手机关闭岗位详情应恢复触发卡片焦点');

    await page.getByRole('button', { name: /AI 模型配置/ }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 模型配置' });
    await dialog.waitFor();
    await dialog.getByRole('status').getByText('配置已保存，连接尚未验证').waitFor();
    await assertDialogLayout(dialog, '手机模型配置');
    await assertTouchTargets(dialog.locator('button, input, select'), '手机模型配置操作');
    await assertTextScale(dialog.locator('.ai-config-lead, label, .ai-provider-grid button strong'), 14, '手机模型配置正文');
    await assertTextScale(dialog.locator('.ai-config-label-note, .ai-provider-grid button span, .ai-config-state'), 12, '手机模型配置说明');
    const state = (await dialog.locator('.ai-config-state').innerText()).trim();
    console.log('模型配置状态:', state);
    assert.match(state, /尚未验证/, '填写配置不应被显示为已经可用');
    const testButton = dialog.getByRole('button', { name: '测试连接' });
    const modelInput = dialog.locator('label').filter({ hasText: '模型名称' }).locator('input');
    const baseUrlInput = dialog.locator('label').filter({ hasText: '接口地址' }).locator('input');
    await modelInput.fill('mock-model');
    assert.equal(await testButton.isDisabled(), true, '尚未保存的配置不能直接进行连接测试');
    await baseUrlInput.fill('https://api.example.com/v1');
    await dialog.getByRole('button', { name: '保存配置' }).click();
    await dialog.getByRole('alert').getByText('修改接口地址时必须重新输入 API 密钥。').waitFor();
    assert.equal(configPosts, 0, 'changing a remote base URL without a new key must be blocked in the UI');
    await baseUrlInput.fill('https://api.openai.com/v1');
    await dialog.getByRole('button', { name: '保存配置' }).click();
    await dialog.getByRole('status').getByText('配置已保存，连接尚未验证').waitFor();
    assert.equal(await dialog.isVisible(), true, '保存后应留在配置页，以便立即测试连接');
    await page.route('**/api/llm/test', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, model: 'mock-model' }) }));
    await testButton.click();
    await dialog.getByRole('status').getByText('模型连接验证成功').waitFor();
    await assertDialogLayout(dialog, '手机配置连接结果');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1440, height: 1000 });
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
