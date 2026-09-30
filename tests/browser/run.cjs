/* Browser acceptance. AI JSON is MOCK in tests/e2e_server.py; all other APIs are real. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/acceptance');
const base = process.env.E2E_URL || 'http://127.0.0.1:8011';
const results = [];
let browser, context, page;
const tab = name => page.getByRole('tab', { name: ({ '我的能力': '能力档案', '匹配与建议': '匹配报告', '职业路径': '成长路径' })[name] || name, exact: true }).click();
const button = name => page.getByRole('button', { name, exact: true });
const label = name => page.getByLabel(name, { exact: true });
const reportButton = () => button('生成 AI 深度建议');
const onboardingDialog = () => page.getByRole('dialog', { name: '新手教程与本机保存设置', exact: true });
async function assertUnavailable(locator, description) {
  const count = await locator.count();
  assert.ok(count === 0 || await locator.isDisabled(), description + ' should be unavailable');
}
const filterSelect = index => page.locator('.matches-stitch-filter select').nth(index);
async function manualMode() { await page.getByRole('tab', { name: '手动录入资料', exact: true }).click(); }
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
const targetJob = () => page.locator('.profile-target-select select');
async function until(fn, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); }
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
async function ready() {
  await page.goto(base);
  assert.equal(await page.locator('.singularity-intro').count(), 0, 'the removed cosmic intro must not render');
  await page.locator('.exploration-header').waitFor();
  const wizard = onboardingDialog();
  if (await wizard.isVisible().catch(() => false)) {
    assert.equal(await wizard.locator('.onboarding-start-card').count(), 3);
    assert.equal(await page.locator('.workflow-guide').count(), 0, 'floating workflow guide must wait for the first choice');
    await page.locator('.onboarding-wizard-backdrop').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    assert.equal(await wizard.isVisible(), true, 'first-session wizard must remain open until the save choice is made');
    const autosaveConsent = wizard.getByRole('button', { name: '自动保存', exact: true });
    if (await autosaveConsent.isEnabled()) await autosaveConsent.click();
    else await wizard.getByRole('button', { name: '本次不保存', exact: true }).click();
    await wizard.getByRole('button', { name: /我先看看岗位/ }).click();
    assert.equal(await wizard.locator('.onboarding-flow-list > li').count(), 4);
    await wizard.getByRole('button', { name: /先浏览岗位/ }).click();
    await wizard.waitFor({ state: 'detached' });
  }
  await page.locator('.workflow-guide').waitFor();
  assert.deepEqual(await page.locator('.workflow-guide .workflow-step-number').allTextContents(), ['1', '2', '3', '4']);
  assert.equal(await page.locator('.workflow-guide-step-copy').count(), 0, 'the beginner guide should start as a compact numbered navigator');
  assert.equal(await page.locator('.workflow-guide-next').count(), 1, 'compact guide should expose a contextual next-step button');
  assert.match(await page.locator('.workflow-guide-next').getAttribute('aria-label'), /下一步：/);
  const activePanel = page.locator('.exploration-pages > .panel.active');
  await activePanel.waitFor();
  if (await activePanel.getAttribute('id') === 'page-jobs') {
    await page.locator('#page-jobs .jobs-stitch-card').first().waitFor();
    assert.equal(await page.locator('#page-jobs .jobs-stitch-card').count(), 6);
  }
}
async function reviewResume(acceptWhen = () => false) {
  const items = page.locator('.resume-review-item');
  const count = await items.count();
  assert.ok(count > 0, 'resume parser should produce review candidates');
  let accepted = 0;
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const text = await item.innerText();
    const accept = acceptWhen(text);
    await item.getByRole('button', { name: accept ? '接受' : '跳过', exact: true }).click();
    if (accept) accepted += 1;
  }
  await button('确认并合并已接受项（' + accepted + '）').click();
  await page.locator('.resume-review').waitFor({ state: 'detached' });
}
async function addSkill(name, level, evidence) {
  await label('新增技能标签').fill(name);
  await label('新增技能标签').press('Enter');
  await label(name + ' 熟练度').selectOption(String(level));
  await button('编辑 ' + name + ' 证据').click();
  await label(name + ' 证据内容').fill(evidence);
}
async function confirmAndMatch() {
  const confirm = button('确认完整画像');
  if (await confirm.isEnabled()) await confirm.click();
  const result = await responseAfter('/api/recommendations', () => tab('匹配与建议'));
  await page.locator('.alternative-grid > button').first().waitFor();
  return result;
}
async function choose(name) {
  await page.locator('.alternative-grid > button').filter({
    has: page.getByRole('heading', { name, exact: true }),
  }).click();
}
async function report() { return responseAfter('/api/reports', () => reportButton().click()); }
async function checkExport(r, filename) {
  await button('复制报告').click();
  await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n') === r.export_text, 'clipboard differs from server (after Windows newline normalization)');
  const pending = page.waitForEvent('download');
  await button('导出报告TXT').click();
  const download = await pending;
  const file = path.join(out, filename);
  await download.saveAs(file);
  assert.equal((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''), r.export_text);
}
async function delayRoute(url) {
  let signal, release, finish;
  const started = new Promise(r => signal = r);
  const gate = new Promise(r => release = r);
  const done = new Promise(r => finish = r);
  const handler = async route => { signal(); await gate; try { await route.continue(); } finally { finish(); } };
  await page.route('**' + url, handler);
  return { started, release: async () => { release(); await done; await page.unroute('**' + url, handler); } };
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL === 'chromium' ? undefined : process.env.PW_CHANNEL || 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await step('Local draft restores profile and saved path, excludes resume review data, and clears completely', async () => {
    const originalContext = context;
    const originalPage = page;
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
    page = await context.newPage();
    page.on('pageerror', err => errors.push(err.message));
    try {
      await ready();
      await tab('我的能力'); await manualMode();
      await label('专业').fill('本机草稿专业');
      await targetJob().selectOption('java');
      await addSkill('Java', 2, '可恢复的本机草稿证据');
      await button('确认完整画像').click();
      await tab('职业路径');
      const branch = page.locator('.path-branch-grid > button').first();
      await branch.waitFor(); await branch.click();
      await page.locator('.path-selected-detail').waitFor();
      await button('保存当前路径').click();
      await until(async () => (await page.locator('.path-action-hub').innerText()).includes('已保存于'), 'path selection was not marked saved');
      await tab('我的能力');
      await page.getByRole('tab', { name: '导入现有简历', exact: true }).click();
      await label('简历姓名').fill('DO_NOT_PERSIST_RESUME_NAME');
      await responseAfter('/api/resume/parse', () => page.locator('#resumeFile').setInputFiles(path.join(root, 'samples/虚构简历.pdf')));
      await until(async () => (await page.locator('.resume-review-item').count()) > 0, 'resume review candidates did not appear');
      await tab('职业路径');
      const storedDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('career-planner.local-draft')));
      assert.deepEqual(Object.keys(storedDraft).sort(), ['savedAt', 'selectedPath', 'student', 'tab', 'version']);
      assert.equal(storedDraft.student.major, '本机草稿专业');
      assert.equal(storedDraft.student.confirmed, true);
      assert.equal(storedDraft.student.intention.target_job_id, 'java');
      assert.equal(storedDraft.tab, 'paths');
      assert.equal(storedDraft.selectedPath.jobId, 'java');
      assert.ok(storedDraft.selectedPath.edgeId);
      assert.equal(JSON.stringify(storedDraft).includes('DO_NOT_PERSIST_RESUME_NAME'), false);
      assert.equal(JSON.stringify(storedDraft).includes('resumeCandidates'), false);

      await page.reload(); await ready();
      await page.locator('.path-action-hub').waitFor();
      await until(async () => (await page.locator('.path-action-hub').innerText()).includes('已保存于'), 'saved path was not restored');
      assert.equal(await page.locator('.path-job-select select').inputValue(), 'java');
      await tab('我的能力');
      assert.equal(await page.locator('.resume-review-item').count(), 0, 'unreviewed resume candidates must not be restored');
      assert.equal(await label('简历姓名').inputValue(), '', 'resume name must not be restored');
      await manualMode();
      assert.equal(await label('专业').inputValue(), '本机草稿专业');
      assert.equal(await targetJob().inputValue(), 'java');
      assert.equal(await label('Java 熟练度').inputValue(), '2');

      const draftDialog = await draftSettings();
      await draftDialog.getByRole('checkbox', { name: '自动保存到本机浏览器', exact: true }).uncheck();
      await draftDialog.getByRole('button', { name: '完成', exact: true }).click();
      await draftDialog.waitFor({ state: 'detached' });
      const retainedDraft = await page.evaluate(() => localStorage.getItem('career-planner.local-draft'));
      assert.ok(retainedDraft, 'turning off autosave should leave the existing draft available to clear');
      await page.reload(); await ready();
      await tab('我的能力'); await manualMode();
      assert.equal(await label('专业').inputValue(), '', 'autosave disabled must not restore the existing draft');
      assert.ok(await page.evaluate(() => localStorage.getItem('career-planner.local-draft')));

      await clearDraft();
      assert.equal(await page.evaluate(() => localStorage.getItem('career-planner.local-draft')), null);
      await page.reload(); await ready();
      await tab('我的能力'); await manualMode();
      assert.equal(await label('专业').inputValue(), '', 'cleared profile must stay empty after reload');
    } finally {
      const isolatedContext = context;
      context = originalContext;
      page = originalPage;
      await isolatedContext.close();
    }
  });
  await step('Six jobs, evidence detail and career paths', async () => {
    await ready();
    await button('查看 Java 开发工程师 详情').click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('heading', {name: 'Java 开发工程师', exact: true}).waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /Java|来源样本/);
    await button('关闭岗位详情').click();
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
  await step('A confirmed profile can see recommendations without choosing a target', async () => {
    await tab('我的能力');
    await manualMode();
    await label('专业').fill('无目标岗位流程测试');
    await addSkill('Java', 1, '无目标流程的 Java 练习证据');
    assert.equal(await targetJob().inputValue(), '');
    const rec = await confirmAndMatch();
    assert.ok(rec.items.length > 0, 'recommendations should be available without a target');
    assert.match(await page.locator('.workflow-guide-step').first().getAttribute('aria-label'), /可跳过/);
  });
  await step('Canonical aliases deduplicate and binary absence differs from missing evidence', async () => {
    await clearDraft();
    await tab('我的能力');
    await manualMode();
    await label('新增技能标签').fill('Vue.js'); await label('新增技能标签').press('Enter');
    await label('Vue 熟练度').waitFor();
    await label('新增技能标签').fill('Vue'); await label('新增技能标签').press('Enter');
    assert.equal(await label('Vue 熟练度').count(), 1);
    for (const [input, alias, name] of [['新增证书','CET-4','大学英语四级'], ['新增通用素质','沟通表达','沟通表达']]) {
      await label(input).fill(alias); await label(input).press('Enter');
      await label(name + ' 具备情况').selectOption('0');
    }
    const p = await responseAfter('/api/student/profile', () => button('生成能力画像').click());
    assert.deepEqual(p.profile.skills.map(x => x.tag_id), ['vue']);
    assert.equal(p.profile.skills[0].evidence, '');
    assert.equal(p.profile.certificates[0].level, 0);
    assert.equal(p.profile.qualities[0].level, 0);
    const profileStatuses = await page.locator('.profile-score-column').innerText();
    assert.match(profileStatuses, /缺少证据：1 项/);
    assert.match(profileStatuses, /已确认不具备：2 项/);
    await targetJob().selectOption('testing');
    await confirmAndMatch();
    const m = await context.request.post(base + '/api/matches', {data:{student:{...p.profile,confirmed:true},job_id:'testing'}});
    assert.equal(m.status(), 200);
    const result = await m.json();
    assert.equal(result.satisfied, 0);
    assert.ok(result.gap_items.some(x => x.tag_id === 'cet4'));
    assert.ok(result.gap_items.some(x => x.tag_id === 'communication'));
    await ready();
  });
  let manualReport;
  await step('Manual profile, evidence confirmation and independent expected scores', async () => {
    await clearDraft();
    await tab('我的能力');
    await manualMode();
    await label('专业').fill('软件工程');
    await label('项目 / 实习经历').fill('虚构课程项目：使用Java编写图书借阅类，使用SQL查询。');
    await targetJob().selectOption('java');
    await addSkill('Java', 1, 'Java课程项目：编写图书借阅类');
    await addSkill('SQL', 1, 'SQL课程项目：查询与联表练习');
    const p = await responseAfter('/api/student/profile', () => button('生成能力画像').click());
    assert.equal(p.profile.confirmed, false);
    assert.deepEqual(p.profile.skills.map(x => x.tag_id), ['java', 'sql']);
    const rec = await confirmAndMatch();
    const j = rec.items.find(x => x.job_id === 'java');
    assert.equal(j.match.satisfied, 2);
    assert.equal(j.match.required, 6);
    assert.ok(Math.abs(j.match.basic - 100 / 3) < 1e-8);
    assert.ok(Math.abs(j.match.enhanced - 100 / 6) < 1e-8);
    await choose('Java 开发工程师');
    const detail = await page.locator('.report-diagnosis').innerText();
    assert.match(detail, /33\.3%/); assert.match(detail, /16\.7%/);
    assert.match(await page.locator('.report-ecosystem').innerText(), /不适用/);
    assert.match(await page.locator('.chart-box').innerText(), /50\.0%|50%/);
    manualReport = await report();
    assert.equal(manualReport.input_version, j.match.input_version);
    assert.equal(manualReport.match.algorithm_version, rec.algorithm_version);
    assert.match(manualReport.export_text, /基础匹配度：33\.3%/);
    await checkExport(manualReport, '模拟-手动报告.txt');
    await page.screenshot({ path: path.join(out, '桌面-手动报告.png'), fullPage: true });
  });
  await step('Changing only the target keeps profile confirmation and invalidates prior results', async () => {
    await tab('我的能力');
    await targetJob().selectOption('testing');
    assert.equal(await button('确认完整画像').isDisabled(), true, 'target selection must preserve confirmation');
    assert.match(await page.locator('.workflow-guide-step').nth(1).getAttribute('aria-label'), /能力档案：已确认/);
    await tab('匹配与建议');
    assert.equal(await reportButton().isDisabled(), true, 'stale match cannot generate a report');
    await assertUnavailable(button('复制报告'), 'copy report');
    await assertUnavailable(button('导出报告TXT'), 'export report');
    assert.match(await page.locator('.stale-banner').first().innerText(), /目标岗位已切换/);
    const rec = await responseAfter('/api/recommendations', () => button('刷新匹配结果').click());
    assert.ok(rec.items.length > 0);
    await choose('软件测试工程师');
    const refreshed = await report();
    assert.equal(refreshed.job_id, 'testing');
  });
  await step('Editing revokes confirmation and invalidates report/export', async () => {
    await tab('我的能力');
    await label('专业').fill('软件工程（已编辑）');
    await tab('匹配与建议');
    assert.equal(await reportButton().isDisabled(), true);
    await assertUnavailable(button('复制报告'), 'copy report');
    await assertUnavailable(button('导出报告TXT'), 'export report');
    assert.match(await page.locator('.stale-banner').first().innerText(), /失效/);
  });
  await step('Delayed profile response never overwrites newer input', async () => {
    await tab('我的能力');
    const d = await delayRoute('/api/student/profile');
    await button('生成能力画像').click(); await d.started;
    await label('专业').fill('请求期间的新专业');
    await d.release();
    await until(() => button('生成能力画像').isEnabled(), 'profile never finishes');
    assert.equal(await label('专业').inputValue(), '请求期间的新专业');
    assert.equal(await page.getByText('AI 整理 · 优势参考', { exact: true }).count(), 0);
  });
  await step('Delayed report discarded after selecting another job', async () => {
    await confirmAndMatch();
    await choose('Java 开发工程师');
    const d = await delayRoute('/api/reports');
    await reportButton().click(); await d.started;
    await page.locator('.alternative-grid > button').filter({ hasNotText: 'Java 开发工程师' }).first().click();
    await d.release();
    await until(() => reportButton().isEnabled(), 'report never finishes');
    assert.equal(await button('复制报告').count(), 0);
  });
  await step('Delayed recommendations discarded after profile edit', async () => {
    const d = await delayRoute('/api/recommendations');
    await button('刷新匹配结果').click(); await d.started;
    await tab('我的能力'); await label('专业').fill('推荐计算期间修改');
    await d.release(); await tab('匹配与建议');
    await until(async () => !(await page.getByText('正在计算推荐…', { exact: true }).isVisible()), 'recommendations never finish');
    assert.equal(await reportButton().isDisabled(), true);
  });
  await step('PDF, DOCX and TXT candidates require item-by-item review before merging', async () => {
    for (const ext of ['pdf', 'docx', 'txt']) {
      await ready(); await tab('我的能力'); await manualMode();
      await label('专业').fill('保留手填专业');
      await targetJob().selectOption('java');
      await addSkill('Java', 0, '明确尚未掌握Java');
      await page.getByRole('tab', { name: '导入现有简历', exact: true }).click();
      const r = await responseAfter('/api/resume/parse', () => page.locator('#resumeFile').setInputFiles(path.join(root, 'samples/虚构简历.' + ext)));
      assert.ok(r.text_length > 50);
      assert.equal(r.name, '');
      await until(async () => (await page.locator('.resume-review-item').count()) > 0, 'resume review list did not appear');
      assert.equal(await button('生成能力画像').isEnabled(), true);
      await reviewResume(text => /SQL/.test(text));
      await manualMode();
      assert.equal(await label('专业').inputValue(), '保留手填专业');
      assert.equal(await label('Java 熟练度').inputValue(), '0');
      assert.equal(await label('SQL 熟练度').inputValue(), '1');
      assert.equal(await label('SQL 熟练度').count(), 1, 'duplicate resume entries should merge into one profile item');
      assert.equal(await button('确认完整画像').isEnabled(), true);
    }
    await page.getByRole('tab', { name: '导入现有简历', exact: true }).click();
    await label('简历姓名').fill('会话测试姓名');
    const profileRequest = page.waitForRequest(r => r.url().endsWith('/api/student/profile') && r.method() === 'POST');
    const generatedProfile = await responseAfter('/api/student/profile', () => button('生成能力画像').click());
    assert.equal(JSON.stringify((await profileRequest).postDataJSON()).includes('会话测试姓名'), false);
    assert.equal(generatedProfile.profile.confirmed, false);
    await until(() => button('确认完整画像').isEnabled(), 'generated profile did not become confirmable');
    await button('确认完整画像').click();
    await confirmAndMatch();
    await choose('Java 开发工程师');
    const reportRequest = page.waitForRequest(r => r.url().endsWith('/api/reports') && r.method() === 'POST');
    const reportResult = await report();
    assert.equal(JSON.stringify((await reportRequest).postDataJSON()).includes('会话测试姓名'), false);
    assert.equal(reportResult.export_text.includes('会话测试姓名'), false);
  });
  await step('Delayed resume merges into newest manual values without escalation', async () => {
    await tab('我的能力');
    const d = await delayRoute('/api/resume/parse');
    await page.locator('#resumeFile').setInputFiles(path.join(root, 'samples/虚构简历.pdf')); await d.started;
    await manualMode();
    await label('专业').fill('导入期间的新专业');
    await label('Java 熟练度').selectOption('3');
    await d.release();
    await until(() => button('生成能力画像').isEnabled(), 'resume never finishes');
    assert.equal(await label('专业').inputValue(), '导入期间的新专业');
    assert.equal(await label('Java 熟练度').inputValue(), '3');
    await page.getByRole('tab', { name: '导入现有简历', exact: true }).click();
    await until(async () => (await page.locator('.resume-review-item').count()) > 0, 'delayed candidates should wait for explicit review');
    await reviewResume();
    await manualMode();
    assert.equal(await label('Java 熟练度').inputValue(), '3');
  });
  await step('Invalid upload and upstream error preserve editable input', async () => {
    await page.getByRole('tab', { name: '导入现有简历', exact: true }).click();
    await page.locator('#resumeFile').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('broken pdf') });
    await until(() => page.getByRole('alert').first().isVisible(), 'missing invalid upload feedback');
    await manualMode();
    assert.equal(await label('专业').inputValue(), '导入期间的新专业');
    const handler = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({error:{code:'LLM_BUSY',message:'模拟上游繁忙，输入保留',retryable:true,request_id:'test-only'}}) });
    await page.route('**/api/student/profile', handler);
    await button('生成能力画像').click();
    await until(() => page.getByText('模拟上游繁忙，输入保留', { exact: true }).first().isVisible(), 'missing model error');
    assert.equal(await label('专业').inputValue(), '导入期间的新专业');
    await page.unroute('**/api/student/profile', handler);
  });
  await step('Resume route, filters with actual samples, sort and new target report', async () => {
    await confirmAndMatch();
    await page.locator('.match-filter-panel > summary').click();
    await label('城市').fill('上海');
    await label('薪资下限').fill('5000'); await label('薪资上限').fill('20000');
    await filterSelect(0).selectOption('month');
    await label('必须包含技能').fill('Java, SQL');
    await filterSelect(1).selectOption('enhanced');
    const rec = await responseAfter('/api/recommendations', () => button('应用筛选').click());
    assert.equal(rec.sort_by, 'enhanced');
    for (const x of rec.items) {
      assert.ok(x.samples.length > 0);
      for (const s of x.samples) { assert.match(s.city, /上海/); assert.equal(s.salary.period, 'month'); }
    }
    await label('城市').fill('不存在的测试城市');
    const none = await responseAfter('/api/recommendations', () => button('应用筛选').click());
    assert.equal(none.candidate_count, 0);
    await until(async () => (await page.locator('.alternative-grid > button').count()) === 1, 'missing standalone target');
    await label('城市').fill('');
    await label('薪资下限').fill(''); await label('薪资上限').fill('');
    await label('必须包含技能').fill('');
    await filterSelect(1).selectOption('basic');
    await responseAfter('/api/recommendations', () => button('应用筛选').click());
    await tab('我的能力'); await manualMode(); await targetJob().selectOption('testing');
    await confirmAndMatch();
    await choose('软件测试工程师');
    const r = await report(); assert.equal(r.job_id, 'testing');
    await checkExport(r, '模拟-简历报告.txt');
    await page.screenshot({ path: path.join(out, '桌面-简历报告.png'), fullPage: true });
  });
  await step('Health version change invalidates existing match and report', async () => {
    const real = await (await context.request.get(base + '/api/health')).json();
    const handler = route => route.fulfill({json:{...real, algorithm_version:'test-upgraded-version'}});
    await page.route('**/api/health', handler);
    await tab('职业路径'); await tab('匹配与建议');
    await until(() => reportButton().isDisabled(), 'old algorithm still allowed');
    await assertUnavailable(button('复制报告'), 'copy report');
    await page.unroute('**/api/health', handler);
  });
  await step('Zero skills, target outside top five and narrow viewport', async () => {
    await ready();
    await clearDraft();
    await tab('我的能力'); await manualMode(); await targetJob().selectOption('testing');
    const rec = await confirmAndMatch();
    assert.equal(rec.items.length, 5);
    assert.equal(rec.items.some(x => x.job_id === 'testing'), false);
    await until(async () => (await page.locator('.alternative-grid > button').count()) === 6, 'target missing outside top5');
    await choose('软件测试工程师');
    const r = await report(); assert.equal(r.match.basic, 0); assert.equal(r.match.satisfied, 0);
    assert.equal(r.match.pending_items.length, r.match.required);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, '移动端-匹配.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'horizontal page overflow');
    await button('导出报告TXT').scrollIntoViewIfNeeded(); assert.equal(await button('导出报告TXT').isEnabled(), true);
    const activePage = page.locator('.exploration-pages');
    const jobsStep = page.locator('.workflow-guide ol button').nth(0);
    await jobsStep.focus();
    assert.equal(await jobsStep.evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Enter');
    await until(async () => (await activePage.getAttribute('data-active-page')) === 'jobs', 'workflow jobs step did not activate by keyboard');
    const profileStep = page.locator('.workflow-guide ol button').nth(1);
    await profileStep.focus();
    await page.keyboard.press('Enter');
    await until(async () => (await activePage.getAttribute('data-active-page')) === 'profile', 'workflow profile step did not activate by keyboard');
    await page.screenshot({ path: path.join(out, '移动端-画像.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'profile horizontal overflow');
  });
  assert.deepEqual(errors, [], 'browser page errors');
  await fs.writeFile(path.join(out, '浏览器结果.json'), JSON.stringify({tested_at:new Date().toISOString(), ai:'MOCK ONLY — not real API acceptance', base, results, page_errors:errors}, null, 2));
  console.log('ALL ' + results.length + ' BROWSER SCENARIOS PASSED (AI MOCK ONLY)');
})().catch(async error => {
  console.error(error);
  if (page) await page.screenshot({path:path.join(out,'失败截图.png'),fullPage:true}).catch(()=>{});
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'浏览器结果.json'), JSON.stringify({tested_at:new Date().toISOString(),ai:'MOCK ONLY',results,error:String(error)},null,2));
  process.exitCode=1;
}).finally(async()=>{if(browser) await browser.close();});
