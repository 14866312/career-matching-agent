/* Browser acceptance. AI JSON is MOCK in tests/e2e_server.py; all other APIs are real. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/验收产物');
const base = process.env.E2E_URL || 'http://127.0.0.1:8011';
const results = [];
let browser, context, page;
const tab = name => page.getByRole('tab', { name, exact: true }).click();
const button = name => page.getByRole('button', { name, exact: true });
const label = name => page.getByLabel(name, { exact: true });
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
  await page.locator('.job-card').first().waitFor();
  assert.equal(await page.locator('.job-card').count(), 6);
}
async function addSkill(name, level, evidence, confirm = true) {
  await label('新增技能标签').fill(name);
  await label('新增技能标签').press('Enter');
  await label(name + ' 熟练度').selectOption(String(level));
  await button('编辑 ' + name + ' 证据').click();
  await label(name + ' 证据内容').fill(evidence);
  if (confirm) await label('确认 ' + name).check();
}
async function confirmAndMatch() {
  await button('确认完整画像').click();
  const result = await responseAfter('/api/recommendations', () => tab('匹配与建议'));
  await page.locator('.recommend-card').first().waitFor();
  return result;
}
async function choose(name) { await button('查看 ' + name + ' 匹配详情').click(); }
async function report() { return responseAfter('/api/reports', () => button('生成职业建议').click()); }
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
  const handler = async route => { const response = await route.fetch(); signal(); await gate; await route.fulfill({ response }); finish(); };
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
  await step('Six jobs, evidence detail and career paths', async () => {
    await ready();
    await button('查看 Java 开发工程师 详情').click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('heading', {name: 'Java 开发工程师', exact: true}).waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /Java|来源样本/);
    await button('关闭岗位详情').click();
    await page.screenshot({ path: path.join(out, '桌面-岗位.png'), fullPage: true });
    await tab('职业路径');
    await page.locator('.transition-item').first().waitFor();
    assert.equal(await page.locator('.path-node-group').count(), 18);
    assert.ok(await page.locator('.transition-item').count() >= 6);
    await page.locator('.transition-item').first().click();
    await page.locator('.path-detail').waitFor();
    await page.screenshot({ path: path.join(out, '桌面-路径.png'), fullPage: true });
  });
  await step('Canonical aliases deduplicate and binary absence differs from missing evidence', async () => {
    await tab('我的能力');
    await label('新增技能标签').fill('Vue.js'); await label('新增技能标签').press('Enter');
    await label('Vue 熟练度').waitFor();
    await label('新增技能标签').fill('Vue'); await label('新增技能标签').press('Enter');
    assert.equal(await label('Vue 熟练度').count(), 1);
    await label('确认 Vue').check();
    for (const [input, alias, name] of [['新增证书','CET-4','大学英语四级'], ['新增通用素质','沟通表达','沟通表达']]) {
      await label(input).fill(alias); await label(input).press('Enter');
      await label(name + ' 具备情况').selectOption('0'); await label('确认 ' + name).check();
    }
    const p = await responseAfter('/api/student/profile', () => button('生成能力画像').click());
    assert.deepEqual(p.profile.skills.map(x => x.tag_id), ['vue']);
    assert.equal(p.profile.skills[0].evidence, '');
    assert.equal(p.profile.certificates[0].level, 0);
    assert.equal(p.profile.qualities[0].level, 0);
    assert.equal(await page.locator('.stat').filter({hasText:'确认+证据（计分）'}).locator('strong').innerText(), '0');
    await label('目标岗位').selectOption('testing');
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
    await tab('我的能力');
    await label('专业').fill('软件工程');
    await label('项目 / 实习经历').fill('虚构课程项目：使用Java编写图书借阅类，使用SQL查询。');
    await label('目标岗位').selectOption('java');
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
    const detail = await page.locator('.detail-card').innerText();
    assert.match(detail, /33\.3%/); assert.match(detail, /16\.7%/); assert.match(detail, /不适用/);
    assert.match(await page.locator('.chart-box').innerText(), /50\.0%|50%/);
    manualReport = await report();
    assert.equal(manualReport.input_version, j.match.input_version);
    assert.equal(manualReport.match.algorithm_version, rec.algorithm_version);
    assert.match(manualReport.export_text, /基础匹配度：33\.3%/);
    await checkExport(manualReport, '模拟-手动报告.txt');
    await page.screenshot({ path: path.join(out, '桌面-手动报告.png'), fullPage: true });
  });
  await step('Editing revokes confirmation and invalidates report/export', async () => {
    await tab('我的能力');
    await label('专业').fill('软件工程（已编辑）');
    await tab('匹配与建议');
    assert.equal(await button('生成职业建议').isDisabled(), true);
    assert.equal(await button('复制报告').isDisabled(), true);
    assert.equal(await button('导出报告TXT').isDisabled(), true);
    assert.match(await page.locator('.detail-card').innerText(), /失效/);
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
    await button('生成职业建议').click(); await d.started;
    await page.locator('.recommend-card').filter({ hasNotText: 'Java 开发工程师' }).first().click();
    await d.release();
    await until(() => button('生成职业建议').isEnabled(), 'report never finishes');
    assert.equal(await button('复制报告').count(), 0);
  });
  await step('Delayed recommendations discarded after profile edit', async () => {
    const d = await delayRoute('/api/recommendations');
    await button('刷新推荐').click(); await d.started;
    await tab('我的能力'); await label('专业').fill('推荐计算期间修改');
    await d.release(); await tab('匹配与建议');
    await until(async () => !(await page.getByText('正在计算推荐…', { exact: true }).isVisible()), 'recommendations never finish');
    assert.equal(await button('生成职业建议').isDisabled(), true);
  });
  await step('PDF, DOCX and TXT prefill preserve manual level and require confirmation', async () => {
    for (const ext of ['pdf', 'docx', 'txt']) {
      await ready(); await tab('我的能力');
      await label('专业').fill('保留手填专业');
      await label('目标岗位').selectOption('java');
      await addSkill('Java', 0, '明确尚未掌握Java');
      const r = await responseAfter('/api/resume/parse', () => page.locator('#resumeFile').setInputFiles(path.join(root, 'samples/虚构简历.' + ext)));
      assert.ok(r.text_length > 50);
      await until(() => label('SQL 熟练度').isVisible(), 'SQL not prefilled');
      assert.equal(await label('专业').inputValue(), '保留手填专业');
      assert.equal(await label('Java 熟练度').inputValue(), '0');
      assert.equal(await label('SQL 熟练度').inputValue(), '1');
      assert.equal(await label('确认 SQL').isChecked(), false);
      assert.equal(await button('确认完整画像').isEnabled(), true);
    }
  });
  await step('Delayed resume merges into newest manual values without escalation', async () => {
    const d = await delayRoute('/api/resume/parse');
    await page.locator('#resumeFile').setInputFiles(path.join(root, 'samples/虚构简历.pdf')); await d.started;
    await label('专业').fill('导入期间的新专业');
    await label('Java 熟练度').selectOption('3');
    await d.release();
    await until(() => button('导入简历').isEnabled(), 'resume never finishes');
    assert.equal(await label('专业').inputValue(), '导入期间的新专业');
    assert.equal(await label('Java 熟练度').inputValue(), '3');
  });
  await step('Invalid upload and upstream error preserve editable input', async () => {
    await page.locator('#resumeFile').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('broken pdf') });
    await until(() => page.getByRole('alert').first().isVisible(), 'missing invalid upload feedback');
    assert.equal(await label('专业').inputValue(), '导入期间的新专业');
    const handler = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({error:{code:'LLM_BUSY',message:'模拟上游繁忙，输入保留',retryable:true,request_id:'test-only'}}) });
    await page.route('**/api/student/profile', handler);
    await button('生成能力画像').click();
    await until(() => page.getByText('模拟上游繁忙，输入保留', { exact: true }).first().isVisible(), 'missing model error');
    assert.equal(await label('专业').inputValue(), '导入期间的新专业');
    await page.unroute('**/api/student/profile', handler);
  });
  await step('Resume route, filters with actual samples, sort and new target report', async () => {
    await label('确认 SQL').check();
    await label('确认 Java').check();
    await confirmAndMatch();
    await label('城市筛选').fill('上海');
    await label('薪资下限').fill('5000'); await label('薪资上限').fill('20000');
    await label('计薪周期').selectOption('month');
    await label('必须包含技能').fill('Java, SQL');
    await label('推荐排序').selectOption('enhanced');
    const rec = await responseAfter('/api/recommendations', () => button('应用筛选').click());
    assert.equal(rec.sort_by, 'enhanced');
    for (const x of rec.items) {
      assert.ok(x.samples.length > 0);
      for (const s of x.samples) { assert.match(s.city, /上海/); assert.equal(s.salary.period, 'month'); }
    }
    await label('城市筛选').fill('不存在的测试城市');
    const none = await responseAfter('/api/recommendations', () => button('应用筛选').click());
    assert.equal(none.candidate_count, 0);
    await until(() => page.getByText('目标岗位', {exact: true}).last().isVisible(), 'missing standalone target');
    assert.equal(await page.locator('.recommend-card').count(), 1);
    await button('重置筛选').click();
    await responseAfter('/api/recommendations', () => button('应用筛选').click());
    await tab('我的能力'); await label('目标岗位').selectOption('testing');
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
    await until(() => button('生成职业建议').isDisabled(), 'old algorithm still allowed');
    assert.equal(await button('复制报告').isDisabled(), true);
    await page.unroute('**/api/health', handler);
  });
  await step('Zero skills, target outside top five and narrow viewport', async () => {
    await ready(); await tab('我的能力'); await label('目标岗位').selectOption('testing');
    const rec = await confirmAndMatch();
    assert.equal(rec.items.length, 5);
    assert.equal(rec.items.some(x => x.job_id === 'testing'), false);
    await until(async () => (await page.locator('.recommend-card').count()) === 6, 'target missing outside top5');
    await choose('软件测试工程师');
    const r = await report(); assert.equal(r.match.basic, 0); assert.equal(r.match.satisfied, 0);
    assert.equal(r.match.pending_items.length, r.match.required);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, '移动端-匹配.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'horizontal page overflow');
    await button('导出报告TXT').scrollIntoViewIfNeeded(); assert.equal(await button('导出报告TXT').isEnabled(), true);
    await tab('我的能力');
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
