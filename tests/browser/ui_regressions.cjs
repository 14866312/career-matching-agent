/* Focused regressions for the native job selector, local draft settings, guide, and model configuration state. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const base = process.env.E2E_URL || 'http://127.0.0.1:8011';

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL === 'chromium' ? undefined : process.env.PW_CHANNEL || 'msedge',
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('**/api/llm/config', route => {
      const config = route.request().method() === 'GET'
        ? { provider: 'openai', adapter: 'openai-responses', base_url: 'https://api.openai.com/v1', model: 'existing-model', configured: true, has_api_key: true }
        : { provider: 'openai', adapter: 'openai-responses', base_url: 'https://api.openai.com/v1', model: 'mock-model', configured: true, has_api_key: true };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
    });
    await page.goto(base);
    assert.equal(await page.locator('.singularity-intro').count(), 0, 'the removed cosmic intro must not render');
    await page.locator('.exploration-header').waitFor();

    const wizard = page.getByRole('dialog', { name: '新手教程与本机保存设置', exact: true });
    await wizard.waitFor();
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
    assert.equal(await guide.locator('.workflow-guide-step-copy').count(), 0, 'collapsed guide should show only numbered steps');
    assert.equal(await guide.getByRole('button').count(), 5, 'compact guide should expose four numbered buttons and a next-step button');
    assert.match(await guide.locator('.workflow-guide-next').getAttribute('aria-label'), /下一步：/);

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

    await page.getByRole('button', { name: /AI 模型配置/ }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 模型配置' });
    await dialog.waitFor();
    const state = (await dialog.locator('.ai-config-state').innerText()).trim();
    console.log('模型配置状态:', state);
    assert.match(state, /尚未验证/, '填写配置不应被显示为已经可用');
    const testButton = dialog.getByRole('button', { name: '测试连接' });
    const modelInput = dialog.locator('label').filter({ hasText: '模型名称' }).locator('input');
    await modelInput.fill('mock-model');
    assert.equal(await testButton.isDisabled(), true, '尚未保存的配置不能直接进行连接测试');
    await dialog.getByRole('button', { name: '保存配置' }).click();
    await dialog.getByRole('status').getByText('配置已保存，连接尚未验证').waitFor();
    assert.equal(await dialog.isVisible(), true, '保存后应留在配置页，以便立即测试连接');
    await page.route('**/api/llm/test', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, model: 'mock-model' }) }));
    await testButton.click();
    await dialog.getByRole('status').getByText('模型连接验证成功').waitFor();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
