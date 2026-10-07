const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function settleScroll(page) {
  await page.evaluate(() => new Promise(resolve => {
    let previous = window.scrollY;
    let stable = 0;
    const check = () => {
      stable = Math.abs(window.scrollY - previous) < 1 ? stable + 1 : 0;
      previous = window.scrollY;
      if (stable >= 5) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

async function guideLayout(page) {
  await settleScroll(page);
  return page.locator('.workflow-guide').evaluate(guide => {
    const rect = guide.getBoundingClientRect();
    return {
      top: rect.top, bottom: rect.bottom, height: rect.height,
      offset: parseFloat(getComputedStyle(guide).top),
      viewport: innerWidth, screenHeight: innerHeight,
      width: document.documentElement.scrollWidth,
      controls: [...guide.querySelectorAll('button')].map(button => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
      })
    };
  });
}

async function checkWorkflowGuide(browser, base) {
  for (const theme of ['dark', 'light']) {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      try {
        await context.addInitScript(({ theme }) => {
          localStorage.setItem('career-planning-theme', theme);
          localStorage.setItem('career-planner.autosave', 'false');
          localStorage.setItem('career-planner.onboarding', JSON.stringify({ version: 1, outcome: 'skipped', savedAt: '2026-10-07T00:00:00.000Z' }));
        }, { theme });
        const page = await context.newPage();
        await page.goto(base);
        const guide = page.locator('.workflow-guide');
        await guide.waitFor();
        const steps = guide.locator('.workflow-guide-step');
        assert.equal(await guide.locator('[aria-current]').count(), 0, '首次打开主页不能默认激活步骤');
        const expanded = await guideLayout(page);
        for (const [index, anchor] of ['profile-source', 'profile-report'].entries()) {
          await steps.nth(index).click();
          await settleScroll(page);
          assert.equal(await guide.locator('[aria-current]').count(), 1, '只能高亮一个步骤');
          assert.equal(await steps.nth(index).getAttribute('aria-current'), 'step');
          const position = await page.locator('#' + anchor).evaluate(section => ({ top: section.getBoundingClientRect().top, guideBottom: document.querySelector('.workflow-guide').getBoundingClientRect().bottom }));
          assert.ok(position.top >= position.guideBottom - 1, '步骤跳转的标题不能被吸顶向导遮挡：' + JSON.stringify(position));
        }
        await steps.nth(0).click();
        await page.getByRole('tab', { name: '手动填写', exact: true }).click();
        await page.getByLabel('专业', { exact: true }).fill('软件工程');
        await page.locator('.profile-target-select select').selectOption('java');
        const skill = page.getByLabel('新增技能', { exact: true });
        await skill.fill('Java');
        await page.getByRole('button', { name: '确认添加技能', exact: true }).click();
        await steps.nth(2).click();
        await page.locator('#report-matrix').waitFor();
        await settleScroll(page);
        const matrixPosition = await page.locator('#report-matrix').evaluate(section => ({ top: section.getBoundingClientRect().top, guideBottom: document.querySelector('.workflow-guide').getBoundingClientRect().bottom }));
        assert.ok(matrixPosition.top >= matrixPosition.guideBottom - 1, '岗位匹配跳转不能被向导遮挡：' + JSON.stringify(matrixPosition));
        await steps.nth(3).click();
        await settleScroll(page);
        const advicePosition = await page.locator('#report-advice').evaluate(section => ({ top: section.getBoundingClientRect().top, guideBottom: document.querySelector('.workflow-guide').getBoundingClientRect().bottom }));
        assert.ok(advicePosition.top >= advicePosition.guideBottom - 1, '行动建议跳转不能被向导遮挡：' + JSON.stringify(advicePosition));
        await page.getByRole('button', { name: '生成岗位建议', exact: true }).click();
        await page.locator('.matches-stitch .report').waitFor();
        assert.equal(await steps.nth(3).getAttribute('aria-current'), 'step');
        assert.equal(await guide.locator('[aria-current]').count(), 1);
        await page.getByRole('button', { name: '复制报告', exact: true }).scrollIntoViewIfNeeded();
        const completedLayout = await guideLayout(page);
        assert.ok(Math.abs(completedLayout.top - completedLayout.offset) <= 1, '完成报告后无需返回顶部即可看到向导');
        for (const tab of ['职业探索', '简历与个人报告', '匹配报告', '成长路径']) {
          await page.getByRole('tab', { name: tab, exact: true }).click();
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await settleScroll(page);
          await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
          const layout = await guideLayout(page);
          assert.ok(Math.abs(layout.top - layout.offset) <= 1, `${theme}/${viewport.width}/${tab} 向导必须停留在视口顶部：${JSON.stringify(layout)}`);
          assert.ok(layout.height < expanded.height, '滚动后向导应收紧高度');
          assert.ok(layout.bottom < layout.screenHeight * 0.6, '向导应保留主要阅读空间');
          assert.ok(layout.width <= layout.viewport + 1, '吸顶向导不能导致横向溢出');
          assert.ok(layout.controls.every(button => button.height >= 44 && button.left >= 0 && button.right <= layout.viewport && button.top >= 0 && button.bottom <= layout.screenHeight), '所有步骤与下一步必须完整可见且可触控');
          if (viewport.width === 390 || viewport.width === 1440) {
            if (process.env.E2E_OUTPUT_DIR) {
              await fs.mkdir(process.env.E2E_OUTPUT_DIR, { recursive: true });
              await page.screenshot({ path: path.join(process.env.E2E_OUTPUT_DIR, `workflow-${theme}-${viewport.width}-${tab}.png`), animations: 'disabled' });
            }
          }
        }
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await settleScroll(page);
        assert.equal(await guide.evaluate(element => element.classList.contains('is-compact')), false, '回到顶部应恢复展开布局');
      } finally {
        await context.close();
      }
    }
  }
  console.log('步骤向导：初始状态、四页吸顶、报告完成、黑白主题、桌面/手机/横屏检查通过');
}

module.exports = { checkWorkflowGuide };
