/* Browser acceptance. AI JSON is MOCK in tests/e2e_server.py; all other APIs are real. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/acceptance');
const base = process.env.E2E_URL || 'http://127.0.0.1:8011';
const BOM = String.fromCharCode(0xFEFF);
const stripBom = value => value.startsWith(BOM) ? value.slice(BOM.length) : value;
const normalizeNewlines = value => value.split('\r\n').join('\n');
const results = [];
let browser, context, page;

const tab = name => page.getByRole('tab', {
  name: ({ '我的能力': '简历与个人报告', '匹配与建议': '匹配报告', '职业路径': '成长路径' })[name] || name,
  exact: true
}).click();
const button = name => page.getByRole('button', { name, exact: true });
const label = name => page.getByLabel(name, { exact: true });
const reportButton = () => button('生成岗位建议');
const profileButton = () => button('生成个人分析报告');
const onboardingDialog = () => page.getByRole('dialog', { name: '新手教程与本机保存设置', exact: true });
const targetJob = () => page.locator('.profile-target-select select');
const filterSelect = index => page.locator('.matches-stitch-filter select').nth(index);
const tagRow = name => page.locator('.tag-row').filter({ hasText: name });
const guideStep = index => page.locator('.workflow-guide ol button').nth(index);
const ADD_LABELS = { skills: '新增技能标签', certificates: '新增证书', qualities: '新增通用素质' };

async function assertUnavailable(locator, description) {
  const count = await locator.count();
  assert.ok(count === 0 || await locator.isDisabled(), description + ' should be unavailable');
}

async function until(fn, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(message);
}

async function step(name, fn) {
  const start = Date.now();
  await fn();
  results.push({ name, status: 'passed', ms: Date.now() - start });
  console.log('PASS ' + name);
}

async function responseAfter(url, action) {
  const pending = page.waitForResponse(r => r.url().endsWith(url) && r.request().method() === 'POST');
  await action();
  const response = await pending;
  assert.equal(response.status(), 200, url + ': ' + await response.text());
  return response.json();
}

async function manualMode() { await page.getByRole('tab', { name: '手动录入资料', exact: true }).click(); }
async function resumeMode() { await page.getByRole('tab', { name: '导入现有简历', exact: true }).click(); }

async function addTag(dimension, text) {
  const input = label(ADD_LABELS[dimension]);
  await input.fill(text);
  await input.press('Enter');
}

async function draftSettings() {
  await button('设置').click();
  const dialog = page.getByRole('dialog', { name: '本机数据设置', exact: true });
  await dialog.waitFor();
  return dialog;
}

async function clearDraft() {
  const dialog = await draftSettings();
  await dialog.getByRole('button', { name: '清除本机草稿并重置流程', exact: true }).click();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function choose(name) {
  await page.locator('.alternative-grid > button').filter({
    has: page.getByRole('heading', { name, exact: true })
  }).click();
}

async function report() { return responseAfter('/api/reports', () => reportButton().click()); }

async function toastIncludes(text) {
  await until(async () => (await page.locator('.toast').count()) > 0 &&
    (await page.locator('.toast').innerText()).includes(text), 'toast missing: ' + text);
}

async function checkExport(result, filename) {
  await button('复制报告').click();
  await until(async () => normalizeNewlines(await page.evaluate(() => navigator.clipboard.readText())) === result.export_text,
    'clipboard report differs from the server text after newline normalization');
  const pending = page.waitForEvent('download');
  await button('导出报告TXT').click();
  const download = await pending;
  const file = path.join(out, filename);
  await download.saveAs(file);
  assert.equal(stripBom(await fs.readFile(file, 'utf8')), result.export_text, filename + ' differs from the server report');
}

async function delayRoute(url) {
  let signal, release, finish;
  const started = new Promise(resolve => signal = resolve);
  const gate = new Promise(resolve => release = resolve);
  const done = new Promise(resolve => finish = resolve);
  const handler = async route => { signal(); await gate; try { await route.continue(); } finally { finish(); } };
  await page.route('**' + url, handler);
  return { started, release: async () => { release(); await done; await page.unroute('**' + url, handler); } };
}

async function openFilterPanel() {
  if (await page.locator('.match-filter-panel[open]').count() === 0) {
    await page.locator('.match-filter-panel > summary').click();
  }
}

async function setFilters(values) {
  if (values.city !== undefined) await label('城市').fill(values.city);
  if (values.min !== undefined) await label('薪资下限').fill(values.min);
  if (values.max !== undefined) await label('薪资上限').fill(values.max);
  if (values.period !== undefined) await filterSelect(0).selectOption(values.period);
  if (values.skills !== undefined) await label('必须包含技能').fill(values.skills);
  if (values.sort !== undefined) await filterSelect(1).selectOption(values.sort);
}

async function ready(start = 'jobs') {
  await page.goto(base);
  assert.equal(await page.locator('.singularity-intro').count(), 0, 'the removed cosmic intro must not render');
  await page.locator('.exploration-header').waitFor();
  const wizard = onboardingDialog();
  if (await wizard.isVisible().catch(() => false)) {
    assert.equal(await wizard.locator('.onboarding-start-card').count(), 3);
    assert.equal(await wizard.locator('.onboarding-route-preview li').count(), 4);
    assert.equal(await page.locator('.workflow-guide').count(), 0, 'workflow guide must wait for the first-time choice');
    await page.locator('.onboarding-wizard-backdrop').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    assert.equal(await wizard.isVisible(), true, 'first-session wizard must stay open until the save choice is made');
    const autosaveConsent = wizard.getByRole('button', { name: '自动保存', exact: true });
    if (await autosaveConsent.isEnabled()) await autosaveConsent.click();
    else await wizard.getByRole('button', { name: '本次不保存', exact: true }).click();
    if (start === 'manual') await wizard.getByRole('button', { name: /我没有简历/ }).click();
    else await wizard.getByRole('button', { name: /我先看看岗位/ }).click();
    assert.equal(await wizard.locator('.onboarding-flow-list > li').count(), 4);
    await wizard.getByRole('button', { name: start === 'manual' ? /手动建立档案/ : /先浏览岗位/ }).click();
    await wizard.waitFor({ state: 'detached' });
  }
  await page.locator('.workflow-guide').waitFor();
  assert.deepEqual(await page.locator('.workflow-guide .workflow-step-number').allTextContents(), ['1', '2', '3', '4']);
  assert.equal(await page.locator('.workflow-guide-step-copy').count(), 0, 'the guide is a compact numbered navigator');
  assert.equal(await page.locator('.workflow-guide-next').count(), 1, 'compact guide should expose a contextual next-step button');
  assert.match(await page.locator('.workflow-guide-next').getAttribute('aria-label'), /下一步：/);
  const activePanel = page.locator('.exploration-pages > .panel.active');
  await activePanel.waitFor();
  if (await activePanel.getAttribute('id') === 'page-jobs') {
    await page.locator('#page-jobs .jobs-stitch-card').first().waitFor();
    assert.equal(await page.locator('#page-jobs .jobs-stitch-card').count(), 6);
  }
}

async function recommendations(action) {
  const pending = page.waitForResponse(r => r.url().endsWith('/api/recommendations') && r.request().method() === 'POST');
  await action();
  const response = await pending;
  assert.equal(response.status(), 200, '/api/recommendations: ' + await response.text());
  const data = await response.json();
  await page.locator('.alternative-grid > button').first().waitFor();
  return data;
}

async function loadRecommendations() {
  return recommendations(() => tab('匹配与建议'));
}

async function refreshRecommendations() {
  return recommendations(() => button('刷新匹配结果').click());
}

async function setTarget(id) {
  await tab('我的能力');
  await manualMode();
  await targetJob().selectOption(id);
}

async function uploadResume(fileName) {
  const result = await responseAfter('/api/resume/parse', () => page.locator('#resumeFile').setInputFiles(path.join(root, 'samples', fileName)));
  await until(async () => (await page.locator('.profile-resume-status').innerText()).includes('已更新'), 'resume merge did not finish');
  return result;
}

async function assertNoLegacyProfileControls() {
  assert.equal(await page.getByText('生成能力画像', { exact: true }).count(), 0, 'legacy profile action must not render');
  assert.equal(await page.getByText('确认完整画像', { exact: true }).count(), 0, 'legacy confirmation action must not render');
  assert.equal(await page.getByText('确认并合并已接受项', { exact: false }).count(), 0, 'legacy resume review action must not render');
  assert.equal(await page.locator('select[aria-label*="熟练度"]').count(), 0, 'legacy proficiency controls must not render');
}

(async () => {
  await fs.mkdir(out, { recursive: true });
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL === 'chromium' ? undefined : process.env.PW_CHANNEL || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await step('Local draft restores profile and saved path, keeps resume name session-only, and clears completely', async () => {
    const originalContext = context;
    const originalPage = page;
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
    page = await context.newPage();
    page.on('pageerror', err => errors.push(err.message));
    try {
      await ready();
      await tab('我的能力');
      await manualMode();
      await label('专业').fill('本机草稿专业');
      await targetJob().selectOption('java');
      await addTag('skills', 'Java');
      await tab('职业路径');
      const branch = page.locator('.path-branch-grid > button').first();
      await branch.waitFor();
      await branch.click();
      await page.locator('.path-selected-detail').waitFor();
      await button('保存当前路径').click();
      await until(async () => (await page.locator('.path-action-hub').innerText()).includes('已保存于'), 'path selection was not marked saved');

      await tab('我的能力');
      await resumeMode();
      await label('简历姓名').fill('DO_NOT_PERSIST_RESUME_NAME');
      await uploadResume('虚构简历.pdf');
      assert.equal(await page.locator('.resume-review-item').count(), 0, 'resume import must merge without a review step');

      await tab('职业路径');
      const storedDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('career-planner.local-draft')));
      assert.deepEqual(Object.keys(storedDraft).sort(), ['savedAt', 'selectedPath', 'student', 'tab', 'version']);
      assert.equal(storedDraft.student.major, '本机草稿专业');
      assert.equal(storedDraft.student.confirmed, false);
      assert.equal(storedDraft.student.intention.target_job_id, 'java');
      assert.equal(storedDraft.tab, 'paths');
      assert.equal(storedDraft.selectedPath.jobId, 'java');
      assert.ok(storedDraft.selectedPath.edgeId);
      assert.equal(JSON.stringify(storedDraft).includes('DO_NOT_PERSIST_RESUME_NAME'), false);
      assert.equal(JSON.stringify(storedDraft).includes('resumeCandidates'), false);

      await page.reload();
      await ready();
      await page.locator('.path-action-hub').waitFor();
      await until(async () => (await page.locator('.path-action-hub').innerText()).includes('已保存于'), 'saved path was not restored');
      assert.equal(await page.locator('.path-job-select select').inputValue(), 'java');
      await tab('我的能力');
      assert.equal(await page.locator('.resume-review-item').count(), 0, 'resume review state must not be restored');
      assert.equal(await label('简历姓名').inputValue(), '', 'resume name must not be restored');
      await manualMode();
      assert.equal(await label('专业').inputValue(), '本机草稿专业');
      assert.equal(await targetJob().inputValue(), 'java');
      assert.equal(await tagRow('Java').count(), 1);

      const settings = await draftSettings();
      await settings.getByRole('checkbox', { name: '自动保存到本机浏览器', exact: true }).uncheck();
      await settings.getByRole('button', { name: '完成', exact: true }).click();
      await settings.waitFor({ state: 'detached' });
      assert.ok(await page.evaluate(() => localStorage.getItem('career-planner.local-draft')));
      await page.reload();
      await ready();
      await tab('我的能力');
      await manualMode();
      assert.equal(await label('专业').inputValue(), '', 'autosave disabled must not restore the existing draft');
      assert.ok(await page.evaluate(() => localStorage.getItem('career-planner.local-draft')));

      await clearDraft();
      assert.equal(await page.evaluate(() => localStorage.getItem('career-planner.local-draft')), null);
      await page.reload();
      await ready();
      await tab('我的能力');
      await manualMode();
      assert.equal(await label('专业').inputValue(), '', 'cleared profile must stay empty after reload');
    } finally {
      const isolatedContext = context;
      context = originalContext;
      page = originalPage;
      await isolatedContext.close();
    }
  });

  await step('Six jobs, job detail, and career paths', async () => {
    await ready();
    assert.equal(await page.locator('#page-jobs .jobs-stitch-card').count(), 6);
    await button('查看 Java 开发工程师 详情').click();
    const dialog = page.getByRole('dialog', { name: 'Java 开发工程师', exact: true });
    await dialog.waitFor();
    await dialog.locator('.job-detail').waitFor();
    assert.match(await dialog.innerText(), /Java|来源样本/);
    await dialog.getByRole('button', { name: '关闭岗位详情', exact: true }).click();
    await page.screenshot({ path: path.join(out, '桌面-岗位.png'), fullPage: true });
    await tab('职业路径');
    const paths = await (await context.request.get(base + '/api/career-paths')).json();
    assert.equal(paths.nodes.length, 18);
    assert.equal(paths.edges.filter(edge => edge.type === 'transition').length, 12);
    assert.equal(await page.locator('.path-timeline .timeline-stage').count(), 3);
    const branches = page.locator('.path-branch-grid > button');
    assert.ok(await branches.count() >= 2);
    await branches.first().click();
    await page.locator('.path-selected-detail').waitFor();
    await page.screenshot({ path: path.join(out, '桌面-路径.png'), fullPage: true });
  });

  await step('A profile without a target can see recommendations', async () => {
    await clearDraft();
    await tab('我的能力');
    await manualMode();
    await label('专业').fill('无目标岗位流程测试');
    await addTag('skills', 'Java');
    assert.equal(await targetJob().inputValue(), '');
    const rec = await loadRecommendations();
    assert.ok(rec.items.length > 0, 'recommendations should be available without a target');
    assert.match(await guideStep(0).getAttribute('aria-label'), /已填写/);
  });

  await step('Canonical aliases deduplicate and binary absence differs from missing evidence', async () => {
    await clearDraft();
    await tab('我的能力');
    await manualMode();
    await addTag('skills', 'Vue.js');
    await addTag('skills', 'Vue');
    assert.equal(await tagRow('Vue').count(), 1, 'Vue.js and Vue must map to one canonical tag');
    await addTag('certificates', 'CET-4');
    await addTag('qualities', '沟通能力');
    const profile = await responseAfter('/api/student/profile', () => button('生成个人分析报告').click());
    assert.equal(profile.profile.confirmed, false);
    assert.deepEqual(profile.profile.skills.map(x => x.tag_id), ['vue']);
    assert.deepEqual(profile.profile.certificates.map(x => x.tag_id), ['cet4']);
    assert.deepEqual(profile.profile.qualities.map(x => x.tag_id), ['communication']);
    assert.equal(await page.locator('select[aria-label*="熟练度"]').count(), 0);
    const testing = await (await context.request.post(base + '/api/matches', { data: { student: profile.profile, job_id: 'testing' } })).json();
    assert.equal(testing.satisfied, 2);
    const vueOnly = { ...profile.profile, certificates: [], qualities: [] };
    const vueOnlyMatch = await (await context.request.post(base + '/api/matches', { data: { student: vueOnly, job_id: 'testing' } })).json();
    assert.equal(vueOnlyMatch.satisfied, 0, 'related skills alone must not satisfy unrelated testing requirements');
  });

  let manualReport;
  await step('Manual profile, personal analysis, recommendations, and independent report scores', async () => {
    await clearDraft();
    await tab('我的能力');
    await manualMode();
    await label('专业').fill('软件工程');
    await label('项目 / 实习经历').fill('虚构课程项目：使用Java编写图书借阅类，使用SQL查询数据。');
    await targetJob().selectOption('java');
    await addTag('skills', 'Java');
    await addTag('skills', 'SQL');
    const profile = await responseAfter('/api/student/profile', () => button('生成个人分析报告').click());
    assert.deepEqual(profile.profile.skills.map(x => x.tag_id), ['java', 'sql']);
    assert.equal(await page.locator('.profile-analysis-list').count(), 1);
    const rec = await loadRecommendations();
    const java = rec.items.find(x => x.job_id === 'java');
    assert.ok(java, 'Java recommendation should be present');
    assert.equal(java.match.satisfied, 2);
    assert.equal(java.match.required, 6);
    assert.ok(Math.abs(java.match.basic - 100 / 3) < 1e-8);
    assert.ok(Math.abs(java.match.enhanced - 100 / 3) < 1e-8);
    await choose('Java 开发工程师');
    manualReport = await report();
    assert.equal(manualReport.input_version, java.match.input_version);
    assert.equal(manualReport.match.algorithm_version, rec.algorithm_version);
    assert.match(manualReport.export_text, /基础匹配度：33.3%/);
    await checkExport(manualReport, '模拟-手动报告.txt');
    await page.screenshot({ path: path.join(out, '桌面-手动报告.png'), fullPage: true });
  });

  await step('Changing the target invalidates existing recommendations and report', async () => {
    await tab('我的能力');
    await manualMode();
    await targetJob().selectOption('testing');
    await tab('匹配与建议');
    assert.equal(await reportButton().isDisabled(), true, 'target selection must stale the prior match');
    await assertUnavailable(button('复制报告'), 'copy report');
    await assertUnavailable(button('导出报告TXT'), 'export report');
    assert.match(await page.locator('.stale-banner').first().innerText(), /目标岗位已切换/);
    const rec = await refreshRecommendations();
    assert.ok(rec.items.length > 0);
    await choose('软件测试工程师');
    const refreshed = await report();
    assert.equal(refreshed.job_id, 'testing');
  });

  await step('Editing profile data invalidates report and export', async () => {
    await tab('我的能力');
    await manualMode();
    await label('专业').fill('软件工程（已编辑）');
    await tab('匹配与建议');
    assert.equal(await reportButton().isDisabled(), true);
    await assertUnavailable(button('复制报告'), 'copy report');
    await assertUnavailable(button('导出报告TXT'), 'export report');
    assert.match(await page.locator('.stale-banner').first().innerText(), /旧匹配与建议已过期|失效/);
  });

  await step('Delayed profile, report, and recommendation responses are discarded', async () => {
    await tab('我的能力');
    await manualMode();
    const delayedProfile = await delayRoute('/api/student/profile');
    await button('生成个人分析报告').click();
    await delayedProfile.started;
    await label('专业').fill('请求期间的新专业');
    await delayedProfile.release();
    await until(() => button('生成个人分析报告').isEnabled(), 'profile request never finished');
    assert.equal(await label('专业').inputValue(), '请求期间的新专业');
    assert.equal(await page.locator('.profile-analysis-list').count(), 0, 'stale profile response must not create analysis');

    await tab('匹配与建议');
    await refreshRecommendations();
    await choose('Java 开发工程师');
    const delayedReport = await delayRoute('/api/reports');
    await reportButton().click();
    await delayedReport.started;
    const alternative = page.locator('.alternative-grid > button').filter({ hasNotText: 'Java 开发工程师' }).first();
    await alternative.click();
    await delayedReport.release();
    await until(() => reportButton().isEnabled(), 'report request never finished');
    assert.equal(await button('复制报告').count(), 0, 'stale report response must not restore report actions');

    const delayedRecommendations = await delayRoute('/api/recommendations');
    await button('刷新匹配结果').click();
    await delayedRecommendations.started;
    await tab('我的能力');
    await manualMode();
    await label('专业').fill('推荐计算期间修改');
    await delayedRecommendations.release();
    await tab('匹配与建议');
    await until(async () => await page.getByText('正在计算推荐…', { exact: true }).count() === 0, 'recommendations request never finished');
    assert.equal(await reportButton().isDisabled(), true, 'stale recommendation response must not enable report generation');
  });

  await step('PDF, DOCX, and TXT resumes merge automatically while preserving manual values', async () => {
    for (const ext of ['pdf', 'docx', 'txt']) {
      await clearDraft();
      await tab('我的能力');
      await manualMode();
      await label('专业').fill('保留手填专业');
      await targetJob().selectOption('java');
      await addTag('skills', 'Java');
      await resumeMode();
      const parsed = await uploadResume('虚构简历.' + ext);
      assert.ok(parsed.text_length > 50);
      assert.equal(parsed.name, '');
      assert.equal(await page.locator('.resume-review-item').count(), 0, 'resume import must not require item-by-item review');
      await manualMode();
      assert.equal(await label('专业').inputValue(), '保留手填专业');
      assert.equal(await tagRow('Java').count(), 1, 'manual Java must not be duplicated by resume import');
      assert.equal(await tagRow('SQL').count(), 1, 'SQL must be imported once');
      assert.equal(await tagRow('Java').getByText('手动补充', { exact: true }).count(), 1);
      assert.equal(await tagRow('SQL').getByText('简历提取', { exact: true }).count(), 1);
      await assertNoLegacyProfileControls();
    }

    await resumeMode();
    await label('简历姓名').fill('会话测试姓名');
    const profileRequest = page.waitForRequest(r => r.url().endsWith('/api/student/profile') && r.method() === 'POST');
    const generatedProfile = await responseAfter('/api/student/profile', () => button('生成个人分析报告').click());
    assert.equal(JSON.stringify((await profileRequest).postDataJSON()).includes('会话测试姓名'), false);
    assert.equal(generatedProfile.profile.confirmed, false);
    const rec = await loadRecommendations();
    await choose('Java 开发工程师');
    const reportRequest = page.waitForRequest(r => r.url().endsWith('/api/reports') && r.method() === 'POST');
    const reportResult = await report();
    assert.equal(JSON.stringify((await reportRequest).postDataJSON()).includes('会话测试姓名'), false);
    assert.equal(reportResult.export_text.includes('会话测试姓名'), false);
  });

  await step('Delayed resume merging keeps the newest manual values', async () => {
    await clearDraft();
    await tab('我的能力');
    await manualMode();
    await addTag('skills', 'Java');
    await resumeMode();
    const delayed = await delayRoute('/api/resume/parse');
    const pending = responseAfter('/api/resume/parse', () => page.locator('#resumeFile').setInputFiles(path.join(root, 'samples', '虚构简历.pdf')));
    await delayed.started;
    await manualMode();
    await label('专业').fill('导入期间的新专业');
    await addTag('skills', 'SQL');
    await delayed.release();
    await pending;
    await resumeMode();
    await until(async () => (await page.locator('.profile-resume-status').innerText()).includes('已更新'), 'delayed resume merge did not finish');
    await manualMode();
    assert.equal(await label('专业').inputValue(), '导入期间的新专业');
    assert.equal(await tagRow('Java').count(), 1);
    assert.equal(await tagRow('SQL').count(), 1);
    assert.equal(await tagRow('SQL').getByText('手动补充', { exact: true }).count(), 1);
  });

  await step('Invalid upload and upstream profile errors preserve editable input', async () => {
    await tab('我的能力');
    await manualMode();
    await label('专业').fill('错误期间仍保留的专业');
    await resumeMode();
    await page.locator('#resumeFile').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('broken pdf') });
    await until(async () => await page.getByRole('alert').count() > 0, 'missing invalid upload feedback');
    await manualMode();
    assert.equal(await label('专业').inputValue(), '错误期间仍保留的专业');

    const handler = route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'LLM_BUSY', message: '模拟上游繁忙，输入保持不变', retryable: true, request_id: 'test-only' } })
    });
    await page.route('**/api/student/profile', handler);
    try {
      await button('生成个人分析报告').click();
      await until(async () => (await page.getByRole('alert').allTextContents()).some(text => text.includes('模拟上游繁忙')), 'missing model error');
      assert.equal(await label('专业').inputValue(), '错误期间仍保留的专业');
    } finally {
      await page.unroute('**/api/student/profile', handler);
    }
  });

  await step('Resume profile, real samples in filters, reset, and a new target report', async () => {
    await tab('我的能力');
    await manualMode();
    await targetJob().selectOption('java');
    await loadRecommendations();
    await openFilterPanel();
    await setFilters({ city: '上海', min: '5000', max: '20000', period: 'month', skills: 'Java, SQL', sort: 'enhanced' });
    const filtered = await responseAfter('/api/recommendations', () => button('应用筛选').click());
    assert.equal(filtered.sort_by, 'enhanced');
    assert.equal(filtered.candidate_count, 2);
    for (const item of filtered.items) {
      assert.ok(item.samples.length > 0);
      for (const sample of item.samples) {
        assert.match(sample.city, /上海/);
        assert.equal(sample.salary.period, 'month');
      }
    }
    await setFilters({ city: '不存在的测试城市' });
    const none = await responseAfter('/api/recommendations', () => button('应用筛选').click());
    assert.equal(none.candidate_count, 0);
    await until(async () => (await page.locator('.alternative-grid > button').count()) === 1, 'standalone target should remain visible when filters have no samples');
    assert.match(await page.locator('.match-empty-card, .report-alternatives').allTextContents().then(items => items.join(' ')), /没有符合当前筛选条件的岗位/);

    await setFilters({ city: '', min: '', max: '', skills: '', sort: 'basic' });
    await responseAfter('/api/recommendations', () => button('应用筛选').click());
    await tab('我的能力');
    await manualMode();
    await targetJob().selectOption('testing');
    await tab('匹配与建议');
    await refreshRecommendations();
    await choose('软件测试工程师');
    const result = await report();
    assert.equal(result.job_id, 'testing');
    await checkExport(result, '模拟-简历报告.txt');
    await page.screenshot({ path: path.join(out, '桌面-简历报告.png'), fullPage: true });
  });

  await step('A server version change invalidates existing match and report', async () => {
    const real = await (await context.request.get(base + '/api/health')).json();
    const handler = route => route.fulfill({ json: { ...real, algorithm_version: 'test-upgraded-version' } });
    await page.route('**/api/health', handler);
    try {
      await tab('成长路径');
      await tab('匹配与建议');
      await until(() => reportButton().isDisabled(), 'old algorithm result should be stale');
      await assertUnavailable(button('复制报告'), 'copy report after version change');
      assert.match(await page.locator('.stale-banner').first().innerText(), /服务端算法或岗位数据版本已更新/);
    } finally {
      await page.unroute('**/api/health', handler);
    }
  });

  await step('Zero skills, target outside top five, and narrow viewport remain usable', async () => {
    await clearDraft();
    await tab('我的能力');
    await manualMode();
    await label('专业').fill('软件工程');
    await targetJob().selectOption('testing');
    const rec = await loadRecommendations();
    assert.equal(rec.items.length, 5);
    assert.equal(rec.items.some(x => x.job_id === 'testing'), false);
    await until(async () => (await page.locator('.alternative-grid > button').count()) === 6, 'target outside top five should still be selectable');
    await choose('软件测试工程师');
    const result = await report();
    assert.equal(result.match.basic, 0);
    assert.equal(result.match.satisfied, 0);
    assert.equal(result.match.pending_items.length, result.match.required);
    assert.equal(await button('导出报告TXT').isEnabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, '移动端-匹配.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'matching page must not overflow horizontally');
    const activePage = page.locator('.exploration-pages');
    await guideStep(0).focus();
    assert.equal(await guideStep(0).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Enter');
    await until(async () => (await activePage.getAttribute('data-active-page')) === 'profile', 'workflow profile step did not activate by keyboard');
    await guideStep(1).focus();
    await page.keyboard.press('Enter');
    await until(async () => (await activePage.getAttribute('data-active-page')) === 'profile', 'workflow personal report step did not activate by keyboard');
    await manualMode();
    await assertNoLegacyProfileControls();
    await page.screenshot({ path: path.join(out, '移动端-画像.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'profile page must not overflow horizontally');
    await guideStep(2).focus();
    await page.keyboard.press('Enter');
    await until(async () => (await activePage.getAttribute('data-active-page')) === 'matches', 'workflow match step did not activate by keyboard');
  });

  assert.deepEqual(errors, [], 'browser page errors');
  await fs.writeFile(path.join(out, '浏览器结果.json'), JSON.stringify({ tested_at: new Date().toISOString(), ai: 'MOCK ONLY — not real API acceptance', base, results, page_errors: errors }, null, 2));
  console.log('ALL ' + results.length + ' BROWSER SCENARIOS PASSED (AI MOCK ONLY)');
})().catch(async error => {
  console.error(error);
  if (page) await page.screenshot({ path: path.join(out, '失败截图.png'), fullPage: true }).catch(() => {});
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, '浏览器结果.json'), JSON.stringify({ tested_at: new Date().toISOString(), ai: 'MOCK ONLY', base, results, error: String(error) }, null, 2));
  process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); });
